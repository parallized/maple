import { createHash, timingSafeEqual } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
  DeviceAuthorizationStartRequest,
  DeviceAuthorizationStartResponse,
  DeviceAuthorizationApproveResponse,
  DeviceAuthorizationTokenResponse,
  DeviceAuthorizationReview,
  RunnerCapability,
  WorkerInventoryItem,
  WorkerKind
} from "@maple/protocol";
import type { ServerConfig } from "../config";
import { HttpError } from "../http/responses";
import { createPairingCode, createSecret, hashSecret, normalizePairingCode } from "../lib/crypto";
import { addSeconds, nowIso } from "../lib/time";
import { RunnerRepository } from "../repositories/runner-repository";
import { WorkspaceRepository } from "../repositories/workspace-repository";
import type { SessionPrincipal, SessionService } from "../auth/session-service";

interface AuthorizationRow {
  id: string;
  code_challenge: string;
  runner_name: string;
  hostname: string;
  platform: string;
  version: string;
  supported_workers: string;
  worker_inventory: string | null;
  capabilities: string;
  state: "pending" | "approved" | "consumed" | "denied";
  workspace_id: string | null;
  approved_by_user_id: string | null;
  expires_at: string;
  last_polled_at: string | null;
}

function parseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeRunnerName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new HttpError(422, "runner_name_invalid", "设备名称应为 1 至 80 个可见字符。");
  }
  return normalized;
}

export class DeviceAuthorizationService {
  private readonly workspaces: WorkspaceRepository;

  constructor(
    private readonly database: Database,
    private readonly runners: RunnerRepository,
    private readonly sessions: SessionService,
    private readonly config: ServerConfig
  ) {
    this.workspaces = new WorkspaceRepository(database);
  }

  start(input: DeviceAuthorizationStartRequest): DeviceAuthorizationStartResponse {
    const now = nowIso();
    const runnerName = normalizeRunnerName(input.runnerName);
    const expiresAt = addSeconds(now, this.config.deviceAuthorizationTtlSeconds ?? 600);
    const deviceCode = createSecret(48);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const userCode = createPairingCode();
      try {
        this.database.run(
          `INSERT INTO device_authorizations(
             id, device_code_hash, user_code_hash, code_challenge,
             runner_name, hostname, platform, version, supported_workers,
             worker_inventory, capabilities, state, created_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
          [
            crypto.randomUUID(), hashSecret(deviceCode), hashSecret(normalizePairingCode(userCode)), input.codeChallenge,
            runnerName, input.hostname, input.platform, input.version,
            JSON.stringify(input.supportedWorkers ?? []),
            input.workerInventory === undefined ? null : JSON.stringify(input.workerInventory),
            JSON.stringify(input.capabilities ?? []), now, expiresAt
          ]
        );
        const publicUrl = (this.config.publicUrl || "http://127.0.0.1:45820").replace(/\/$/, "");
        const verificationUri = `${publicUrl}/authorize`;
        return {
          deviceCode,
          userCode,
          verificationUri,
          verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
          expiresAt,
          intervalSeconds: 3
        };
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    throw new Error("无法创建 CLI 授权请求");
  }

  approve(
    principal: SessionPrincipal,
    workspaceId: string,
    userCode: string,
    requestedRunnerName?: string
  ): DeviceAuthorizationApproveResponse {
    this.sessions.assertTrusted(principal);
    const now = nowIso();
    const row = this.database
      .query(
        `SELECT * FROM device_authorizations
         WHERE user_code_hash = ? AND state = 'pending' AND expires_at > ?`
      )
      .get(hashSecret(normalizePairingCode(userCode)), now) as AuthorizationRow | null;
    if (!row) throw new HttpError(410, "device_authorization_expired", "CLI 授权请求无效或已经过期。");
    if (!this.workspaces.getForUser(workspaceId, principal.user.id)) {
      throw new HttpError(404, "workspace_not_found", "工作区不存在或当前账户无权访问。");
    }
    const runnerName = normalizeRunnerName(requestedRunnerName ?? row.runner_name);
    const updated = this.database.run(
      `UPDATE device_authorizations
       SET state = 'approved', runner_name = ?, workspace_id = ?, approved_by_user_id = ?, approved_by_session_id = ?, approved_at = ?
       WHERE id = ? AND state = 'pending' AND expires_at > ?`,
      [runnerName, workspaceId, principal.user.id, principal.session.id, now, row.id, now]
    );
    if (updated.changes !== 1) throw new HttpError(409, "device_authorization_changed", "CLI 授权状态已经变化。");
    this.sessions.recordEvent({
      workspaceId,
      userId: principal.user.id,
      sessionId: principal.session.id,
      type: "runner.authorization_approved",
      severity: "critical",
      ipAddress: principal.session.ip_address,
      deviceLabel: principal.session.device_label,
      metadata: { runnerName, hostname: row.hostname, platform: row.platform }
    });
    return { approved: true, workspaceId, runnerName };
  }

  inspect(userCode: string): DeviceAuthorizationReview {
    const row = this.database
      .query(
        `SELECT * FROM device_authorizations
         WHERE user_code_hash = ? AND state = 'pending' AND expires_at > ?`
      )
      .get(hashSecret(normalizePairingCode(userCode)), nowIso()) as AuthorizationRow | null;
    if (!row) throw new HttpError(410, "device_authorization_expired", "CLI 授权请求无效或已经过期。");
    return {
      userCode,
      runnerName: row.runner_name,
      hostname: row.hostname,
      platform: row.platform,
      expiresAt: row.expires_at
    };
  }

  exchange(deviceCode: string, codeVerifier: string): DeviceAuthorizationTokenResponse {
    const now = nowIso();
    const row = this.database
      .query("SELECT * FROM device_authorizations WHERE device_code_hash = ?")
      .get(hashSecret(deviceCode)) as AuthorizationRow | null;
    if (!row || row.expires_at <= now || row.state === "denied" || row.state === "consumed") return { status: "expired" };
    if (!equalText(pkceChallenge(codeVerifier), row.code_challenge)) {
      throw new HttpError(401, "pkce_invalid", "CLI 授权校验失败。");
    }
    if (row.last_polled_at && Date.now() - Date.parse(row.last_polled_at) < 2_500) {
      return { status: "slow_down", retryAfterMs: 3_000 };
    }
    this.database.run("UPDATE device_authorizations SET last_polled_at = ? WHERE id = ?", [now, row.id]);
    if (row.state === "pending") return { status: "pending", retryAfterMs: 3_000 };
    if (!row.workspace_id || !row.approved_by_user_id) return { status: "expired" };

    return this.database.transaction(() => {
      const consumed = this.database.run(
        "UPDATE device_authorizations SET state = 'consumed', consumed_at = ? WHERE id = ? AND state = 'approved'",
        [now, row.id]
      );
      if (consumed.changes !== 1) return { status: "expired" } as const;
      const credential = this.runners.upsertCredential(row.workspace_id!, {
        runnerName: row.runner_name,
        hostname: row.hostname,
        platform: row.platform,
        version: row.version,
        supportedWorkers: parseArray<WorkerKind>(row.supported_workers),
        workerInventory: row.worker_inventory === null ? undefined : parseArray<WorkerInventoryItem>(row.worker_inventory),
        capabilities: parseArray<RunnerCapability>(row.capabilities)
      });
      const workspace = this.workspaces.getForUser(row.workspace_id!, row.approved_by_user_id!);
      if (!workspace) throw new Error("CLI 授权工作区不存在");
      this.database.run("UPDATE device_authorizations SET runner_id = ? WHERE id = ?", [credential.runner.id, row.id]);
      return {
        status: "authorized",
        runner: credential.runner,
        runnerToken: credential.runnerToken,
        workspace
      } as const;
    }).immediate();
  }
}

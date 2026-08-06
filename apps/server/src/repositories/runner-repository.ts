import type { Database } from "bun:sqlite";
import { WORKER_KINDS } from "@maple/protocol";
import type {
  CreatePairingResponse,
  ExchangePairingRequest,
  ExchangePairingResponse,
  Runner,
  RunnerCapability,
  UpdateRunnerModelSettingsRequest,
  WorkerInventoryItem,
  WorkerKind
} from "@maple/protocol";
import { touchRevision } from "../database/revision";
import type { RunnerRow } from "../database/rows";
import { toRunner } from "../database/rows";
import { createPairingCode, createSecret, hashSecret, normalizePairingCode } from "../lib/crypto";
import { addSeconds, nowIso, subtractSeconds } from "../lib/time";

interface PairingRow {
  id: string;
  workspace_id: string;
  expires_at: string;
  used_at: string | null;
}

export class RunnerRepository {
  constructor(
    private readonly database: Database,
    private readonly offlineSeconds: number
  ) {}

  createPairing(workspaceId: string, ttlSeconds: number): CreatePairingResponse {
    const now = nowIso();
    const expiresAt = addSeconds(now, ttlSeconds);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = createPairingCode();
      try {
        this.database.run(
          "INSERT INTO pairing_codes(id, workspace_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
          [crypto.randomUUID(), workspaceId, hashSecret(normalizePairingCode(code)), expiresAt, now]
        );
        return { code, expiresAt };
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }

    throw new Error("无法创建配对码");
  }

  exchangePairing(input: ExchangePairingRequest): ExchangePairingResponse | null {
    const exchange = this.database.transaction(() => {
      const now = nowIso();
      const codeHash = hashSecret(normalizePairingCode(input.code));
      const pairing = this.database
        .query("SELECT id, workspace_id, expires_at, used_at FROM pairing_codes WHERE code_hash = ?")
        .get(codeHash) as PairingRow | null;
      if (!pairing || pairing.used_at || pairing.expires_at <= now) return null;

      const credential = this.upsertCredential(pairing.workspace_id, input);

      this.database.run("UPDATE pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL", [now, pairing.id]);
      touchRevision(this.database);
      return credential;
    });

    return exchange.immediate();
  }

  upsertCredential(workspaceId: string, input: Omit<ExchangePairingRequest, "code">): ExchangePairingResponse {
    const now = nowIso();
    const runnerToken = createSecret();
    const supportedWorkers = JSON.stringify(input.supportedWorkers ?? []);
    const workerInventory = input.workerInventory === undefined ? null : JSON.stringify(input.workerInventory);
    const capabilities = JSON.stringify(input.capabilities ?? []);
    const existing = this.database
      .query("SELECT id FROM runners WHERE workspace_id = ? AND hostname = ? AND platform = ?")
      .get(workspaceId, input.hostname, input.platform) as { id: string } | null;
    const runnerId = existing?.id ?? crypto.randomUUID();
    if (existing) {
      this.database.run(
        `UPDATE runners
         SET token_hash = ?, name = ?, version = ?, supported_workers = ?, worker_inventory = ?,
             capabilities = ?, last_seen_at = ?, revoked_at = NULL
         WHERE id = ? AND workspace_id = ?`,
        [hashSecret(runnerToken), input.runnerName, input.version, supportedWorkers, workerInventory, capabilities, now, runnerId, workspaceId]
      );
    } else {
      this.database.run(
        `INSERT INTO runners(
           id, workspace_id, token_hash, name, hostname, platform, version,
           supported_workers, worker_inventory, capabilities, last_seen_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          runnerId, workspaceId, hashSecret(runnerToken), input.runnerName, input.hostname,
          input.platform, input.version, supportedWorkers, workerInventory, capabilities, now, now
        ]
      );
    }
    touchRevision(this.database);
    const runner = this.getById(runnerId, workspaceId);
    if (!runner) throw new Error("执行端创建失败");
    return { runner, runnerToken };
  }

  authenticate(token: string | null): Runner | null {
    if (!token) return null;
    const row = this.database
      .query(
        `SELECT id, workspace_id, name, hostname, platform, version, supported_workers, worker_inventory, capabilities,
                default_worker, leader_worker, last_seen_at, created_at,
                (SELECT group_concat(project_id) FROM project_bindings WHERE runner_id = runners.id) AS project_ids
         FROM runners WHERE token_hash = ? AND revoked_at IS NULL`
      )
      .get(hashSecret(token)) as RunnerRow | null;
    return row ? toRunner(row, subtractSeconds(nowIso(), this.offlineSeconds)) : null;
  }

  heartbeat(
    runnerId: string,
    version?: string,
    supportedWorkers?: WorkerKind[],
    capabilities?: RunnerCapability[],
    workerInventory?: WorkerInventoryItem[]
  ): Runner | null {
    const now = nowIso();
    const sets = ["last_seen_at = ?"];
    const values: string[] = [now];
    if (version) {
      sets.push("version = ?");
      values.push(version);
    }
    if (supportedWorkers) {
      sets.push("supported_workers = ?");
      values.push(JSON.stringify(supportedWorkers));
    }
    if (workerInventory) {
      sets.push("worker_inventory = ?");
      values.push(JSON.stringify(workerInventory));
    }
    if (capabilities) {
      sets.push("capabilities = ?");
      values.push(JSON.stringify(capabilities));
    }
    values.push(runnerId);
    this.database.run(`UPDATE runners SET ${sets.join(", ")} WHERE id = ?`, values);
    this.database.run("UPDATE project_bindings SET last_seen_at = ?, updated_at = ? WHERE runner_id = ?", [now, now, runnerId]);
    return this.getById(runnerId);
  }

  getById(runnerId: string, workspaceId?: string): Runner | null {
    const row = this.database
      .query(
        `SELECT id, workspace_id, name, hostname, platform, version, supported_workers, worker_inventory, capabilities,
                default_worker, leader_worker, last_seen_at, created_at,
                (SELECT group_concat(project_id) FROM project_bindings WHERE runner_id = runners.id) AS project_ids
         FROM runners WHERE id = ? AND revoked_at IS NULL${workspaceId ? " AND workspace_id = ?" : ""}`
      )
      .get(...(workspaceId ? [runnerId, workspaceId] : [runnerId])) as RunnerRow | null;
    return row ? toRunner(row, subtractSeconds(nowIso(), this.offlineSeconds)) : null;
  }

  list(workspaceId?: string): Runner[] {
    const offlineBefore = subtractSeconds(nowIso(), this.offlineSeconds);
    const rows = this.database
      .query(
        `SELECT id, workspace_id, name, hostname, platform, version, supported_workers, worker_inventory, capabilities,
                default_worker, leader_worker, last_seen_at, created_at,
                (SELECT group_concat(project_id) FROM project_bindings WHERE runner_id = runners.id) AS project_ids
         FROM runners
         WHERE revoked_at IS NULL${workspaceId ? " AND workspace_id = ?" : ""}
         ORDER BY CASE WHEN last_seen_at IS NOT NULL AND last_seen_at >= ? THEN 0 ELSE 1 END,
                  created_at ASC,
                  name COLLATE NOCASE`
      )
      .all(...(workspaceId ? [workspaceId, offlineBefore] : [offlineBefore])) as RunnerRow[];
    return rows.map((row) => toRunner(row, offlineBefore));
  }

  /** 读取该执行端的模型覆盖；不存在的执行端返回空覆盖（跟随工作区默认）。 */
  getModelOverrides(runnerId: string): { defaultWorker: WorkerKind | null; leaderWorker: WorkerKind | null } {
    const row = this.database
      .query("SELECT default_worker, leader_worker FROM runners WHERE id = ? AND revoked_at IS NULL")
      .get(runnerId) as { default_worker: string | null; leader_worker: string | null } | null;
    if (!row) return { defaultWorker: null, leaderWorker: null };
    return {
      defaultWorker: parseRunnerWorkerOverride(row.default_worker),
      leaderWorker: parseRunnerWorkerOverride(row.leader_worker)
    };
  }

  updateModels(
    runnerId: string,
    workspaceId: string,
    input: UpdateRunnerModelSettingsRequest
  ): Runner | null {
    const current = this.database
      .query(
        `SELECT default_worker, leader_worker FROM runners
         WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`
      )
      .get(runnerId, workspaceId) as { default_worker: string | null; leader_worker: string | null } | null;
    if (!current) return null;
    const defaultWorker = input.defaultWorker === undefined ? current.default_worker : input.defaultWorker;
    const leaderWorker = input.leaderWorker === undefined ? current.leader_worker : input.leaderWorker;
    this.database.run(
      `UPDATE runners
       SET default_worker = ?, leader_worker = ?
       WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`,
      [defaultWorker, leaderWorker, runnerId, workspaceId]
    );
    touchRevision(this.database);
    return this.getById(runnerId, workspaceId);
  }

  revoke(runnerId: string, workspaceId: string): boolean {
    const revoke = this.database.transaction(() => {
      const result = this.database.run(
        "UPDATE runners SET revoked_at = ?, token_hash = ? WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL",
        [nowIso(), hashSecret(createSecret()), runnerId, workspaceId]
      );
      if (result.changes === 0) return false;
      this.database.run("DELETE FROM project_bindings WHERE runner_id = ?", [runnerId]);
      touchRevision(this.database);
      return true;
    });
    return revoke.immediate();
  }
}

function parseRunnerWorkerOverride(raw: string | null): WorkerKind | null {
  if (!raw) return null;
  return (WORKER_KINDS as readonly string[]).includes(raw) ? (raw as WorkerKind) : null;
}

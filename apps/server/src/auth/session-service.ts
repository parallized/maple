import { timingSafeEqual } from "node:crypto";
import type { Database } from "bun:sqlite";
import type {
  AuthSessionResponse,
  SecurityEvent,
  SecurityEventSeverity,
  UserProfile,
  WebSessionSummary,
  WebSessionTrust,
  WorkspaceSummary
} from "@maple/protocol";
import type { ServerConfig } from "../config";
import { HttpError } from "../http/responses";
import { createSecret, hashSecret } from "../lib/crypto";
import { addSeconds, nowIso } from "../lib/time";
import { WorkspaceRepository } from "../repositories/workspace-repository";
import { SESSION_COOKIE_NAME } from "./constants";
import { deviceLabel, networkKey, userAgentKey } from "./network";

interface SessionRow {
  id: string;
  user_id: string;
  active_workspace_id: string;
  csrf_token: string | null;
  csrf_token_hash: string;
  trust: string;
  ip_address: string;
  network_key: string;
  user_agent_hash: string;
  device_label: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  reviewed_at: string | null;
  revoked_at: string | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_file: string | null;
  created_at: string;
  updated_at: string;
}

interface SecurityEventRow {
  id: string;
  type: string;
  severity: string;
  ip_address: string | null;
  device_label: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface SessionPrincipal {
  session: SessionRow;
  user: UserRow;
}

export interface CreatedSession {
  principal: SessionPrincipal;
  token: string;
}

function parseCookie(headers: Headers, name: string): string | null {
  const source = headers.get("cookie");
  if (!source) return null;
  for (const part of source.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function equalHash(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function toUser(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_file ? `/api/account/avatar/${encodeURIComponent(row.id)}?v=${encodeURIComponent(row.updated_at)}` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toSession(row: SessionRow, current: boolean): WebSessionSummary {
  return {
    id: row.id,
    trust: row.trust as WebSessionTrust,
    current,
    ipAddress: row.ip_address,
    deviceLabel: row.device_label,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at
  };
}

export class SessionService {
  private readonly workspaces: WorkspaceRepository;
  private readonly cookieName: string;

  constructor(
    private readonly database: Database,
    private readonly config: ServerConfig
  ) {
    this.workspaces = new WorkspaceRepository(database);
    this.cookieName = config.sessionCookieName?.trim() || SESSION_COOKIE_NAME;
  }

  create(userId: string, workspaceId: string, ipAddress: string, userAgent: string): CreatedSession {
    const now = nowIso();
    const network = networkKey(ipAddress);
    const agentKey = userAgentKey(userAgent);
    const trusted = this.database
      .query(
        `SELECT 1 FROM web_sessions
         WHERE user_id = ? AND trust = 'trusted' AND revoked_at IS NULL AND expires_at > ?
           AND network_key = ? AND user_agent_hash = ?
         LIMIT 1`
      )
      .get(userId, now, network, agentKey);
    const anyTrusted = this.database
      .query(
        `SELECT 1 FROM web_sessions
         WHERE user_id = ? AND trust = 'trusted' AND revoked_at IS NULL AND expires_at > ? LIMIT 1`
      )
      .get(userId, now);
    const trust: WebSessionTrust = this.config.deploymentMode === "standalone" || !anyTrusted || trusted
      ? "trusted"
      : "review";
    const token = createSecret(48);
    const csrfToken = createSecret(32);
    const sessionId = crypto.randomUUID();
    const expiresAt = addSeconds(now, (this.config.sessionDays ?? 30) * 24 * 60 * 60);
    this.database.run(
      `INSERT INTO web_sessions(
         id, token_hash, user_id, active_workspace_id, csrf_token, csrf_token_hash, trust,
         ip_address, network_key, user_agent_hash, device_label,
         created_at, last_seen_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        hashSecret(token),
        userId,
        workspaceId,
        csrfToken,
        hashSecret(csrfToken),
        trust,
        ipAddress,
        network,
        agentKey,
        deviceLabel(userAgent),
        now,
        now,
        expiresAt
      ]
    );
    this.recordEvent({
      workspaceId,
      userId,
      sessionId,
      type: trust === "trusted" ? "session.created" : "session.review_required",
      severity: trust === "trusted" ? "info" : "warning",
      ipAddress,
      deviceLabel: deviceLabel(userAgent),
      metadata: { networkChanged: trust === "review" }
    });
    const principal = this.byId(sessionId);
    if (!principal) throw new Error("会话创建失败");
    return { principal, token };
  }

  authenticate(headers: Headers): SessionPrincipal | null {
    const token = parseCookie(headers, this.cookieName);
    if (!token) return null;
    const now = nowIso();
    const row = this.database
      .query(
        `SELECT * FROM web_sessions
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`
      )
      .get(hashSecret(token), now) as SessionRow | null;
    if (!row) return null;
    if (Date.now() - Date.parse(row.last_seen_at) > 60_000) {
      this.database.run("UPDATE web_sessions SET last_seen_at = ? WHERE id = ?", [now, row.id]);
      row.last_seen_at = now;
    }
    const user = this.user(row.user_id);
    if (!user || !this.workspaces.getForUser(row.active_workspace_id, row.user_id)) return null;
    return { session: row, user };
  }

  byId(sessionId: string): SessionPrincipal | null {
    const session = this.database.query("SELECT * FROM web_sessions WHERE id = ?").get(sessionId) as SessionRow | null;
    if (!session) return null;
    const user = this.user(session.user_id);
    return user ? { session, user } : null;
  }

  assertCsrf(principal: SessionPrincipal, request: Request): void {
    const token = request.headers.get("x-maple-csrf")?.trim();
    if (!token || !equalHash(hashSecret(token), principal.session.csrf_token_hash)) {
      throw new HttpError(403, "csrf_invalid", "页面验证信息已失效，请刷新后重试。");
    }
    const origin = request.headers.get("origin");
    if (!origin) throw new HttpError(403, "origin_required", "请求来源无法验证。");
    const requestOrigin = new URL(request.url).origin;
    if (origin !== requestOrigin && !this.config.allowedOrigins.includes(origin)) {
      throw new HttpError(403, "origin_invalid", "请求来源不受信任。");
    }
  }

  describe(principal: SessionPrincipal, workspaceId = principal.session.active_workspace_id): AuthSessionResponse {
    const csrfToken = this.ensureCsrfToken(principal.session);
    const workspaces = this.workspaces.listForUser(principal.user.id);
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new HttpError(401, "workspace_access_lost", "当前工作区访问权限已失效。");
    return {
      authenticated: true,
      deploymentMode: this.config.deploymentMode ?? "hosted",
      user: toUser(principal.user),
      workspace,
      workspaces,
      session: toSession(principal.session, true),
      csrfToken
    };
  }

  switchWorkspace(principal: SessionPrincipal, workspaceId: string): AuthSessionResponse {
    this.assertTrusted(principal);
    if (!this.workspaces.getForUser(workspaceId, principal.user.id)) {
      throw new HttpError(404, "workspace_not_found", "工作区不存在。");
    }
    this.database.run("UPDATE web_sessions SET active_workspace_id = ? WHERE id = ?", [workspaceId, principal.session.id]);
    principal.session.active_workspace_id = workspaceId;
    return this.describe(principal, workspaceId);
  }

  listUserSessions(principal: SessionPrincipal): WebSessionSummary[] {
    const rows = this.database
      .query(
        `SELECT * FROM web_sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC`
      )
      .all(principal.user.id, nowIso()) as SessionRow[];
    return rows.map((row) => toSession(row, row.id === principal.session.id));
  }

  approve(principal: SessionPrincipal, sessionId: string): WebSessionSummary {
    this.assertTrusted(principal);
    const target = this.database
      .query("SELECT * FROM web_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .get(sessionId, principal.user.id) as SessionRow | null;
    if (!target) throw new HttpError(404, "session_not_found", "登录设备不存在。");
    const now = nowIso();
    this.database.run("UPDATE web_sessions SET trust = 'trusted', reviewed_at = ? WHERE id = ?", [now, sessionId]);
    target.trust = "trusted";
    target.reviewed_at = now;
    this.recordEvent({
      workspaceId: target.active_workspace_id,
      userId: principal.user.id,
      sessionId,
      type: "session.approved",
      severity: "info",
      ipAddress: target.ip_address,
      deviceLabel: target.device_label,
      metadata: { approvedBySessionId: principal.session.id }
    });
    return toSession(target, sessionId === principal.session.id);
  }

  revoke(principal: SessionPrincipal, sessionId: string): void {
    const target = this.database
      .query("SELECT * FROM web_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .get(sessionId, principal.user.id) as SessionRow | null;
    if (!target) throw new HttpError(404, "session_not_found", "登录设备不存在。");
    if (sessionId !== principal.session.id) this.assertTrusted(principal);
    this.database.run("UPDATE web_sessions SET revoked_at = ? WHERE id = ?", [nowIso(), sessionId]);
    this.recordEvent({
      workspaceId: target.active_workspace_id,
      userId: principal.user.id,
      sessionId,
      type: "session.revoked",
      severity: "warning",
      ipAddress: target.ip_address,
      deviceLabel: target.device_label,
      metadata: { revokedBySessionId: principal.session.id }
    });
  }

  revokeOthers(principal: SessionPrincipal): void {
    this.assertTrusted(principal);
    this.database.run(
      "UPDATE web_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL",
      [nowIso(), principal.user.id, principal.session.id]
    );
  }

  listSecurityEvents(principal: SessionPrincipal, limit = 100): SecurityEvent[] {
    const rows = this.database
      .query(
        `SELECT id, type, severity, ip_address, device_label, metadata_json, created_at
         FROM security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(principal.user.id, Math.max(1, Math.min(limit, 200))) as SecurityEventRow[];
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity as SecurityEventSeverity,
      ipAddress: row.ip_address,
      deviceLabel: row.device_label,
      createdAt: row.created_at,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : {}
    }));
  }

  assertTrusted(principal: SessionPrincipal): void {
    if (principal.session.trust !== "trusted") {
      throw new HttpError(403, "session_review_required", "这次登录来自新位置，需由已信任设备确认后才能访问工作区。");
    }
  }

  resolveWorkspaceId(principal: SessionPrincipal, requestedWorkspaceId?: string | null): string {
    const workspaceId = requestedWorkspaceId?.trim() || principal.session.active_workspace_id;
    if (!this.workspaces.getForUser(workspaceId, principal.user.id)) {
      throw new HttpError(404, "workspace_not_found", "工作区不存在或当前账户无权访问。");
    }
    return workspaceId;
  }

  sessionCookie(token: string): string {
    const maxAge = (this.config.sessionDays ?? 30) * 24 * 60 * 60;
    return `${this.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.config.secureCookies ? "; Secure" : ""}`;
  }

  clearCookie(): string {
    return `${this.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${this.config.secureCookies ? "; Secure" : ""}`;
  }

  recordEvent(input: {
    workspaceId: string | null;
    userId: string | null;
    sessionId: string | null;
    type: string;
    severity: SecurityEventSeverity;
    ipAddress: string | null;
    deviceLabel: string | null;
    metadata?: Record<string, unknown>;
  }): void {
    this.database.run(
      `INSERT INTO security_events(
         id, workspace_id, user_id, session_id, type, severity,
         ip_address, device_label, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        input.workspaceId,
        input.userId,
        input.sessionId,
        input.type,
        input.severity,
        input.ipAddress,
        input.deviceLabel,
        input.metadata ? JSON.stringify(input.metadata) : null,
        nowIso()
      ]
    );
  }

  private user(userId: string): UserRow | null {
    return this.database.query("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | null;
  }

  private ensureCsrfToken(session: SessionRow): string {
    if (session.csrf_token) return session.csrf_token;
    const generated = createSecret(32);
    const token = this.database.transaction(() => {
      this.database.run(
        `UPDATE web_sessions SET csrf_token = ?, csrf_token_hash = ?
         WHERE id = ? AND csrf_token IS NULL`,
        [generated, hashSecret(generated), session.id]
      );
      return this.database
        .query("SELECT csrf_token, csrf_token_hash FROM web_sessions WHERE id = ?")
        .get(session.id) as { csrf_token: string; csrf_token_hash: string };
    }).immediate();
    session.csrf_token = token.csrf_token;
    session.csrf_token_hash = token.csrf_token_hash;
    return token.csrf_token;
  }
}

export type { SessionRow, UserRow };

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKER_KINDS, type WorkerKind } from "@maple/protocol";

export type AgentSessionScope = "manager" | "workflow";

export interface AgentSessionRecord {
  version: 1;
  scope: AgentSessionScope;
  scopeId: string;
  workerKind: WorkerKind;
  sessionId: string;
  contextFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

function safeSegment(value: string): string {
  const label = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "session";
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `${label}-${digest}`;
}

function isRecord(
  value: unknown,
  scope: AgentSessionScope,
  scopeId: string,
  workerKind: WorkerKind
): value is AgentSessionRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AgentSessionRecord>;
  return item.version === 1
    && item.scope === scope
    && item.scopeId === scopeId
    && item.workerKind === workerKind
    && WORKER_KINDS.includes(item.workerKind)
    && typeof item.sessionId === "string"
    && item.sessionId.trim().length > 0
    && item.sessionId.length <= 500
    && (item.contextFingerprint === null || typeof item.contextFingerprint === "string")
    && typeof item.createdAt === "string"
    && typeof item.updatedAt === "string";
}

/** Provider session ID 只保存在执行端本机，不会上传到 Maple Server。 */
export class AgentSessionStore {
  private readonly root: string;

  constructor(configPath: string) {
    this.root = dirname(configPath);
  }

  workspace(scope: AgentSessionScope, scopeId: string): string {
    return join(this.root, scope === "manager" ? "managers" : "workers", safeSegment(scopeId));
  }

  read(scope: AgentSessionScope, scopeId: string, workerKind: WorkerKind): AgentSessionRecord | null {
    const path = this.path(scope, scopeId, workerKind);
    if (!existsSync(path)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return isRecord(parsed, scope, scopeId, workerKind) ? parsed : null;
    } catch {
      return null;
    }
  }

  save(input: {
    scope: AgentSessionScope;
    scopeId: string;
    workerKind: WorkerKind;
    sessionId: string;
    contextFingerprint?: string | null;
  }): AgentSessionRecord {
    const sessionId = input.sessionId.trim();
    if (!sessionId || sessionId.length > 500) throw new Error("Coding Agent 返回的 session ID 无效。");
    const previous = this.read(input.scope, input.scopeId, input.workerKind);
    const now = new Date().toISOString();
    const record: AgentSessionRecord = {
      version: 1,
      scope: input.scope,
      scopeId: input.scopeId,
      workerKind: input.workerKind,
      sessionId,
      contextFingerprint: input.contextFingerprint ?? previous?.contextFingerprint ?? null,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };
    const path = this.path(input.scope, input.scopeId, input.workerKind);
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporaryPath, path);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
    return record;
  }

  remove(scope: AgentSessionScope, scopeId: string, workerKind: WorkerKind): void {
    const path = this.path(scope, scopeId, workerKind);
    if (existsSync(path)) unlinkSync(path);
  }

  private path(scope: AgentSessionScope, scopeId: string, workerKind: WorkerKind): string {
    return join(this.workspace(scope, scopeId), `${workerKind}.session.json`);
  }
}

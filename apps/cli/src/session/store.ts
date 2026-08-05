import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WORKER_KINDS, type TokenUsage, type WorkerKind } from "@maple/protocol";

export type AgentSessionScope = "manager" | "workflow";

export interface AgentSessionRecord {
  version: 1;
  scope: AgentSessionScope;
  scopeId: string;
  workerKind: WorkerKind;
  sessionId: string;
  contextFingerprint: string | null;
  /**
   * Codex / DeepSeek 上次 run 结束时的累计用量（已剔除 cached 子集），
   * 用于把「整个 session 的累计值」换算成「单次 run 的增量」；旧记录缺失时视为 null。
   */
  usageBaseline?: TokenUsage | null;
  /** 该会话已连续执行的任务数，供长 Workflow 会话在任务边界轮换时参考。 */
  runCount?: number;
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
  const baseline = item.usageBaseline;
  const validBaseline = baseline === undefined
    || baseline === null
    || (
      typeof baseline === "object"
      && Number.isFinite(baseline.inputTokens)
      && Number.isFinite(baseline.cachedInputTokens)
      && Number.isFinite(baseline.outputTokens)
      && Number.isFinite(baseline.reasoningOutputTokens)
    );
  const validRunCount = item.runCount === undefined
    || (Number.isSafeInteger(item.runCount) && item.runCount >= 0);
  return item.version === 1
    && item.scope === scope
    && item.scopeId === scopeId
    && item.workerKind === workerKind
    && WORKER_KINDS.includes(item.workerKind)
    && typeof item.sessionId === "string"
    && item.sessionId.trim().length > 0
    && item.sessionId.length <= 500
    && (item.contextFingerprint === null || typeof item.contextFingerprint === "string")
    && validBaseline
    && validRunCount
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

  readUsageBaseline(scope: AgentSessionScope, scopeId: string, workerKind: WorkerKind): TokenUsage | null {
    return this.read(scope, scopeId, workerKind)?.usageBaseline ?? null;
  }

  save(input: {
    scope: AgentSessionScope;
    scopeId: string;
    workerKind: WorkerKind;
    sessionId: string;
    contextFingerprint?: string | null;
    runCount?: number;
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
      usageBaseline: previous?.usageBaseline ?? null,
      runCount: input.runCount ?? previous?.runCount ?? 0,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    };
    this.writeRecord(record);
    return record;
  }

  /** 会话每成功执行完一个任务累加一次，供长 Workflow 会话轮换策略使用。 */
  incrementRunCount(scope: AgentSessionScope, scopeId: string, workerKind: WorkerKind): void {
    const record = this.read(scope, scopeId, workerKind);
    if (!record) return;
    this.writeRecord({
      ...record,
      runCount: (record.runCount ?? 0) + 1,
      updatedAt: new Date().toISOString()
    });
  }

  /** 更新既有会话记录的累计用量基线；会话不存在时忽略（基线必须与会话同生共死）。 */
  saveUsageBaseline(
    scope: AgentSessionScope,
    scopeId: string,
    workerKind: WorkerKind,
    usageBaseline: TokenUsage | null
  ): void {
    const record = this.read(scope, scopeId, workerKind);
    if (!record) return;
    this.writeRecord({
      ...record,
      usageBaseline,
      updatedAt: new Date().toISOString()
    });
  }

  remove(scope: AgentSessionScope, scopeId: string, workerKind: WorkerKind): void {
    const path = this.path(scope, scopeId, workerKind);
    if (existsSync(path)) unlinkSync(path);
  }

  private writeRecord(record: AgentSessionRecord): void {
    const path = this.path(record.scope, record.scopeId, record.workerKind);
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      renameSync(temporaryPath, path);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
  }

  private path(scope: AgentSessionScope, scopeId: string, workerKind: WorkerKind): string {
    return join(this.workspace(scope, scopeId), `${workerKind}.session.json`);
  }
}

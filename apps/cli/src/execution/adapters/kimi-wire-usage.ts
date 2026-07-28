import type { TokenUsage } from "@maple/protocol";

/**
 * Kimi CLI 的 stream-json 不向 stdout 输出 token 用量，只把每个 turn 的消耗写进
 * session 归档文件 `<sessionDir>/agents/main/wire.jsonl`（事件 type=usage.record）。
 * 本模块在进程结束后从该文件读取并累加 per-turn 用量。
 */

interface KimiTurnUsage {
  inputOther: number;
  inputCacheRead: number;
  inputCacheCreation: number;
  output: number;
}

/** 跨平台取 home 目录。 */
function homeDirectory(): string | null {
  return process.env.HOME || process.env.USERPROFILE || null;
}

/**
 * 从 `~/.kimi-code/session_index.jsonl` 中按 sessionId 解析出 sessionDir。
 * 该文件由 Kimi 维护，每行一个 { sessionId, sessionDir, workDir }。
 */
export function resolveWirePath(
  sessionId: string | null,
  options?: { homeDir?: string; indexPath?: string }
): string | null {
  if (!sessionId) return null;
  const home = options?.homeDir ?? homeDirectory();
  if (!home) return null;
  const indexPath = options?.indexPath ?? `${home}/.kimi-code/session_index.jsonl`;

  let content: string;
  try {
    content = require("fs").readFileSync(indexPath, "utf-8");
  } catch {
    return null;
  }

  for (const line of content.split(/\r\n|\n|\r/)) {
    const clean = line.trim();
    if (!clean) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    if (record.sessionId !== sessionId) continue;
    const sessionDir = typeof record.sessionDir === "string" ? record.sessionDir : null;
    if (!sessionDir) return null;
    return `${sessionDir}/agents/main/wire.jsonl`;
  }
  return null;
}

function pickUsage(source: unknown): KimiTurnUsage | null {
  if (!source || typeof source !== "object") return null;
  const u = (source as Record<string, unknown>).usage;
  if (!u || typeof u !== "object") return null;
  const rec = u as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const hasAny = ["inputOther", "inputCacheRead", "inputCacheCreation", "output"].some(
    (k) => typeof rec[k] === "number"
  );
  if (!hasAny) return null;
  return {
    inputOther: num(rec.inputOther),
    inputCacheRead: num(rec.inputCacheRead),
    inputCacheCreation: num(rec.inputCacheCreation),
    output: num(rec.output)
  };
}

/**
 * 读取 wire.jsonl 末尾（限制读取量），累加所有 `usage.record`(scope=turn) 事件。
 * Kimi 是 per-turn 增量上报，需累加得到整次执行的总消耗。
 */
export function extractKimiUsage(
  wirePath: string,
  options?: { readFile?: (path: string, encoding: "utf-8") => string }
): TokenUsage | null {
  const read = options?.readFile ?? ((p, enc) => require("fs").readFileSync(p, enc));
  let content: string;
  try {
    content = read(wirePath, "utf-8");
  } catch {
    return null;
  }

  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;

  for (const line of content.split(/\r\n|\n|\r/)) {
    const clean = line.trim();
    if (!clean) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const record = parsed as Record<string, unknown>;
    // 只认 usage.record（与 context.append_loop_event 内容重复，取更明确的那个）
    if (record.type !== "usage.record") continue;
    const scope = record.usageScope;
    if (scope !== undefined && scope !== "turn") continue;
    const usage = pickUsage(record);
    if (!usage) continue;
    inputTokens += usage.inputOther + usage.inputCacheCreation;
    cachedInputTokens += usage.inputCacheRead;
    outputTokens += usage.output;
  }

  if (!inputTokens && !cachedInputTokens && !outputTokens) return null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0
  };
}

/**
 * 进程结束后供 kimi adapter 调用的总入口：解析 wire 路径并提取用量。
 * 任何环节失败返回 null，回退到 parser.usage()。
 */
export function collectKimiWireUsage(sessionId: string | null): TokenUsage | null {
  const wirePath = resolveWirePath(sessionId);
  if (!wirePath) return null;
  return extractKimiUsage(wirePath);
}

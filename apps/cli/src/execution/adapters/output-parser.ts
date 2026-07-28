import type { LogStream, RunLogKind, RunLogLevel, RunLogStatus, TokenUsage } from "@maple/protocol";
import type { AgentOutputParser, AgentRunEventDraft } from "./types";

type ProcessStream = Exclude<LogStream, "system">;

/** 传给 adapter mapper 的上下文，提供副作用回调。 */
export interface JsonMapperContext {
  /** adapter 在解析到执行完成事件时上报 token 用量，parser 保留最后一次。 */
  reportUsage: (usage: TokenUsage) => void;
}

type JsonMapper = (value: Record<string, unknown>, stream: ProcessStream, ctx: JsonMapperContext) => AgentRunEventDraft[];

const MAX_PENDING_CHARS = 256_000;
const SESSION_ID_KEYS = new Set(["thread_id", "session_id", "sessionId", "sessionID"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function findSessionId(value: unknown, depth = 0): string | null {
  if (depth > 5 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSessionId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, candidate] of Object.entries(value)) {
    if (SESSION_ID_KEYS.has(key) && typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 500);
    }
    if ((key === "session" || key === "thread" || key === "conversation") && isRecord(candidate)) {
      const id = stringValue(candidate.id);
      if (id) return id.slice(0, 500);
    }
  }
  for (const candidate of Object.values(value)) {
    const found = findSessionId(candidate, depth + 1);
    if (found) return found;
  }
  return null;
}

function findSessionIdInText(value: string): string | null {
  return value.match(/(?:resume (?:this )?session|继续(?:此)?会话).*?(?:-r|--resume)\s+([^\s"']+)/i)?.[1] ?? null;
}

export function compactJson(value: unknown, maxLength = 8_000): string {
  if (typeof value === "string") return value;
  let rendered: string;
  try {
    rendered = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    rendered = String(value);
  }
  return rendered.length <= maxLength ? rendered : `${rendered.slice(0, maxLength)}\n…`;
}

export function extractText(value: unknown, depth = 0): string {
  if (depth > 5 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  if (!isRecord(value)) return "";

  for (const key of ["text", "content", "response", "result", "output", "message", "delta", "error"]) {
    if (value[key] === undefined) continue;
    const text = extractText(value[key], depth + 1);
    if (text) return text;
  }
  return "";
}

export function classifyTool(name: string): RunLogKind {
  const normalized = name.toLowerCase();
  if (/bash|shell|terminal|command|exec|run_command/.test(normalized)) return "command";
  if (/write|edit|patch|replace|create_file|delete_file|move_file/.test(normalized)) return "file_change";
  return "tool";
}

export function normalizeStatus(value: unknown): RunLogStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (["started", "running", "in_progress", "pending"].includes(normalized)) {
    return normalized === "started" ? "started" : "progress";
  }
  if (["completed", "complete", "success", "succeeded", "done"].includes(normalized)) return "completed";
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(normalized)) return "failed";
  return undefined;
}

export function event(
  stream: LogStream,
  kind: RunLogKind,
  content: string,
  options: {
    level?: RunLogLevel;
    status?: RunLogStatus;
    title?: string;
    groupId?: string;
  } = {}
): AgentRunEventDraft {
  return {
    stream,
    kind,
    level: options.level ?? (kind === "error" ? "error" : kind === "warning" ? "warning" : "info"),
    status: options.status,
    title: options.title,
    content,
    groupId: options.groupId
  };
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function fallbackEvent(stream: ProcessStream, line: string): AgentRunEventDraft[] {
  const content = stripAnsi(line).trimEnd();
  if (!content.trim()) return [];
  if (/\b(?:fatal|error|failed|exception|panic)\b/i.test(content)) {
    return [event(stream, "error", content, { level: "error" })];
  }
  if (/\b(?:warn|warning|retry|retrying)\b/i.test(content)) {
    return [event(stream, "warning", content, { level: "warning" })];
  }
  return [event(stream, "raw", content, { level: stream === "stderr" ? "debug" : "info" })];
}

/**
 * 为各 adapter 提供增量 JSONL 解码。无法识别的行不会丢弃，而是降级为 raw 事件。
 * adapter 通过 mapper 上下文的 reportUsage 回调上报 token 用量，
 * parser 内部保留最后一次（多次 turn.completed 取最后一次）。
 */
export function createJsonLineParser(mapJson: JsonMapper): AgentOutputParser {
  const buffers: Record<ProcessStream, string> = { stdout: "", stderr: "" };
  let detectedSessionId: string | null = null;
  let lastUsage: TokenUsage | null = null;
  const reportUsage = (usage: TokenUsage) => {
    lastUsage = usage;
  };

  const parseLine = (stream: ProcessStream, line: string): AgentRunEventDraft[] => {
    const clean = stripAnsi(line).trim();
    if (!clean) return [];
    try {
      const parsed: unknown = JSON.parse(clean);
      if (isRecord(parsed)) {
        detectedSessionId ??= findSessionId(parsed);
        const mapped = mapJson(parsed, stream, { reportUsage });
        if (mapped.length > 0) return mapped;
      }
    } catch {
      // 非 JSON 或尚不兼容的新事件格式由 raw 事件完整保留。
    }
    detectedSessionId ??= findSessionIdInText(clean);
    return fallbackEvent(stream, line);
  };

  const drain = (stream: ProcessStream, chunk: string, final: boolean): AgentRunEventDraft[] => {
    const input = `${buffers[stream]}${chunk}`;
    const parts = input.split(/\r\n|\n|\r/);
    buffers[stream] = final ? "" : (parts.pop() ?? "");
    const events = parts.flatMap((line) => parseLine(stream, line));

    if (final && buffers[stream]) {
      events.push(...parseLine(stream, buffers[stream]));
      buffers[stream] = "";
    } else if (buffers[stream].length > MAX_PENDING_CHARS) {
      events.push(...fallbackEvent(stream, buffers[stream]));
      buffers[stream] = "";
    }
    return events;
  };

  return {
    push: (stream, chunk) => drain(stream, chunk, false),
    flush: (stream) => {
      const pending = buffers[stream];
      buffers[stream] = "";
      return pending ? parseLine(stream, pending) : [];
    },
    sessionId: () => detectedSessionId,
    usage: () => lastUsage
  };
}

import type { TokenUsage } from "@maple/protocol";
import type { AgentOutputParser, AgentRunEventDraft, CodingAgentAdapter } from "./types";
import { collectKimiWireUsage } from "./kimi-wire-usage";
import {
  classifyTool,
  compactJson,
  createJsonLineParser,
  event,
  extractText,
  isRecord,
  numberValue,
  stringValue
} from "./output-parser";

/** 从 meta 事件里探测 usage（Kimi wire 风格 + OpenAI 风格字段名兼容）。 */
function reportUsageFromEvent(
  value: Record<string, unknown>,
  reportUsage: (usage: TokenUsage) => void
): void {
  const usageRecord = isRecord(value.usage) ? value.usage : null;
  if (!usageRecord) return;
  const inputTokens =
    (numberValue(usageRecord.inputOther) ?? 0) +
    (numberValue(usageRecord.inputCacheCreation) ?? 0) +
    (numberValue(usageRecord.prompt_tokens) ?? 0) +
    (numberValue(usageRecord.input_tokens) ?? 0);
  const cachedInputTokens =
    numberValue(usageRecord.inputCacheRead) ??
    numberValue(usageRecord.cached_input_tokens) ??
    numberValue(usageRecord.cached_tokens) ??
    0;
  const outputTokens =
    numberValue(usageRecord.output) ??
    numberValue(usageRecord.completion_tokens) ??
    numberValue(usageRecord.output_tokens) ??
    0;
  if (!inputTokens && !cachedInputTokens && !outputTokens) return;
  reportUsage({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0
  });
}

function toolCallEvents(value: unknown, stream: "stdout" | "stderr"): AgentRunEventDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((call): AgentRunEventDraft[] => {
    if (!isRecord(call)) return [];
    const fn = isRecord(call.function) ? call.function : call;
    const name = stringValue(fn.name) ?? "工具调用";
    return [
      event(stream, classifyTool(name), extractText(fn.arguments) || compactJson(fn), {
        title: name,
        groupId: stringValue(call.id),
        status: "started"
      })
    ];
  });
}

export const kimiAdapter: CodingAgentAdapter = {
  kind: "kimi",
  label: "Kimi",
  buildCommand(prompt, env, options) {
    const model = env.MAPLE_KIMI_MODEL?.trim();
    return {
      executable: env.MAPLE_KIMI_BIN?.trim() || "kimi",
      args: [
        ...(model ? ["--model", model] : []),
        ...(options?.resumeSessionId ? ["--session", options.resumeSessionId] : []),
        ...(options?.additionalWritableDirectories ?? []).flatMap((directory) => ["--add-dir", directory]),
        // Kimi CLI 禁止 --prompt 与 --auto / --plan / --yolo 组合；
        // 非交互 prompt 模式下工具调用本身即自动执行，无需（也无法）显式指定权限模式。
        "--prompt",
        prompt,
        "--output-format",
        "stream-json"
      ]
    };
  },
  createOutputParser(): AgentOutputParser {
    const base = createJsonLineParser((value, stream, ctx) => {
      const role = stringValue(value.role);
      if (role === "assistant") {
        const events = toolCallEvents(value.tool_calls, stream);
        const content = extractText(value.content);
        if (content) events.unshift(event(stream, "assistant", content, { status: "completed" }));
        return events;
      }
      if (role === "tool") {
        const failed = value.is_error === true || value.error !== undefined;
        return [
          event(stream, "tool_result", extractText(value.content ?? value.error) || compactJson(value), {
            title: failed ? "工具执行失败" : "工具执行完成",
            groupId: stringValue(value.tool_call_id),
            status: failed ? "failed" : "completed",
            level: failed ? "error" : "info"
          })
        ];
      }
      if (role === "meta") {
        // 防御性：若未来 Kimi 在 stdout 的 meta 事件补了 usage，直接接住，不必依赖文件。
        reportUsageFromEvent(value, ctx.reportUsage);
        const type = stringValue(value.type) ?? "meta";
        const retrying = type === "turn.step.retrying";
        return [
          event(stream, retrying ? "warning" : "lifecycle", extractText(value.content ?? value.error_message) || compactJson(value), {
            title: retrying ? "请求重试" : type,
            status: retrying ? "progress" : "completed",
            level: retrying ? "warning" : "debug"
          })
        ];
      }
      return [];
    });
    // Kimi 默认不在 stdout 输出 usage，进程结束后从 session 归档文件补全。
    return {
      ...base,
      finalize: ({ sessionId }) => collectKimiWireUsage(sessionId) ?? base.usage()
    };
  }
};

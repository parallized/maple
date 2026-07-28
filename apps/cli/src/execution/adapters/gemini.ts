import type { TokenUsage } from "@maple/protocol";
import type { CodingAgentAdapter } from "./types";
import {
  classifyTool,
  compactJson,
  createJsonLineParser,
  event,
  extractText,
  isRecord,
  nestedRecord,
  normalizeStatus,
  numberValue,
  stringValue
} from "./output-parser";

/**
 * 从 result 事件的 usage_metadata 提取 token 用量并上报。
 * Gemini 字段：prompt_token_count / candidates_token_count / cached_content_token_count / thoughts_token_count。
 */
function reportResultUsage(
  value: Record<string, unknown>,
  reportUsage: (usage: TokenUsage) => void
): void {
  const usageRecord = isRecord(value.usage_metadata) ? value.usage_metadata : null;
  if (!usageRecord) return;
  const inputTokens = numberValue(usageRecord.prompt_token_count) ?? 0;
  const cachedInputTokens = numberValue(usageRecord.cached_content_token_count) ?? 0;
  const outputTokens = numberValue(usageRecord.candidates_token_count) ?? 0;
  const reasoningOutputTokens = numberValue(usageRecord.thoughts_token_count) ?? 0;
  if (!inputTokens && !cachedInputTokens && !outputTokens && !reasoningOutputTokens) return;
  reportUsage({ inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens });
}

export const geminiAdapter: CodingAgentAdapter = {
  kind: "gemini",
  label: "Gemini",
  buildCommand(prompt, env, options) {
    const model = env.MAPLE_GEMINI_MODEL?.trim();
    return {
      executable: env.MAPLE_GEMINI_BIN?.trim() || "gemini",
      args: [
        ...(model ? ["--model", model] : []),
        ...(options?.resumeSessionId ? ["--resume", options.resumeSessionId] : []),
        ...(options?.additionalWritableDirectories ?? []).flatMap((directory) => ["--include-directories", directory]),
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        `--approval-mode=${options?.readOnly ? "plan" : "yolo"}`
      ]
    };
  },
  createOutputParser() {
    return createJsonLineParser((value, stream, ctx) => {
      const type = stringValue(value.type);
      if (type === "init") {
        const model = stringValue(value.model) ?? stringValue(nestedRecord(value, "session")?.model);
        return [event(stream, "lifecycle", model ? `使用模型 ${model}` : "Gemini 会话已创建。", { title: "会话已创建", status: "started" })];
      }
      if (type === "message") {
        const role = stringValue(value.role) ?? stringValue(nestedRecord(value, "message")?.role);
        const content = extractText(value.content ?? value.message ?? value.delta);
        return role === "assistant" && content
          ? [event(stream, "assistant", content, { status: "progress" })]
          : [];
      }
      if (type === "tool_use") {
        const name = stringValue(value.name) ?? stringValue(value.tool_name) ?? "工具调用";
        return [
          event(stream, classifyTool(name), compactJson(value.parameters ?? value.args ?? value), {
            title: name,
            groupId: stringValue(value.id ?? value.tool_call_id),
            status: normalizeStatus(value.status) ?? "started"
          })
        ];
      }
      if (type === "tool_result") {
        const failed = normalizeStatus(value.status) === "failed" || value.is_error === true || value.error !== undefined;
        return [
          event(stream, "tool_result", extractText(value.output ?? value.result ?? value.error ?? value), {
            title: failed ? "工具执行失败" : "工具执行完成",
            groupId: stringValue(value.id ?? value.tool_call_id),
            status: failed ? "failed" : "completed",
            level: failed ? "error" : "info"
          })
        ];
      }
      if (type === "result") {
        reportResultUsage(value, ctx.reportUsage);
        const response = extractText(value.response);
        return [
          ...(response ? [event(stream, "assistant", response, { status: "completed" })] : []),
          event(stream, "lifecycle", "Gemini 执行完成。", { title: "执行完成", status: "completed" })
        ];
      }
      if (type === "error") {
        return [event(stream, "error", extractText(value) || compactJson(value), { status: "failed" })];
      }
      return [];
    });
  }
};

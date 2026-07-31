import type { TokenUsage } from "@maple/protocol";
import type { AgentRunEventDraft, CodingAgentAdapter } from "./types";
import {
  classifyTool,
  compactJson,
  createJsonLineParser,
  event,
  extractText,
  isRecord,
  nestedRecord,
  numberValue,
  stringValue
} from "./output-parser";

/**
 * 从 result 事件的 usage 对象提取 token 用量并上报。
 * Claude Code 的字段：input_tokens / cache_creation_input_tokens / cache_read_input_tokens / output_tokens。
 * cache_creation 计入 inputTokens（缓存写入也是消耗的输入），cache_read 计入 cachedInputTokens。
 */
function reportResultUsage(
  value: Record<string, unknown>,
  reportUsage: (usage: TokenUsage) => void
): void {
  const usageRecord = isRecord(value.usage) ? value.usage : null;
  if (!usageRecord) return;
  const inputTokens =
    (numberValue(usageRecord.input_tokens) ?? 0) +
    (numberValue(usageRecord.cache_creation_input_tokens) ?? 0);
  const cachedInputTokens = numberValue(usageRecord.cache_read_input_tokens) ?? 0;
  const outputTokens = numberValue(usageRecord.output_tokens) ?? 0;
  if (!inputTokens && !cachedInputTokens && !outputTokens) return;
  reportUsage({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0
  });
}

function contentBlockEvents(value: unknown, stream: "stdout" | "stderr"): AgentRunEventDraft[] {
  const blocks = Array.isArray(value) ? value : [value];
  return blocks.flatMap((block): AgentRunEventDraft[] => {
    if (!isRecord(block)) return [];
    const type = stringValue(block.type);
    if (type === "text") {
      const content = extractText(block.text);
      return content ? [event(stream, "assistant", content, { status: "completed" })] : [];
    }
    if (type === "thinking") {
      const content = extractText(block.thinking ?? block.text);
      return content ? [event(stream, "reasoning", content, { level: "debug", status: "completed" })] : [];
    }
    if (type === "tool_use") {
      const name = stringValue(block.name) ?? "工具调用";
      return [
        event(stream, classifyTool(name), compactJson(block.input ?? block), {
          title: name,
          groupId: stringValue(block.id),
          status: "started"
        })
      ];
    }
    if (type === "tool_result") {
      const failed = block.is_error === true;
      return [
        event(stream, "tool_result", extractText(block.content) || compactJson(block), {
          title: failed ? "工具执行失败" : "工具执行完成",
          groupId: stringValue(block.tool_use_id),
          status: failed ? "failed" : "completed",
          level: failed ? "error" : "info"
        })
      ];
    }
    return [];
  });
}

export const claudeAdapter: CodingAgentAdapter = {
  kind: "claude",
  label: "Claude",
  buildCommand(prompt, env, options) {
    const model = env.MAPLE_CLAUDE_MODEL?.trim();
    const effort = env.MAPLE_CLAUDE_EFFORT?.trim();
    return {
      executable: env.MAPLE_CLAUDE_BIN?.trim() || "claude",
      args: [
        "--print",
        ...(env.MAPLE_MCP_CONFIG?.trim() ? ["--mcp-config", env.MAPLE_MCP_CONFIG.trim()] : []),
        ...(model ? ["--model", model] : []),
        ...(effort ? ["--effort", effort] : []),
        ...(options?.resumeSessionId ? ["--resume", options.resumeSessionId] : []),
        ...(options?.additionalWritableDirectories ?? []).flatMap((directory) => ["--add-dir", directory]),
        "--permission-mode",
        options?.readOnly ? "plan" : "auto",
        "--verbose",
        "--output-format",
        "stream-json",
        prompt
      ]
    };
  },
  createOutputParser() {
    return createJsonLineParser((value, stream, ctx) => {
      const type = stringValue(value.type);
      if (type === "system") {
        const subtype = stringValue(value.subtype) ?? "system";
        return [event(stream, "lifecycle", `Claude ${subtype}`, { title: "会话初始化", status: "started" })];
      }
      if (type === "assistant" || type === "user") {
        const message = nestedRecord(value, "message") ?? value;
        return contentBlockEvents(message.content, stream);
      }
      if (type === "result") {
        reportResultUsage(value, ctx.reportUsage);
        const failed = value.is_error === true || stringValue(value.subtype)?.includes("error") === true;
        const content = extractText(value.result ?? value.error ?? value) || compactJson(value);
        return [
          event(stream, failed ? "error" : "lifecycle", content, {
            title: failed ? "执行失败" : "执行完成",
            status: failed ? "failed" : "completed",
            level: failed ? "error" : "info"
          })
        ];
      }
      if (type === "error") {
        return [event(stream, "error", extractText(value) || compactJson(value), { status: "failed" })];
      }
      return [];
    });
  }
};

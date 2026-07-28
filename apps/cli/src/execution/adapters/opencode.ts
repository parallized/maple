import type { AgentOutputParser, CodingAgentAdapter } from "./types";
import {
  classifyTool,
  compactJson,
  createJsonLineParser,
  event,
  extractText,
  isRecord,
  nestedRecord,
  normalizeStatus,
  stringValue
} from "./output-parser";

export function createOpenCodeOutputParser(): AgentOutputParser {
  return createJsonLineParser((value, stream) => {
    const type = stringValue(value.type);
    const part = nestedRecord(value, "part");

    if (type === "text" && part) {
      const content = extractText(part.text);
      return content ? [event(stream, "assistant", content, { status: "completed", groupId: stringValue(part.id) })] : [];
    }
    if (type === "reasoning" && part) {
      const content = extractText(part.text);
      return content
        ? [event(stream, "reasoning", content, { level: "debug", status: "completed", groupId: stringValue(part.id) })]
        : [];
    }
    if (type === "tool_use" && part) {
      const state = nestedRecord(part, "state");
      const name = stringValue(part.tool) ?? "工具调用";
      const status = normalizeStatus(state?.status) ?? (state?.error !== undefined ? "failed" : "completed");
      const details = state?.output ?? state?.error ?? state?.input ?? part;
      return [
        event(stream, classifyTool(name), extractText(details) || compactJson(details), {
          title: name,
          groupId: stringValue(part.id),
          status,
          level: status === "failed" ? "error" : "info"
        })
      ];
    }
    if (type === "step_start") {
      return [
        event(stream, "lifecycle", part ? compactJson(part) : "开始执行步骤。", {
          title: "步骤开始",
          status: "started",
          groupId: part ? stringValue(part.id) : undefined
        })
      ];
    }
    if (type === "step_finish") {
      return [
        event(stream, "lifecycle", part ? compactJson(part) : "执行步骤完成。", {
          title: "步骤完成",
          status: "completed",
          groupId: part ? stringValue(part.id) : undefined
        })
      ];
    }
    if (type === "error") {
      const errorValue = value.error;
      return [event(stream, "error", extractText(errorValue) || compactJson(errorValue ?? value), { status: "failed" })];
    }

    // 兼容 OpenCode SDK 直接输出 message.part.updated 的情形。
    if (type === "message.part.updated") {
      const properties = nestedRecord(value, "properties");
      const updatedPart = properties && isRecord(properties.part) ? properties.part : undefined;
      if (!updatedPart) return [];
      const partType = stringValue(updatedPart.type);
      if (partType === "text") {
        const content = extractText(updatedPart.text);
        return content ? [event(stream, "assistant", content, { status: "progress", groupId: stringValue(updatedPart.id) })] : [];
      }
    }
    return [];
  });
}

export const opencodeAdapter: CodingAgentAdapter = {
  kind: "opencode",
  label: "OpenCode",
  buildCommand(prompt, env, options) {
    const model = env.MAPLE_OPENCODE_MODEL?.trim();
    return {
      executable: env.MAPLE_OPENCODE_BIN?.trim() || "opencode",
      args: [
        "run",
        ...(options?.readOnly ? [] : ["--auto"]),
        "--format",
        "json",
        ...(model ? ["--model", model] : []),
        ...(options?.resumeSessionId ? ["--session", options.resumeSessionId] : []),
        prompt
      ]
    };
  },
  createOutputParser: createOpenCodeOutputParser
};

import type { CodingAgentAdapter } from "./types";
import {
  classifyTool,
  compactJson,
  createJsonLineParser,
  event,
  extractText,
  nestedRecord,
  normalizeStatus,
  stringValue
} from "./output-parser";

export const iflowAdapter: CodingAgentAdapter = {
  kind: "iflow",
  label: "iFlow",
  buildCommand(prompt, env, options) {
    const model = env.MAPLE_IFLOW_MODEL?.trim();
    return {
      executable: env.MAPLE_IFLOW_BIN?.trim() || "iflow",
      args: [
        ...(model ? ["--model", model] : []),
        ...(options?.resumeSessionId ? ["--resume", options.resumeSessionId] : []),
        ...(options?.additionalWritableDirectories ?? []).flatMap((directory) => ["--include-directories", directory]),
        "-p",
        prompt,
        ...(options?.readOnly ? [] : ["--yolo"]),
        "--stream",
        "--debug"
      ]
    };
  },
  createOutputParser() {
    return createJsonLineParser((value, stream) => {
      const type = stringValue(value.type) ?? stringValue(value.event);
      const role = stringValue(value.role) ?? stringValue(nestedRecord(value, "message")?.role);
      if (role === "assistant" || type === "assistant" || type === "message") {
        const content = extractText(value.content ?? value.message ?? value.delta);
        return content ? [event(stream, "assistant", content, { status: "progress" })] : [];
      }
      if (type === "thinking" || type === "reasoning") {
        const content = extractText(value);
        return content ? [event(stream, "reasoning", content, { level: "debug", status: "progress" })] : [];
      }
      if (type === "tool_use" || type === "tool_call") {
        const name = stringValue(value.name) ?? stringValue(value.tool) ?? "工具调用";
        return [
          event(stream, classifyTool(name), compactJson(value.input ?? value.args ?? value), {
            title: name,
            groupId: stringValue(value.id ?? value.tool_call_id),
            status: normalizeStatus(value.status) ?? "started"
          })
        ];
      }
      if (type === "tool_result") {
        const status = normalizeStatus(value.status)
          ?? (value.is_error === true || value.error !== undefined ? "failed" : "completed");
        return [
          event(stream, "tool_result", extractText(value.output ?? value.result ?? value.error ?? value), {
            title: status === "failed" ? "工具执行失败" : "工具执行完成",
            groupId: stringValue(value.id ?? value.tool_call_id),
            status,
            level: status === "failed" ? "error" : "info"
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

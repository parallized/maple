import type { TokenUsage } from "@maple/protocol";
import type { CodingAgentAdapter } from "./types";
import { normalizeCodexUsage } from "../usage-delta";
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

function itemEvents(value: Record<string, unknown>) {
  const item = nestedRecord(value, "item");
  if (!item) return [];
  const itemType = stringValue(item.type) ?? "item";
  const groupId = stringValue(item.id);
  const status = normalizeStatus(item.status) ?? (value.type === "item.started" ? "started" : "completed");

  if (itemType === "agent_message") {
    const content = extractText(item.text ?? item.content ?? item);
    return content ? [event("stdout", "assistant", content, { status: "completed", groupId })] : [];
  }
  if (itemType === "reasoning") {
    const content = extractText(item.text ?? item.content ?? item);
    return content ? [event("stdout", "reasoning", content, { level: "debug", status, groupId })] : [];
  }
  if (itemType === "command_execution") {
    const command = extractText(item.command) || "执行命令";
    const output = extractText(item.aggregated_output ?? item.output);
    return [
      event("stdout", "command", output ? `${command}\n${output}` : command, {
        title: command.split(/\r?\n/, 1)[0]?.slice(0, 240),
        status,
        level: status === "failed" ? "error" : "info",
        groupId
      })
    ];
  }
  if (itemType === "file_change") {
    return [
      event("stdout", "file_change", compactJson(item.changes ?? item), {
        title: "文件修改",
        status,
        groupId
      })
    ];
  }
  if (itemType === "mcp_tool_call" || itemType === "web_search" || itemType === "tool_call") {
    const toolName = stringValue(item.tool) ?? stringValue(item.name) ?? itemType;
    return [
      event("stdout", classifyTool(toolName), compactJson(item), {
        title: toolName,
        status,
        level: status === "failed" ? "error" : "info",
        groupId
      })
    ];
  }
  return [];
}

export function createCodexOutputParser(label = "Codex") {
  return createJsonLineParser((value, stream, ctx) => {
    const type = stringValue(value.type);
    if (type === "thread.started") {
      return [event(stream, "lifecycle", `${label} 会话已创建。`, { title: "会话已创建", status: "started" })];
    }
    if (type === "turn.started") {
      return [event(stream, "lifecycle", "开始处理任务。", { title: "开始执行", status: "started" })];
    }
    if (type === "turn.completed") {
      const usageRecord = isRecord(value.usage) ? value.usage : null;
      const usage: TokenUsage | null = usageRecord
        ? normalizeCodexUsage({
            inputTokens: numberValue(usageRecord.input_tokens) ?? 0,
            cachedInputTokens: numberValue(usageRecord.cached_input_tokens) ?? 0,
            outputTokens: numberValue(usageRecord.output_tokens) ?? 0,
            reasoningOutputTokens: numberValue(usageRecord.reasoning_output_tokens) ?? 0
          })
        : null;
      if (usage && (
        usage.inputTokens
        || usage.cachedInputTokens
        || usage.outputTokens
        || usage.reasoningOutputTokens
      )) {
        ctx.reportUsage(usage);
      }
      const usageText = usageRecord ? `\n${compactJson(value.usage)}` : "";
      return [event(stream, "lifecycle", `任务处理完成。${usageText}`, { title: "执行完成", status: "completed" })];
    }
    if (type === "turn.failed" || type === "error") {
      return [event(stream, "error", extractText(value) || compactJson(value), { status: "failed" })];
    }
    if (type === "item.started" || type === "item.updated" || type === "item.completed") {
      return itemEvents(value).map((entry) => ({ ...entry, stream }));
    }
    return [];
  });
}

/** 后台 Agent 没有交互式审批入口，因此权限必须由 Maple 在启动时明确收口。 */
export const CODEX_AUTOMATION_PREFIX = ["--ask-for-approval", "never", "exec"] as const;

export const codexAdapter: CodingAgentAdapter = {
  kind: "codex",
  label: "Codex",
  buildCommand(prompt, env, options) {
    const model = env.MAPLE_CODEX_MODEL?.trim();
    const reasoningEffort = options?.reasoningEffort?.trim()
      || env.MAPLE_CODEX_REASONING_EFFORT?.trim();
    const resume = options?.resumeSessionId
      ? ["resume", options.resumeSessionId, "-"]
      : ["-"];
    const mcpCommand = options?.disableMcp ? undefined : env.MAPLE_MCP_COMMAND?.trim();
    const mcpArgs = options?.disableMcp ? undefined : env.MAPLE_MCP_ARGS?.trim();
    return {
      executable: env.MAPLE_CODEX_BIN?.trim() || "codex",
      args: [
        ...CODEX_AUTOMATION_PREFIX,
        ...(model ? ["--model", model] : []),
        ...(reasoningEffort ? ["--config", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`] : []),
        ...(mcpCommand ? ["--config", `mcp_servers.maple.command=${JSON.stringify(mcpCommand)}`] : []),
        ...(mcpCommand && mcpArgs ? ["--config", `mcp_servers.maple.args=${mcpArgs}`] : []),
        "--sandbox",
        options?.readOnly ? "read-only" : "workspace-write",
        ...(options?.additionalWritableDirectories ?? []).flatMap((directory) => ["--add-dir", directory]),
        "--skip-git-repo-check",
        "--json",
        ...resume
      ],
      ...(options?.isolatedHome ? { env: { CODEX_HOME: options.isolatedHome } } : {}),
      stdin: prompt
    };
  },
  createOutputParser: () => createCodexOutputParser()
};

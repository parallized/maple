import type { RunLogEntry, RunLogKind } from "@maple/protocol";

const KIND_LABELS: Record<Exclude<RunLogKind, "assistant" | "raw">, string> = {
  lifecycle: "系统",
  reasoning: "思考",
  tool: "工具",
  tool_result: "工具结果",
  command: "命令",
  file_change: "文件",
  warning: "警告",
  error: "错误"
};

/**
 * 将结构化运行事件降级为稳定的纯文本表示。
 * 新 TUI 可以直接消费事件字段；经典终端和当前日志面板共用这里，避免各自猜测 provider 输出格式。
 */
export function formatRunLogEntry(entry: RunLogEntry): string {
  if (entry.kind === "assistant" || entry.kind === "raw") return entry.content;

  const label = KIND_LABELS[entry.kind];
  const heading = entry.title && entry.title !== label ? `${label} · ${entry.title}` : label;
  return entry.content ? `[${heading}] ${entry.content}` : `[${heading}]`;
}

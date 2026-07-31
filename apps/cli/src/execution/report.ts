import type { AgentRunEventDraft } from "./adapters/types";

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

/** 保留完整 Markdown，只移除终端控制符并统一换行。 */
export function normalizeExecutionReport(value: string): string {
  return stripAnsi(value).replace(/\r\n?/g, "\n").trim();
}

/**
 * 各 Provider 会输出多轮说明；执行报告只取最后一段完整回复。
 * 对只提供 delta 的 Provider，则连续拼接最后一组流式片段。
 */
export class ExecutionReportCollector {
  private candidate = "";
  private collectingProgress = false;

  push(event: AgentRunEventDraft): void {
    if (event.kind !== "assistant") {
      this.collectingProgress = false;
      return;
    }

    if (event.status === "progress") {
      this.candidate = this.collectingProgress ? `${this.candidate}${event.content}` : event.content;
      this.collectingProgress = true;
      return;
    }

    this.candidate = event.content;
    this.collectingProgress = false;
  }

  value(): string {
    return normalizeExecutionReport(this.candidate);
  }
}

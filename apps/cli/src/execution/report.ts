import type { Todo } from "@maple/protocol";
import type { AgentRunEventDraft } from "./adapters/types";

export const MAX_EXECUTION_REPORT_CHARS = 300;
export type ExecutionReportLimit = 30 | 100 | typeof MAX_EXECUTION_REPORT_CHARS;

type ReportTodo = Pick<Todo, "title" | "details"> & Partial<Pick<Todo, "tags">>;

const SIMPLE_REPORT_CHARS: ExecutionReportLimit = 30;
const NORMAL_REPORT_CHARS: ExecutionReportLimit = 100;
const COMPLEX_REPORT_CHARS: ExecutionReportLimit = MAX_EXECUTION_REPORT_CHARS;

const SIMPLE_TAGS = new Set(["简单", "简单任务", "simple"]);
const NORMAL_TAGS = new Set(["一般", "一般任务", "普通", "normal"]);
const COMPLEX_TAGS = new Set(["复杂", "复杂任务", "complex"]);
const COMPLEX_SCOPE_PATTERN = /重构|迁移|架构|全量|端到端|跨平台|多模块|多项目|数据库迁移|大版本|完整(?:系统|平台|流程)|整体(?:改造|升级)|从零(?:实现|搭建)|重新设计|发布|发版/i;
const LIST_ITEM_PATTERN = /(?:^|\n)\s*(?:[-*+]\s+|\d+[.)、]\s*)/g;

function characterCount(value: string): number {
  return Array.from(value).length;
}

/** 在没有独立复杂度字段时，根据显式标签与 Todo 范围确定硬性报告上限。 */
export function resolveExecutionReportLimit(todo: ReportTodo): ExecutionReportLimit {
  const tags = (todo.tags ?? []).map((tag) => tag.trim().toLowerCase().replace(/\s+/g, ""));
  if (tags.some((tag) => COMPLEX_TAGS.has(tag))) return COMPLEX_REPORT_CHARS;
  if (tags.some((tag) => NORMAL_TAGS.has(tag))) return NORMAL_REPORT_CHARS;
  if (tags.some((tag) => SIMPLE_TAGS.has(tag))) return SIMPLE_REPORT_CHARS;

  const title = todo.title.trim();
  const details = todo.details.trim();
  const scope = `${title}\n${details}`.trim();
  const requirementCount = scope.match(LIST_ITEM_PATTERN)?.length ?? 0;
  if (
    COMPLEX_SCOPE_PATTERN.test(scope)
    || characterCount(details) > 600
    || requirementCount >= 4
  ) {
    return COMPLEX_REPORT_CHARS;
  }

  if (characterCount(scope) <= 80 && scope.split("\n").length <= 2 && requirementCount <= 1) {
    return SIMPLE_REPORT_CHARS;
  }
  return NORMAL_REPORT_CHARS;
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

/** 保留 Markdown 原文，只做空白归一化和最终长度兜底。 */
export function compactExecutionReport(
  value: string,
  maxChars = MAX_EXECUTION_REPORT_CHARS
): string {
  const normalized = stripAnsi(value).replace(/\r\n/g, "\n").trim();
  const chars = Array.from(normalized);
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  if (chars.length <= limit) return normalized;
  if (limit === 0) return "";

  const clipped = chars.slice(0, limit);
  let boundary = -1;
  for (let index = 0; index < clipped.length; index += 1) {
    if (/[。！？!?；;]/.test(clipped[index]!)) boundary = index + 1;
    else if (clipped[index] === "\n") boundary = index;
  }
  return clipped.slice(0, boundary > 0 ? boundary : limit).join("").trimEnd();
}

/**
 * 各 Provider 会输出多轮说明；执行报告只取最后一段完整回复。
 * 对只提供 delta 的 Provider，则连续拼接最后一组流式片段。
 */
export class ExecutionReportCollector {
  private candidate = "";
  private collectingProgress = false;

  constructor(private readonly maxChars = MAX_EXECUTION_REPORT_CHARS) {}

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
    return compactExecutionReport(this.candidate, this.maxChars);
  }
}

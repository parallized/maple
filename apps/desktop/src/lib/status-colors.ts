import type { TaskStatus } from "../domain";

/** Badge CSS class for a given task status string (supports partial matching for report status) */
export function statusBadgeClass(status: string): string {
  if (status.includes("已完成")) return "ui-badge--success";
  if (status.includes("已阻塞")) return "ui-badge--error";
  if (status.includes("进行中")) return "ui-badge--info";
  if (status.includes("需要更多信息")) return "ui-badge--warning";
  if (status.includes("草稿")) return "ui-badge--draft";
  if (status.includes("队列中") || status.includes("待办") || status.includes("待返工")) return "ui-badge--neutral";
  return "";
}

/** CSS `var()` color string for a given task status (for charts, SVG fills, etc.) */
export function statusColorVar(status: TaskStatus | string): string {
  switch (status) {
    case "已完成": return "var(--color-success)";
    case "已阻塞": return "var(--color-error)";
    case "进行中": return "var(--color-info)";
    case "需要更多信息": return "var(--color-warning)";
    case "草稿": return "var(--color-secondary)";
    case "待办":
    case "待返工":
    case "队列中": return "var(--color-secondary)";
    default: return "var(--color-secondary)";
  }
}

/** Tailwind-style background class for status indicator dots */
export function statusDotClass(status: string): string {
  switch (status) {
    case "已完成": return "bg-(--color-success)";
    case "已阻塞": return "bg-(--color-error)";
    case "进行中": return "bg-(--color-info)";
    case "需要更多信息": return "bg-(--color-warning)";
    case "草稿": return "bg-(--color-secondary) opacity-60";
    default: return "bg-(--color-secondary)";
  }
}

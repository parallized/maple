export const TODO_STATUSES = [
  "draft",
  "todo",
  "rework",
  "queued",
  "running",
  "needs_input",
  "review",
  "done",
  "blocked",
  "cancelled"
] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export const CLAIMABLE_TODO_STATUSES = ["todo", "rework"] as const satisfies readonly TodoStatus[];
export const ACTIVE_TODO_STATUSES = ["queued", "running"] as const satisfies readonly TodoStatus[];
export const MANUAL_TODO_STATUSES = [
  "draft",
  "todo",
  "rework",
  "needs_input",
  "review",
  "done",
  "blocked",
  "cancelled"
] as const satisfies readonly TodoStatus[];

export const TODO_STATUS_LABELS: Record<TodoStatus, { zh: string; en: string }> = {
  draft: { zh: "草稿", en: "Draft" },
  todo: { zh: "待办", en: "Todo" },
  rework: { zh: "待返工", en: "Rework" },
  queued: { zh: "队列中", en: "Queued" },
  running: { zh: "进行中", en: "Running" },
  needs_input: { zh: "需要更多信息", en: "Needs input" },
  review: { zh: "待验收", en: "Review" },
  done: { zh: "已完成", en: "Done" },
  blocked: { zh: "已阻塞", en: "Blocked" },
  cancelled: { zh: "已取消", en: "Cancelled" }
};

export function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && TODO_STATUSES.includes(value as TodoStatus);
}

export function isClaimableTodoStatus(status: TodoStatus): boolean {
  return CLAIMABLE_TODO_STATUSES.includes(status as (typeof CLAIMABLE_TODO_STATUSES)[number]);
}

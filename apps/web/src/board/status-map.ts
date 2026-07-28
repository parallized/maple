import type { TaskStatus } from "@maple/board-ui";
import type { TodoStatus } from "@maple/protocol";

const TASK_TO_TODO: Record<TaskStatus, TodoStatus> = {
  草稿: "draft",
  待办: "todo",
  待返工: "rework",
  队列中: "queued",
  进行中: "running",
  需要更多信息: "needs_input",
  已完成: "done",
  已阻塞: "blocked"
};

/**
 * Server → 看板(入向)。server 独有的 review/cancelled 只做单向映射:
 * review 显示为「已完成」,cancelled 显示为「已阻塞」。
 */
const TODO_TO_TASK: Record<TodoStatus, TaskStatus> = {
  draft: "草稿",
  todo: "待办",
  rework: "待返工",
  queued: "队列中",
  running: "进行中",
  needs_input: "需要更多信息",
  review: "已完成",
  done: "已完成",
  blocked: "已阻塞",
  cancelled: "已阻塞"
};

export function toTaskStatus(todoStatus: TodoStatus): TaskStatus {
  return TODO_TO_TASK[todoStatus];
}

export function toTodoStatus(taskStatus: TaskStatus): TodoStatus {
  return TASK_TO_TODO[taskStatus];
}

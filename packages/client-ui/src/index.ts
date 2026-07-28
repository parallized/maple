import type { TodoStatus, WorkerKind } from "@maple/protocol";

export interface TodoStatusMeta {
  label: string;
  icon: `mingcute:${string}`;
  tone: "neutral" | "primary" | "warning" | "success" | "danger";
}

export const TODO_STATUS_META: Record<TodoStatus, TodoStatusMeta> = {
  draft: { label: "草稿", icon: "mingcute:document-line", tone: "neutral" },
  todo: { label: "待办", icon: "mingcute:checkbox-line", tone: "neutral" },
  rework: { label: "待返工", icon: "mingcute:refresh-2-line", tone: "warning" },
  queued: { label: "队列中", icon: "mingcute:time-line", tone: "primary" },
  running: { label: "进行中", icon: "mingcute:loading-3-line", tone: "primary" },
  needs_input: { label: "需要更多信息", icon: "mingcute:question-line", tone: "warning" },
  review: { label: "待验收", icon: "mingcute:eye-2-line", tone: "warning" },
  done: { label: "已完成", icon: "mingcute:check-circle-line", tone: "success" },
  blocked: { label: "已阻塞", icon: "mingcute:warning-line", tone: "danger" },
  cancelled: { label: "已取消", icon: "mingcute:close-circle-line", tone: "neutral" }
};

export const WORKER_META: Record<WorkerKind, { label: string; icon: `mingcute:${string}` }> = {
  codex: { label: "Codex", icon: "mingcute:code-line" },
  claude: { label: "Claude", icon: "mingcute:chat-1-line" },
  kimi: { label: "Kimi", icon: "mingcute:moon-line" },
  glm: { label: "GLM", icon: "mingcute:ai-line" },
  iflow: { label: "iFlow", icon: "mingcute:route-line" },
  gemini: { label: "Gemini", icon: "mingcute:ai-line" },
  opencode: { label: "OpenCode", icon: "mingcute:terminal-box-line" }
};

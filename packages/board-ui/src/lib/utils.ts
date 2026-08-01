import type { Project, Task, TaskReport, TaskStatus, WorkerKind } from "../domain";
import type { ThemeMode } from "./constants";
import { DEFAULT_BASE_WORKER, WORKER_KINDS } from "./constants";
import { normalizeTagCatalog } from "./tag-catalog";
import { isWslMntPath, wslMntPathToWindowsPath } from "./wsl-path";

export function parseArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function deriveProjectName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "新项目";
}

/** 任务是否处于执行流程中（队列中 → 规划中 → 运行中）。
    优先认服务端 executionPhase；缺失时回退旧 status 判断（本地存储 / 旧 Server）。 */
export function isTaskInFlight(task: Task): boolean {
  if (task.executionPhase) return true;
  return task.status === "队列中" || task.status === "进行中";
}

/** 任务是否因并发已满而排队等待（规划中/队列中，且执行流水线已达到并发上限）。 */
export function isTaskWaitingBlocked(task: Task, tasks: Task[], concurrency: number): boolean {
  if (concurrency < 1) return false;
  if (task.executionPhase !== "planning" && task.executionPhase !== "queued") return false;
  return tasks.filter((item) => isTaskInFlight(item)).length >= concurrency;
}

/**
 * 表格排序：已完成任务沉底（稳定排序，其余保持原顺序）。
 * 返工（改回待办/待返工）的任务会因此自动浮到「最后一个非已完成任务」下方，
 * 即向上越过连续的已完成行。
 */
export function sortTasksByCompletion(tasks: Task[]): Task[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const leftDone = left.task.status === "已完成" ? 1 : 0;
      const rightDone = right.task.status === "已完成" ? 1 : 0;
      return leftDone - rightDone || left.index - right.index;
    })
    .map(({ task }) => task);
}

export function createTask(
  taskTitle: string,
  status: TaskStatus = "待办",
  workerKind: WorkerKind = DEFAULT_BASE_WORKER,
  parentId?: string | null
): Task {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: taskTitle,
    details: "",
    detailsDoc: undefined,
    status,
    parentId: parentId ?? null,
    workerKind,
    needsConfirmation: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
    reports: [],
  };
}

export function createTaskReport(author: string, content: string): TaskReport {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author,
    content,
    createdAt: new Date().toISOString(),
  };
}

export function normalizeProjects(projects: Project[]): Project[] {
  const now = new Date().toISOString();
  return projects
    .map((project) => {
      let directory = (project.directory ?? "").trim();
      if (typeof navigator !== "undefined") {
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes("windows") && isWslMntPath(directory)) {
          directory = wslMntPathToWindowsPath(directory) ?? directory;
        }
      }
      const rawProject = project as Project & Record<string, unknown>;
      let legacyProjectWorker: WorkerKind | undefined =
        typeof rawProject.workerKind === "string" && WORKER_KINDS.some((w) => w.kind === rawProject.workerKind)
          ? (rawProject.workerKind as WorkerKind)
          : undefined;
      if (!legacyProjectWorker && typeof rawProject.workerId === "string") {
        const match = WORKER_KINDS.find((w) => `worker-${w.kind}` === rawProject.workerId);
        if (match) legacyProjectWorker = match.kind;
      }
      const { workerKind: _legacyWorkerKind, workerId: _legacyWorkerId, ...projectBase } = rawProject;
      return {
        ...projectBase,
        directory,
        tagCatalog: normalizeTagCatalog((project as Project).tagCatalog),
        tasks: project.tasks.map((task) => {
          const createdAt =
            typeof task.createdAt === "string" && task.createdAt
              ? task.createdAt
              : now;
          const updatedAt =
            typeof task.updatedAt === "string" && task.updatedAt
              ? task.updatedAt
              : createdAt;
          const status =
            task.status === "队列中" || task.status === "进行中"
              ? ("待办" as const)
              : task.status;
          const details =
            typeof (task as Task).details === "string"
              ? (task as Task).details
              : "";
          const detailsDoc = (task as Task).detailsDoc;
          const needsConfirmation =
            typeof (task as Task).needsConfirmation === "boolean"
              ? Boolean((task as Task).needsConfirmation)
              : false;
          const rawTask = task as Task as Record<string, unknown>;
          const rawWorkerKind = rawTask.workerKind ?? rawTask.targetWorkerKind;
          const workerKind =
            typeof rawWorkerKind === "string" && WORKER_KINDS.some((w) => w.kind === rawWorkerKind)
              ? (rawWorkerKind as WorkerKind)
              : legacyProjectWorker ?? DEFAULT_BASE_WORKER;
          const { targetWorkerKind: _legacyTargetWorkerKind, ...taskBase } = rawTask;
          return {
            ...taskBase,
            id: task.id,
            title: typeof task.title === "string" ? task.title : "",
            tags: Array.isArray(task.tags) ? task.tags : [],
            status,
            details,
            detailsDoc,
            workerKind,
            needsConfirmation,
            createdAt,
            updatedAt,
            reports: Array.isArray(task.reports) ? task.reports : [],
          };
        }),
      };
    })
    .filter((project) => project.directory.length > 0);
}

export function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (mode === "light") root.classList.add("light");
  else if (mode === "dark") root.classList.add("dark");
}

export type TimeLevel =
  | "just_now"
  | "minutes"
  | "hours"
  | "days"
  | "months"
  | "years";

export function getTimeLevel(dateStr: string): TimeLevel {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "years";
  const diff = now - then;
  if (diff < 0) return "just_now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just_now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return "minutes";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return "hours";
  const days = Math.floor(hours / 24);
  if (days < 30) return "days";
  const months = Math.floor(days / 30);
  if (months < 12) return "months";
  return "years";
}

export function relativeTimeZh(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = now - then;
  if (diff < 0) return "刚刚";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  const years = Math.floor(months / 12);
  return `${years} 年前`;
}

export function getLastMentionTime(task: Task): string {
  if (task.reports.length > 0) {
    const sorted = [...task.reports].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return sorted[0].createdAt;
  }
  return task.createdAt;
}

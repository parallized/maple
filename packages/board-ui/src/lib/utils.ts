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

/**
 * 由 Agent 会话 ID 派生稳定的短标识（调试列 SID）。
 *
 * 同一会话（同一 workflow 续接）必然得到相同结果；不同会话高概率不同。
 * 不能直接取会话 ID 前缀：Codex / DeepSeek 的会话 ID 是带时间戳的 UUIDv7，
 * 同一时期创建的会话前几位完全相同，导致调试列 SID 全部一致、无法区分。
 */
export function sessionSid(sessionId: string): string {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let index = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 6);
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

export type TaskWaitingKind = "concurrency" | "serial" | null;

/**
 * 任务处于执行流水线（规划中/队列中）时的等待原因：
 * - "serial"：同一工作流有前序任务在跑，等待串行执行；
 * - "concurrency"：并发已满，等待空闲名额；
 * - null：不等待。
 */
export function taskWaitingKind(task: Task, tasks: Task[], concurrency: number): TaskWaitingKind {
  if (task.executionPhase !== "planning" && task.executionPhase !== "queued") return null;
  if (task.serialBlocked) return "serial";
  if (concurrency >= 1 && tasks.filter((item) => isTaskInFlight(item)).length >= concurrency) return "concurrency";
  return null;
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

/**
 * 行拖拽排序：已完成沉底（保持原相对顺序），未完成区应用手动顺序。
 * 未在手动顺序里的任务（如新建/轮询新出现）维持原顺序插在手动排序项之后。
 */
export function applyManualRowOrder(tasks: Task[], manualRowOrder: string[]): Task[] {
  const sorted = sortTasksByCompletion(tasks);
  if (manualRowOrder.length === 0) return sorted;
  const manualIndex = new Map(manualRowOrder.map((id, index) => [id, index]));
  const active: Task[] = [];
  const done: Task[] = [];
  for (const task of sorted) {
    if (task.status === "已完成") done.push(task);
    else active.push(task);
  }
  active.sort((left, right) => {
    const li = manualIndex.get(left.id);
    const ri = manualIndex.get(right.id);
    if (li !== undefined && ri !== undefined) return li - ri;
    if (li !== undefined) return -1;
    if (ri !== undefined) return 1;
    return 0;
  });
  return [...active, ...done];
}

/**
 * 拖拽落点：把被拖的顶层未完成任务插到目标位置，返回新的手动顺序。
 * 以当前显示顺序为基准（已含历史手动顺序），新出现的任务追加到末尾；
 * 只允许顶层任务参与拖动，已完成任务仍沉底不参与。
 * 无效（拖拽/目标不存在、是子任务或已完成）时返回 null。
 */
export function reorderForDrop(
  tasks: Task[],
  draggedId: string,
  targetId: string,
  currentManualOrder: string[]
): string[] | null {
  const dragged = tasks.find((task) => task.id === draggedId);
  const target = tasks.find((task) => task.id === targetId);
  if (!dragged || !target || dragged.parentId || target.parentId) return null;
  if (dragged.status === "已完成" || target.status === "已完成") return null;

  const activeIds = new Set(
    tasks
      .filter((task) => task.status !== "已完成" && !task.parentId)
      .map((task) => task.id)
  );
  const seen = new Set<string>();
  const current: string[] = [];
  for (const id of currentManualOrder) {
    if (activeIds.has(id) && !seen.has(id)) {
      current.push(id);
      seen.add(id);
    }
  }
  for (const id of activeIds) {
    if (!seen.has(id)) {
      current.push(id);
      seen.add(id);
    }
  }

  const next = current.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggedId);
  return next;
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

/** 任务用时：开始 → 完成的时长，紧凑中文格式（45 秒 / 3 分钟 / 1.5 小时 / 2 天）。 */
export function formatDurationZh(startStr: string, endStr: string): string {
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  if (hours < 24) return `${Number(hours.toFixed(1))} 小时`;
  return `${Math.floor(hours / 24)} 天`;
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

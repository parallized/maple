import type { Project, Task, TaskReport } from "../domain";
import type { ThemeMode } from "./constants";
import { WORKER_KINDS } from "./constants";

export function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split(".").map((part) => Number(part));
  return `${major}.${minor}.${patch + 1}`;
}

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

export function createTask(taskTitle: string, projectVersion: string): Task {
  const nextVersion = bumpPatch(projectVersion);
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: taskTitle,
    details: "",
    status: "待办",
    tags: [],
    version: nextVersion,
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
      const directory = (project.directory ?? "").trim();
      let workerKind = project.workerKind;
      if (!workerKind && (project as Record<string, unknown>).workerId) {
        const legacyId = (project as Record<string, unknown>)
          .workerId as string;
        const match = WORKER_KINDS.find((w) => `worker-${w.kind}` === legacyId);
        if (match) workerKind = match.kind;
      }
      return {
        ...project,
        directory,
        workerKind,
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
            task.status === "队列中" ? ("待办" as const) : task.status;
          const details =
            typeof (task as Task).details === "string"
              ? (task as Task).details
              : "";
          return {
            ...task,
            status,
            details,
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

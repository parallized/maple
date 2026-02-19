import type { Project, Task, TaskReport, WorkerCommandResult } from "../domain";
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
    status: "待办",
    tags: [],
    version: nextVersion,
    createdAt: now,
    updatedAt: now,
    reports: []
  };
}

export function createTaskReport(author: string, content: string): TaskReport {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author,
    content,
    createdAt: new Date().toISOString()
  };
}

export function normalizeProjects(projects: Project[]): Project[] {
  const now = new Date().toISOString();
  return projects
    .map((project) => {
      const directory = (project.directory ?? "").trim();
      let workerKind = project.workerKind;
      if (!workerKind && (project as Record<string, unknown>).workerId) {
        const legacyId = (project as Record<string, unknown>).workerId as string;
        const match = WORKER_KINDS.find((w) => `worker-${w.kind}` === legacyId);
        if (match) workerKind = match.kind;
      }
      return {
        ...project,
        directory,
        workerKind,
        tasks: project.tasks.map((task) => {
          const createdAt = typeof task.createdAt === "string" && task.createdAt ? task.createdAt : now;
          const updatedAt = typeof task.updatedAt === "string" && task.updatedAt ? task.updatedAt : createdAt;
          return {
            ...task,
            createdAt,
            updatedAt,
            reports: Array.isArray(task.reports) ? task.reports : []
          };
        })
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
    const sorted = [...task.reports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sorted[0].createdAt;
  }
  return task.createdAt;
}

function normalizeReportList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

type StructuredWorkerOutput = {
  conclusion: string;
  changes: string[];
  verification: string[];
  tags: string[];
};

function parseStructuredReport(text: string): StructuredWorkerOutput | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const conclusion = typeof parsed.conclusion === "string" ? parsed.conclusion.trim() : "";
    const changes = normalizeReportList(parsed.changes);
    const verification = normalizeReportList(parsed.verification);
    const tags = normalizeReportList(parsed.tags ?? parsed.tag).slice(0, 5);
    if (!conclusion && changes.length === 0 && verification.length === 0 && tags.length === 0) return null;
    return { conclusion, changes, verification, tags };
  } catch {
    return null;
  }
}

function formatSection(title: string, items: string[]): string[] {
  if (items.length === 0) {
    return [title, "- 无"];
  }
  return [title, ...items.map((item) => `- ${item}`)];
}

export function extractWorkerTags(result: WorkerCommandResult): string[] {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const structured = parseStructuredReport(stdout) ?? parseStructuredReport(stderr);
  if (!structured) return [];
  return [...new Set(structured.tags)].slice(0, 5);
}

export function buildConclusionReport(result: WorkerCommandResult, taskTitle: string): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const structured = parseStructuredReport(stdout) ?? parseStructuredReport(stderr);

  if (structured) {
    const conclusion = structured.conclusion || (result.success ? "任务已完成并已归档。" : "任务执行失败。");
    return [
      `任务：${taskTitle}`,
      `执行状态：${result.success ? "成功" : "失败"}`,
      "",
      `结论：${conclusion}`,
      "",
      ...formatSection("变更：", structured.changes),
      "",
      ...formatSection("验证：", structured.verification)
    ].join("\n");
  }

  const rawOutput = stdout || stderr;
  if (rawOutput) {
    const trimmed = rawOutput.length > 4000 ? `${rawOutput.slice(0, 4000)}\n...(输出过长，已截断)` : rawOutput;
    return [
      `任务：${taskTitle}`,
      `执行状态：${result.success ? "成功" : "失败"}`,
      "",
      "结论：已执行并自动归档到 Maple。",
      "",
      "原始输出：",
      trimmed
    ].join("\n");
  }

  return [
    `任务：${taskTitle}`,
    `执行状态：${result.success ? "成功" : "失败"}`,
    "结论：执行完成，但未收到可归档输出。"
  ].join("\n");
}

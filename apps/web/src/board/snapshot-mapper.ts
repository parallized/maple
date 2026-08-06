import {
  WORKER_KINDS,
  type Project,
  type ProjectTokenUsage,
  type RunnerSummary,
  type TagCatalog,
  type Task,
  type WorkerKind as BoardWorkerKind
} from "@maple/board-ui";
import type { DashboardSnapshot, ProjectBinding, Todo, WorkerKind } from "@maple/protocol";
import { toTaskStatus } from "./status-map";

const BOARD_WORKER_KINDS = new Set<WorkerKind>(WORKER_KINDS.map((item) => item.kind));
const FALLBACK_WORKER_KIND: BoardWorkerKind = "claude";

/** 协议 Worker 与看板 Worker 已对齐;无法识别的旧数据回退到基模。 */
function toBoardWorkerKind(kind: WorkerKind | null | undefined): BoardWorkerKind {
  return kind && BOARD_WORKER_KINDS.has(kind) ? (kind as BoardWorkerKind) : FALLBACK_WORKER_KIND;
}

function parseTagCatalog(raw: string | undefined): TagCatalog | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as TagCatalog;
  } catch {
    return undefined;
  }
}

function parseDetailsDoc(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function mapTodoToTask(todo: Todo): Task {
  const summary = todo.resultSummary?.trim();
  const reports = (todo.reports ?? [])
    .map((report) => ({
      id: report.id,
      author: report.author,
      content: report.content,
      createdAt: report.createdAt
    }))
    .filter((report) => report.content.trim().length > 0);
  // 兼容旧 Server / PM 阻塞报告：当前 resultSummary 若不在历史报告里，作为最新一份补在最前。
  if (summary && !reports.some((report) => report.content.trim() === summary)) {
    reports.unshift({
      id: `server-${todo.id}`,
      author: todo.workerKind,
      content: todo.resultSummary as string,
      createdAt: todo.completedAt ?? todo.updatedAt
    });
  }
  return {
    id: todo.id,
    title: todo.title,
    details: todo.details ?? "",
    detailsDoc: parseDetailsDoc(todo.detailsDoc),
    status: toTaskStatus(todo.status),
    parentId: todo.parentId ?? null,
    workerKind: toBoardWorkerKind(todo.workerKind),
    needsConfirmation: false,
    tags: todo.tags ?? [],
    executionPhase: todo.executionPhase ?? null,
    serialBlocked: todo.serialBlocked === true,
    startedAt: todo.startedAt ?? null,
    completedAt: todo.completedAt ?? null,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
    reports,
    usage: todo.usage ?? null,
    sessionId: todo.sessionId ?? null,
    dispatchBrief: todo.dispatchBrief ?? null
  };
}

/**
 * DashboardSnapshot → 看板项目树。
 * order 为 localStorage 保存的项目 id 顺序:已保存的按序排列,新出现的项目插到最前。
 */
export function mapSnapshotToProjects(snapshot: DashboardSnapshot, order: string[]): Project[] {
  const bindingByProject = new Map<string, ProjectBinding>();
  for (const binding of snapshot.bindings) {
    if (!bindingByProject.has(binding.projectId)) bindingByProject.set(binding.projectId, binding);
  }

  const todosByProject = new Map<string, Todo[]>();
  for (const todo of snapshot.todos) {
    const list = todosByProject.get(todo.projectId);
    if (list) list.push(todo);
    else todosByProject.set(todo.projectId, [todo]);
  }

  const usageByProject = new Map<string, ProjectTokenUsage[]>();
  for (const entry of snapshot.tokenUsage ?? []) {
    const list = usageByProject.get(entry.projectId);
    const bucket: ProjectTokenUsage = {
      workerKind: toBoardWorkerKind(entry.workerKind),
      agentRole: entry.agentRole,
      totalTokens:
        entry.inputTokens + entry.cachedInputTokens + entry.outputTokens + entry.reasoningOutputTokens,
      inputTokens: entry.inputTokens,
      cachedInputTokens: entry.cachedInputTokens,
      outputTokens: entry.outputTokens,
      reasoningOutputTokens: entry.reasoningOutputTokens
    };
    if (list) list.push(bucket);
    else usageByProject.set(entry.projectId, [bucket]);
  }

  const projects = snapshot.projects.map((project): Project => {
    const binding = bindingByProject.get(project.id);
    const tasks = (todosByProject.get(project.id) ?? [])
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(mapTodoToTask);
    return {
      id: project.id,
      name: project.name,
      directory: binding?.workspaceLabel || project.repositoryUrl || project.name,
      createdAt: project.createdAt,
      tagCatalog: parseTagCatalog(project.tagCatalog),
      tasks,
      tokenUsage: usageByProject.get(project.id)
    };
  });

  const byId = new Map(projects.map((project) => [project.id, project]));
  const ordered: Project[] = [];
  for (const id of order) {
    const project = byId.get(id);
    if (!project) continue;
    ordered.push(project);
    byId.delete(id);
  }
  // byId 中剩下的即新出现的项目,保持快照顺序插到最前。
  return [...byId.values(), ...ordered];
}

/** DashboardSnapshot → 已连接 CLI 执行端(runner)摘要。 */
export function mapSnapshotToRunners(snapshot: DashboardSnapshot): RunnerSummary[] {
  return snapshot.runners.map((runner): RunnerSummary => ({
    id: runner.id,
    name: runner.name,
    hostname: runner.hostname,
    platform: runner.platform,
    state: runner.state,
    lastSeenAt: runner.lastSeenAt,
    projectIds: runner.projectIds,
    supportedWorkers: runner.supportedWorkers?.filter((kind) => BOARD_WORKER_KINDS.has(kind)) as BoardWorkerKind[] | undefined,
    workerInventory: runner.workerInventory?.flatMap((item) => (
      BOARD_WORKER_KINDS.has(item.kind)
        ? [{
            kind: item.kind as BoardWorkerKind,
            available: item.available,
            modelId: item.modelId,
            modelName: item.modelName,
            reasoningEffort: item.reasoningEffort
          }]
        : []
    ))
  }));
}

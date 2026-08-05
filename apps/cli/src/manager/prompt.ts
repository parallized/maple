import type { ProjectManagerJob } from "@maple/protocol";
import type { ProjectManagerSnapshot } from "./project-snapshot";

/** 全项目标签总量控制：聚焦大模块分类，避免无限新增。 */
const PROJECT_TAG_LIMIT = 30;

export interface ProjectManagerPromptOptions {
  resuming?: boolean;
  includeStableContext?: boolean;
}

function compactHistory(job: ProjectManagerJob): string {
  return JSON.stringify(
    job.history.slice(0, 5).map((item) => ({
      todoId: item.todoId,
      title: item.title.slice(0, 120),
      status: item.status,
      workerKind: item.workerKind,
      workflowId: item.workflowId,
      resultSummary: item.resultSummary?.slice(-240) ?? null
    }))
  );
}

function compactWorkflows(job: ProjectManagerJob): string {
  return JSON.stringify(
    job.workflows.slice(0, 6).map((workflow) => ({
      id: workflow.id,
      workerKind: workflow.workerKind,
      title: workflow.title.slice(0, 100),
      summary: workflow.summary.slice(0, 240)
    }))
  );
}

/** 项目已有标签目录（去重、截断到全项目上限），供 Leader 优先复用。 */
function compactTagCatalog(job: ProjectManagerJob): string {
  if (!job.project.tagCatalog) return "（暂无）";
  try {
    const parsed: unknown = JSON.parse(job.project.tagCatalog);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "（暂无）";
    const tags = Object.keys(parsed).slice(0, PROJECT_TAG_LIMIT);
    return tags.length > 0 ? tags.join("、") : "（暂无）";
  } catch {
    return "（暂无）";
  }
}

function outputLanguageInstruction(job: ProjectManagerJob): string {
  switch (job.executionSettings?.aiOutputLanguage) {
    case "en": return "Use English for every human-readable JSON field.";
    case "zh": return "所有面向用户的 JSON 字段必须使用中文。";
    default: return "输出语言跟随 Todo 与项目现有语言；无法判断时使用中文。";
  }
}

export function buildProjectManagerPrompt(
  job: ProjectManagerJob,
  snapshot: ProjectManagerSnapshot,
  options: ProjectManagerPromptOptions = {}
): string {
  const identity = options.resuming
    ? "续接当前项目经理会话；处理新 Todo，立即返回路由。"
    : "你是 Maple Leader，只负责快速归组和任务分发。";
  const stableContext = options.includeStableContext === false
    ? []
    : [snapshot.stableContext];
  const leaderConstitution = job.executionSettings?.leaderConstitution.trim() ?? "";
  const workerConstitution = job.executionSettings?.constitution.trim() ?? "";
  return [
    identity,
    outputLanguageInstruction(job),
    ...(leaderConstitution ? [`Leader 宪法：${leaderConstitution}`] : []),
    ...(workerConstitution ? [`项目宪法：${workerConstitution.slice(0, 2_000)}`] : []),
    "根据 Todo、Workflow 和最近历史快速判断；不要深度分析、搜索仓库或执行任务。",
    "只读，不修改项目。默认沿用用户指定 Worker（requestedWorkerKind）；仅当宪法明确要求把此类任务交给其他 Worker 时，返回 selectedWorkerKind（必须是「可用 Worker」之一）。",
    "Workflow 是「一个主题/模块」的持续上下文：主题内串行续接、主题间可并行。仅当已有 Workflow 的主题与当前 Todo 属于同一模块时才复用；不同模块/主题必须 NEW，禁止把多个模块堆进同一个 Workflow（否则单会话上下文混杂、token 膨胀）。",
    "同一 Workflow 内 Todo 会按 FIFO 串行并自动续接 Worker session；Workflow 的 Worker 固定，只能复用 workerKind 与 selectedWorkerKind（未指定时取 requestedWorkerKind）一致的 Workflow，否则必须 NEW。",
    "新建 Workflow 时 workflowTitle 用明确的模块/主题名（如「前端设置页」「后端认证」），方便后续任务按主题归拢。",
    "只返回 JSON，不要 Markdown、解释或实施步骤。",
    '{"workflowId":"已有ID或NEW","selectedWorkerKind":"需要按宪法换 Worker 时填可用 Worker，否则省略","workflowTitle":"短标题","workflowSummary":"持续目标摘要","dispatchBrief":"只写必要连续背景，不复述 Todo，不写实施步骤","tags":["标签1","标签2"]}',
    `项目：${job.project.name}`,
    `可用 Worker：${job.availableWorkers.join(", ")}`,
    ...stableContext,
    snapshot.workingState,
    `Workflow：${compactWorkflows(job)}`,
    `历史：${compactHistory(job)}`,
    `已有标签（全项目保持 ${PROJECT_TAG_LIMIT} 个以内）：${compactTagCatalog(job)}`,
    `新 Todo：${JSON.stringify({
      id: job.todo.id,
      title: job.todo.title.slice(0, 240),
      details: job.todo.details.slice(0, 1_200),
      requestedWorkerKind: job.todo.workerKind,
      tags: job.todo.tags
    })}`,
    "给 Todo 打 1-3 个标签（tags）：聚焦项目大模块，优先复用已有标签，全项目不超过 30 个，语言跟随用户。",
    "立即返回派单 JSON。"
  ].join("\n");
}

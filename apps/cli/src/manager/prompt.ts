import type { ProjectManagerJob } from "@maple/protocol";
import type { ProjectManagerSnapshot } from "./project-snapshot";

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
  return [
    identity,
    outputLanguageInstruction(job),
    ...(leaderConstitution ? [`Leader 宪法：${leaderConstitution}`] : []),
    "根据 Todo、Workflow 和最近历史快速判断；不要深度分析、搜索仓库或执行任务。",
    "只读，不修改项目，也不改派用户指定的 Worker。",
    "同一目标、依赖前序结果、涉及相同模块或文件，或共享上下文有价值时，优先复用已有 Workflow；只有任务彼此独立且可安全并发时才新建 Workflow。",
    "同一 Workflow 内 Todo 会按 FIFO 串行并自动续接 Worker session；Workflow 的 Worker 固定，只能复用 workerKind 与当前 Todo requestedWorkerKind 一致的 Workflow，否则必须 NEW。",
    "只返回 JSON，不要 Markdown、解释或实施步骤。",
    '{"workflowId":"已有ID或NEW","workflowTitle":"短标题","workflowSummary":"持续目标摘要","dispatchBrief":"只写必要连续背景，不复述 Todo，不写实施步骤"}',
    `项目：${job.project.name}`,
    `可用 Worker：${job.availableWorkers.join(", ")}`,
    ...stableContext,
    snapshot.workingState,
    `Workflow：${compactWorkflows(job)}`,
    `历史：${compactHistory(job)}`,
    `新 Todo：${JSON.stringify({
      id: job.todo.id,
      title: job.todo.title.slice(0, 240),
      details: job.todo.details.slice(0, 1_200),
      requestedWorkerKind: job.todo.workerKind,
      tags: job.todo.tags
    })}`,
    "立即返回派单 JSON。"
  ].join("\n");
}

import type { ProjectManagerJob } from "@maple/protocol";
import type { ProjectManagerSnapshot } from "./project-snapshot";

export interface ProjectManagerPromptOptions {
  resuming?: boolean;
  includeStableContext?: boolean;
}

function compactHistory(job: ProjectManagerJob): string {
  return JSON.stringify(
    job.history.slice(-5).map((item) => ({
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
    job.workflows.slice(-6).map((workflow) => ({
      id: workflow.id,
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
    ? "续接当前项目经理会话；只处理新 Todo，立即返回路由。"
    : "你是 Maple Leader，只负责快速归组和派单。";
  const stableContext = options.includeStableContext === false
    ? []
    : [snapshot.stableContext];
  const leaderConstitution = job.executionSettings?.leaderConstitution.trim() ?? "";
  return [
    identity,
    outputLanguageInstruction(job),
    ...(leaderConstitution ? [`Leader 宪法（必须遵守）：${leaderConstitution}`] : []),
    "只根据 Todo、Workflow 和最近历史快速判断；不要深度分析、搜索仓库或执行任务。",
    "只读，不修改项目，也不改派用户指定的 Worker。",
    "同一目标复用 Workflow，否则新建；无明确依赖用 parallel，否则 serial。",
    "只返回 JSON，不要 Markdown、解释或实施步骤。",
    '{"workflowId":"已有ID或NEW","workflowTitle":"短标题","workflowSummary":"持续目标摘要","executionMode":"serial或parallel","dispatchBrief":"只写必要连续背景，不复述 Todo，不写实施步骤"}',
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

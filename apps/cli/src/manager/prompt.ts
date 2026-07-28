import type { ProjectManagerJob } from "@maple/protocol";
import type { ProjectManagerSnapshot } from "./project-snapshot";

export interface ProjectManagerPromptOptions {
  resuming?: boolean;
  includeStableContext?: boolean;
}

function compactHistory(job: ProjectManagerJob): string {
  return JSON.stringify(
    job.history.map((item) => ({
      todoId: item.todoId,
      title: item.title,
      details: item.details.slice(0, 800),
      status: item.status,
      workerKind: item.workerKind,
      workflowId: item.workflowId,
      resultSummary: item.resultSummary?.slice(0, 800) ?? null,
      dispatchBrief: item.dispatchBrief?.slice(0, 400) ?? null
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
    ? [
        "继续担任这个项目的一线项目经理。你已保留此前的项目判断与派单上下文。",
        "下面是新到达的 Todo；快速更新判断并派单，不要重新介绍角色或复述旧结论。"
      ]
    : [
        "你是 Maple 为这个项目长期保留的一线项目经理。你的职责只有快速诊断与派单。",
        "你可以只读检查当前仓库，但严禁修改、创建、删除或格式化任何项目文件。",
        "不要输出实施 Plan，不要执行 Todo，不要介入 Worker 的实现过程。"
      ];
  const stableContext = options.includeStableContext === false
    ? []
    : [
        options.resuming ? "项目规则或文件结构已经变化，请更新你保留的项目认知：" : "",
        snapshot.stableContext,
        ""
      ].filter(Boolean);
  const constitution = job.executionSettings?.constitution.trim() ?? "";
  return [
    ...identity,
    outputLanguageInstruction(job),
    ...(constitution ? ["项目宪法（派单必须遵守）：", constitution, ""] : []),
    `先读取 Maple Skill：${process.env.MAPLE_SKILL_PATH || "~/.maple/runtime/skills/maple/SKILL.md"}。`,
    `Maple MCP 配置：${process.env.MAPLE_MCP_CONFIG || "~/.maple/runtime/mcp/mcp.json"}。`,
    "始终只做只读诊断；严禁修改、创建、删除或格式化项目文件，也不要输出实施 Plan。",
    `这个 Todo 已由用户指定给 ${job.todo.workerKind}；Worker 不属于你的决策范围，严禁替换或改派。`,
    "你的回复会直接唤起 Maple CLI 中对应的 Worker tab，因此只需快速完成 Workflow 归组。",
    "判断新任务应延续哪个 Workflow；同一目标的连续任务应复用 Workflow，完全独立的工作应新建 Workflow。",
    "延续已有 Workflow 时只更新连续背景，不得为了复用旧 session 改变 Todo 指定 Worker。",
    "executionMode=serial 表示同一 Workflow 必须依次执行；只有确认任务互不依赖且不会争用工作区时才选 parallel。",
    "只允许输出一个 JSON 对象，不要 Markdown，不要解释，也不要附加其他文字。",
    "",
    "固定输出结构：",
    '{"workflowId":"已有ID或NEW","workflowTitle":"短标题","workflowSummary":"持续目标摘要","executionMode":"serial或parallel","dispatchBrief":"给Worker的简短背景，不得包含实施步骤"}',
    "",
    `项目：${job.project.name}`,
    `可用 Worker：${job.availableWorkers.join(", ")}`,
    ...stableContext,
    "以下内容会随任务变化：",
    snapshot.workingState,
    `活跃 Workflow：${JSON.stringify(job.workflows)}`,
    `Maple 最近历史：${compactHistory(job)}`,
    `新 Todo：${JSON.stringify({
      id: job.todo.id,
      title: job.todo.title,
      details: job.todo.details,
      requestedWorkerKind: job.todo.workerKind,
      tags: job.todo.tags
    })}`,
    "",
    "现在立即返回派单 JSON。"
  ].join("\n");
}

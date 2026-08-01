import type { ExecutionJob } from "@maple/protocol";

export interface ExecutionPromptOptions {
  resumingWorkflowSession?: boolean;
  screenshotDirectory?: string;
  playwrightExecutable?: string;
}

function outputLanguageInstruction(job: ExecutionJob): string {
  switch (job.executionSettings?.aiOutputLanguage) {
    case "en": return "Write the final execution report in English.";
    case "zh": return "最终执行报告必须使用中文。";
    default: return "最终报告跟随 Todo 与项目现有语言；无法判断时使用中文。";
  }
}

export function buildExecutionPrompt(job: ExecutionJob, options: ExecutionPromptOptions = {}): string {
  const details = job.todo.details.trim() || "（没有补充说明）";
  const managerContext = job.workflow || job.dispatchBrief
    ? [
        job.workflow ? `任务：${job.workflow.title}；任务：${job.workflow.summary}` : "",
        job.dispatchBrief ? `补充：${job.dispatchBrief}` : ""
      ].filter(Boolean)
    : [];
  const screenshotRequirements = options.screenshotDirectory
    ? [`可选截图：仅 Todo 涉及网页/UI 时，用 ${options.playwrightExecutable ?? "Playwright"} 访问真实页面并将 1～6 张截图存到 ${options.screenshotDirectory}；其他任务跳过。辅助文件不得留在项目目录。`]
    : [];
  const constitution = job.executionSettings?.constitution.trim() ?? "";
  return [
    options.resumingWorkflowSession
      ? "续接当前 Maple Workflow Worker 会话，按照新 Todo 要求完成"
      : "你是 Maple Worker，在当前工作目录按照 Todo 要求完成",
    `项目是 ${job.project.name}`,
    `Todo 是 ${job.todo.title}`,
    `详情信息补充：${details}`,
    ...managerContext,
    outputLanguageInstruction(job),
    ...(constitution ? [`项目宪法：${constitution}`] : []),
    "完成后根据 Todo 任务像人类聊天一样输出简约文本，在报告中不声明自己 Maple Worker 身份，不将 Maple Todo 元数据情况告诉用户：小任务/小修复尽量在 100 字内，普通开发约 100～200 字，审计、迁移、架构重构或用户要求完整报告时再展开",
    ...screenshotRequirements
  ].join("\n");
}

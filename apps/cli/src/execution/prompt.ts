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
        job.workflow ? `Leader 工作流：${job.workflow.title}；目标：${job.workflow.summary}` : "",
        job.dispatchBrief ? `Leader 补充：${job.dispatchBrief}` : ""
      ].filter(Boolean)
    : [];
  const screenshotRequirements = options.screenshotDirectory
    ? [`可选截图：仅 Todo 涉及网页/UI 时，用 ${options.playwrightExecutable ?? "Playwright"} 访问真实页面并将 1～6 张截图存到 ${options.screenshotDirectory}；其他任务跳过。辅助文件不得留在项目目录。`]
    : [];
  const constitution = job.executionSettings?.constitution.trim() ?? "";
  return [
    options.resumingWorkflowSession
      ? "续接当前 Maple Workflow Worker 会话，直接完成新 Todo。"
      : "你是 Maple Worker，请在当前工作目录直接完成 Todo。",
    `项目：${job.project.name}`,
    `Todo：${job.todo.title}`,
    `详情：${details}`,
    ...managerContext,
    outputLanguageInstruction(job),
    ...(constitution ? [`项目宪法（必须遵守）：${constitution}`] : []),
    `先读 Maple Skill（${process.env.MAPLE_SKILL_PATH || "~/.maple/runtime/skills/maple/SKILL.md"}）；优先遵守用户提示、项目 AGENTS.md 及已有 Skills/MCP，按 Skill 完成状态回报。`,
    "直接实现 Todo，保留无关改动，并按风险做必要验证。",
    "完成后只报告结果、验证和必要阻塞；小任务/小修复约 100 字，普通开发约 100～200 字，审计、迁移、架构重构或用户要求完整报告时再展开。",
    ...screenshotRequirements
  ].join("\n");
}

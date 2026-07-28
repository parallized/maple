import type { ExecutionJob } from "@maple/protocol";
import {
  resolveExecutionReportLimit,
  type ExecutionReportLimit
} from "./report";

export interface ExecutionPromptOptions {
  resumingWorkflowSession?: boolean;
  reportMaxChars?: ExecutionReportLimit;
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
  const reportMaxChars = options.reportMaxChars ?? resolveExecutionReportLimit(job.todo);
  const managerContext = job.workflow || job.dispatchBrief
    ? [
        "",
        "项目经理派单：",
        job.workflow ? `工作流：${job.workflow.title}\n持续目标：${job.workflow.summary}` : "",
        job.dispatchBrief ? `背景：${job.dispatchBrief}` : ""
      ].filter(Boolean)
    : [];
  const screenshotRequirements = options.screenshotDirectory
    ? [
        "8. 本次任务已开启后台 Playwright 截图验收。实现完成后，用 Playwright 无头浏览器访问真实运行页面并完成必要交互。",
        `9. 使用 Maple 已安装的 Playwright 命令：${options.playwrightExecutable ?? "playwright"}`,
        `10. 将 1 至 6 张最终验收截图保存为 PNG、JPEG 或 WebP 到：${options.screenshotDirectory}`,
        "11. 截图必须来自实际运行结果，不得使用占位图、设计稿或伪造图片；该目录只放最终验收截图。",
        "12. 不得为截图在项目目录创建 .maple、Playwright spec、配置或临时脚本；辅助文件只能放在上述截图目录，并在结束前删除。"
      ]
    : [];
  const constitution = job.executionSettings?.constitution.trim() ?? "";
  return [
    options.resumingWorkflowSession
      ? "你正在续接这个 Maple Workflow 的 Worker 会话。保留并利用此前上下文，直接完成下面的新 Todo。"
      : "你是 Maple CLI 启动的项目执行 Worker。请在当前工作目录中直接完成下面的 Todo。",
    "",
    `项目：${job.project.name}`,
    `Todo：${job.todo.title}`,
    "详情：",
    details,
    ...managerContext,
    "",
    "执行要求：",
    outputLanguageInstruction(job),
    ...(constitution ? ["项目宪法（必须遵守）：", constitution, ""] : []),
    `Maple Skill：${process.env.MAPLE_SKILL_PATH || "~/.maple/runtime/skills/maple/SKILL.md"}`,
    `Maple MCP：${process.env.MAPLE_MCP_CONFIG || "~/.maple/runtime/mcp/mcp.json"}`,
    "1. 先读取 Maple Skill、仓库内的 AGENTS.md 与项目约束，再修改代码。",
    "2. 直接实现 Todo，不要只给方案、模拟结果或等待终端用户补做步骤。",
    "3. 保留工作区中与本 Todo 无关的已有改动。",
    "4. 完成与风险相匹配的类型检查、测试或构建。",
    "5. 最终回复就是执行报告，只输出 Markdown 正文，不使用标题、分类、分节或复杂模板。",
    `6. 最终报告不得超过 ${reportMaxChars} 字，直接写完整结论，禁止使用省略号。`,
    "7. 只保留执行结果、验证结论和必要风险，避免复述过程、罗列文件或使用客套话。",
    ...screenshotRequirements
  ].join("\n");
}

import { describe, expect, it } from "bun:test";
import type { ExecutionJob } from "@maple/protocol";
import { buildExecutionPrompt } from "../src/execution/prompt";
import {
  ExecutionReportCollector,
  normalizeExecutionReport
} from "../src/execution/report";

describe("execution report", () => {
  it("keeps the Worker prompt minimal and gives task-scaled report guidance", () => {
    const prompt = buildExecutionPrompt({
      project: { name: "Maple" },
      todo: { title: "快速看一眼这项目是啥", details: "", tags: [] }
    } as unknown as ExecutionJob);

    expect(prompt).toContain("优先遵守用户提示、项目 AGENTS.md 及已有 Skills/MCP");
    expect(prompt).toContain("小任务/小修复约 100 字，普通开发约 100～200 字");
    expect(prompt).toContain("审计、迁移、架构重构或用户要求完整报告时再展开");
    expect(prompt.length).toBeLessThan(1_200);
    expect(prompt).not.toContain("最终报告不得超过");
  });

  it("adds headless Playwright acceptance instructions only when enabled", () => {
    const disabled = buildExecutionPrompt({
      project: { name: "Maple" },
      todo: { title: "调整界面", details: "", tags: [] }
    } as unknown as ExecutionJob);
    const enabled = buildExecutionPrompt({
      project: { name: "Maple" },
      todo: { title: "调整界面", details: "", tags: [] }
    } as unknown as ExecutionJob, {
      screenshotDirectory: "C:\\Users\\maple\\.maple\\artifacts\\attempt",
      playwrightExecutable: "C:\\Users\\maple\\playwright.cmd"
    });

    expect(disabled).not.toContain("Playwright 截图验收");
    expect(enabled).toContain("可选截图：仅 Todo 涉及网页/UI 时");
    expect(enabled).toContain("1～6 张截图存到");
    expect(enabled).toContain("辅助文件不得留在项目目录");
    expect(enabled).toContain("C:\\Users\\maple\\playwright.cmd");
    expect(enabled).toContain("C:\\Users\\maple\\.maple\\artifacts\\attempt");
  });

  it("keeps only the latest complete assistant response", () => {
    const collector = new ExecutionReportCollector();
    collector.push({
      stream: "stdout",
      kind: "assistant",
      level: "info",
      status: "completed",
      content: "我先检查实现。"
    });
    collector.push({
      stream: "stdout",
      kind: "command",
      level: "info",
      status: "completed",
      content: "bun test"
    });
    collector.push({
      stream: "stdout",
      kind: "assistant",
      level: "info",
      status: "completed",
      content: "修复完成，测试通过。"
    });

    expect(collector.value()).toBe("修复完成，测试通过。");
  });

  it("joins the final streaming response without adding spaces or categories", () => {
    const collector = new ExecutionReportCollector();
    for (const content of ["已完成", "报告", "精简。"] as const) {
      collector.push({
        stream: "stdout",
        kind: "assistant",
        level: "info",
        status: "progress",
        content
      });
    }

    expect(collector.value()).toBe("已完成报告精简。");
  });

  it("normalizes terminal output while preserving the complete Markdown report", () => {
    expect(normalizeExecutionReport("\x1b[32m- 完成\r\n1. 测试通过\x1b[0m"))
      .toBe("- 完成\n1. 测试通过");
    const report = `## 执行结果\n\n${"改".repeat(1_200)}\n\n- 验证通过`;
    expect(normalizeExecutionReport(report)).toBe(report);
  });

  it("does not truncate the collected report", () => {
    const collector = new ExecutionReportCollector();
    const report = `## 执行结果\n\n${"改".repeat(1_200)}\n\n1. 验证通过`;
    collector.push({
      stream: "stdout",
      kind: "assistant",
      level: "info",
      status: "completed",
      content: report
    });

    expect(collector.value()).toBe(report);
  });
});

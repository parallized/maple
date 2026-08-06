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

    expect(prompt).not.toContain("Skill");
    expect(prompt).toContain("小任务/小修复尽量在 100 字内，普通开发约 100～200 字");
    expect(prompt).toContain("审计、迁移、架构重构或用户要求完整报告时再展开");
    expect(prompt).toContain("默认不做删除、覆盖等不可逆的危险操作");
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

  it("carries rework intent with the latest three execution reports", () => {
    const prompt = buildExecutionPrompt({
      project: { name: "Maple" },
      todo: {
        title: "返工任务",
        details: "",
        tags: [],
        reworkCount: 2,
        reports: [
          { id: "r4", author: "deepseek", content: "第四次报告", createdAt: "2026-07-04T00:00:00.000Z" },
          { id: "r3", author: "deepseek", content: "第三次报告", createdAt: "2026-07-03T00:00:00.000Z" },
          { id: "r2", author: "deepseek", content: "第二次报告", createdAt: "2026-07-02T00:00:00.000Z" },
          { id: "r1", author: "deepseek", content: "第一次报告", createdAt: "2026-07-01T00:00:00.000Z" }
        ]
      }
    } as unknown as ExecutionJob);

    expect(prompt).toContain("任务返工：该任务此前已执行过，本次属于返工重做");
    expect(prompt).toContain("最近执行报告（最多最近 3 次，新到旧）");
    expect(prompt).toContain("第四次报告");
    expect(prompt).toContain("第三次报告");
    expect(prompt).toContain("第二次报告");
    expect(prompt).not.toContain("第一次报告");
  });

  it("keeps the prompt free of rework context for first-time tasks", () => {
    const prompt = buildExecutionPrompt({
      project: { name: "Maple" },
      todo: { title: "全新任务", details: "", tags: [] }
    } as unknown as ExecutionJob);

    expect(prompt).not.toContain("任务返工");
    expect(prompt).not.toContain("最近执行报告");
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

import { describe, expect, it } from "bun:test";
import type { ExecutionJob } from "@maple/protocol";
import { buildExecutionPrompt } from "../src/execution/prompt";
import {
  compactExecutionReport,
  ExecutionReportCollector,
  MAX_EXECUTION_REPORT_CHARS,
  resolveExecutionReportLimit
} from "../src/execution/report";

describe("execution report", () => {
  it("gives the Worker the resolved hard limit without exposing a category", () => {
    const prompt = buildExecutionPrompt({
      project: { name: "Maple" },
      todo: { title: "快速看一眼这项目是啥", details: "", tags: [] }
    } as unknown as ExecutionJob);

    expect(prompt).toContain("只输出 Markdown 正文");
    expect(prompt).toContain("不使用标题、分类、分节");
    expect(prompt).toContain("最终报告不得超过 30 字");
    expect(prompt).toContain("禁止使用省略号");
    expect(prompt).not.toContain("复杂任务");
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
    expect(enabled).toContain("后台 Playwright 截图验收");
    expect(enabled).toContain("Playwright 无头浏览器");
    expect(enabled).toContain("C:\\Users\\maple\\playwright.cmd");
    expect(enabled).toContain("C:\\Users\\maple\\.maple\\artifacts\\attempt");
    expect(enabled).toContain("不得为截图在项目目录创建 .maple");
    expect(enabled).toContain("Playwright spec");
  });

  it("assigns 30, 100, or 300 characters from Todo scope", () => {
    expect(resolveExecutionReportLimit({
      title: "快速看一眼这项目是啥",
      details: "",
      tags: []
    })).toBe(30);
    expect(resolveExecutionReportLimit({
      title: "调整登录异常处理",
      details: "需要核对登录、刷新令牌和退出流程的错误返回，并补充对应测试，确保已有客户端行为保持兼容。".repeat(2),
      tags: []
    })).toBe(100);
    expect(resolveExecutionReportLimit({
      title: "重构多模块数据库迁移架构",
      details: "保持旧数据兼容。",
      tags: []
    })).toBe(300);
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

  it("preserves Markdown, respects the limit, and never adds an ellipsis", () => {
    expect(compactExecutionReport("\x1b[32m- 完成\r\n- 测试通过\x1b[0m")).toBe("- 完成\n- 测试通过");
    const report = compactExecutionReport("改".repeat(400));
    expect(Array.from(report)).toHaveLength(MAX_EXECUTION_REPORT_CHARS);
    expect(report).not.toContain("…");
    expect(report).not.toContain("...");
    expect(compactExecutionReport("第一句完成。第二句内容仍然很长", 8)).toBe("第一句完成。");
  });

  it("enforces a task-specific limit in the collector", () => {
    const collector = new ExecutionReportCollector(30);
    collector.push({
      stream: "stdout",
      kind: "assistant",
      level: "info",
      status: "completed",
      content: "改".repeat(60)
    });

    expect(Array.from(collector.value())).toHaveLength(30);
    expect(collector.value()).not.toContain("…");
  });
});

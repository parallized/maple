import { describe, expect, it } from "bun:test";
import { buildWorkerArchiveReport, createWorkerExecutionPrompt } from "../src/index";

describe("worker execution reports", () => {
  it("adds the adaptive compact Markdown rule without a visible complexity category", () => {
    const prompt = createWorkerExecutionPrompt({
      projectName: "Maple",
      directory: "E:/Codespace/maple",
      taskTitle: "调整报告",
      workerKind: "codex"
    });

    expect(prompt).toContain("极简 Markdown 正文");
    expect(prompt).toContain("简单任务 30 字内、一般任务 100 字内、复杂任务 300 字内");
    expect(prompt).toContain("不要写出分类");
  });

  it("does not manufacture a failure report when no AI report exists", () => {
    const report = buildWorkerArchiveReport({
      success: false,
      code: 1,
      stdout: "very long output",
      stderr: "failure details"
    }, "Task title");

    expect(report).toBe("");
  });
});

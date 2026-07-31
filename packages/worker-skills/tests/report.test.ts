import { describe, expect, it } from "bun:test";
import { buildWorkerArchiveReport, createWorkerExecutionPrompt } from "../src/index";

describe("worker execution reports", () => {
  it("requests concise but complete structured Markdown without a character limit", () => {
    const prompt = createWorkerExecutionPrompt({
      projectName: "Maple",
      directory: "E:/Codespace/maple",
      taskTitle: "调整报告",
      workerKind: "codex"
    });

    expect(prompt).toContain("简洁但完整的 Markdown");
    expect(prompt).toContain("简短标题、项目符号或有序列表");
    expect(prompt).toContain("不得为压缩篇幅省略必要的空格、单位、标点或结论");
    expect(prompt).not.toContain("30 字内");
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

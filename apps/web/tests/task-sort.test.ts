import { describe, expect, it } from "bun:test";
import { sortTasksByCompletion, type Task } from "@maple/board-ui";

function task(id: string, status: Task["status"]): Task {
  return {
    id,
    title: id,
    details: "",
    status,
    workerKind: "codex",
    needsConfirmation: false,
    tags: [],
    createdAt: `2026-07-27T00:00:0${id.length % 10}.000Z`,
    updatedAt: `2026-07-27T00:00:0${id.length % 10}.000Z`,
    reports: []
  };
}

describe("task table ordering", () => {
  it("keeps the existing order when nothing is completed", () => {
    const tasks = [task("a", "待办"), task("b", "草稿"), task("c", "队列中")];
    expect(sortTasksByCompletion(tasks).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("sinks completed tasks to the bottom while preserving relative order", () => {
    const tasks = [
      task("a", "待办"),
      task("b", "已完成"),
      task("c", "待办"),
      task("d", "已完成"),
      task("e", "已阻塞")
    ];
    expect(sortTasksByCompletion(tasks).map((item) => item.id)).toEqual(["a", "c", "e", "b", "d"]);
  });

  it("floats a reworked completed task up to the first non-completed row", () => {
    // 返工前：已完成任务被挤到下面，返工后立刻浮到最后一个未完成任务下方。
    const tasks = [task("a", "待办"), task("b", "已完成"), task("c", "已完成")];
    const reworked = tasks.map((item) => (item.id === "c" ? { ...item, status: "待办" as const } : item));
    expect(sortTasksByCompletion(reworked).map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("does not jump above non-completed rows such as drafts", () => {
    const tasks = [task("a", "已完成"), task("b", "草稿"), task("c", "已完成")];
    const reworked = tasks.map((item) => (item.id === "c" ? { ...item, status: "待办" as const } : item));
    expect(sortTasksByCompletion(reworked).map((item) => item.id)).toEqual(["b", "c", "a"]);
  });
});

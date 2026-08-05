import { describe, expect, it } from "bun:test";
import { applyManualRowOrder, reorderForDrop, type Task } from "../src/index";

function task(id: string, status: Task["status"] = "待办", parentId: string | null = null): Task {
  return {
    id,
    title: id,
    details: "",
    detailsDoc: undefined,
    status,
    parentId,
    workerKind: "deepseek",
    needsConfirmation: false,
    tags: [],
    createdAt: `2026-07-27T00:00:00.000Z`,
    updatedAt: `2026-07-27T00:00:00.000Z`,
    reports: []
  };
}

describe("applyManualRowOrder", () => {
  it("无手动顺序时保持原顺序", () => {
    const tasks = [task("a"), task("b"), task("c")];
    expect(applyManualRowOrder(tasks, []).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("已完成沉底，未完成区按手动顺序排列", () => {
    const tasks = [
      task("a"),
      task("b", "已完成"),
      task("c"),
      task("d", "草稿"),
      task("e", "已完成")
    ];
    const manual = ["c", "a", "d"];
    expect(applyManualRowOrder(tasks, manual).map((item) => item.id)).toEqual(["c", "a", "d", "b", "e"]);
  });

  it("手动顺序外的任务排在末尾并保持原相对顺序", () => {
    const tasks = [task("a"), task("b"), task("c"), task("d")];
    const manual = ["b", "d"];
    expect(applyManualRowOrder(tasks, manual).map((item) => item.id)).toEqual(["b", "d", "a", "c"]);
  });
});

describe("reorderForDrop", () => {
  it("把第 1 行拖到第 3 行位置，生成新的手动顺序", () => {
    const tasks = [task("a"), task("b"), task("c")];
    // 初始手动顺序为空：基准 = a b c；拖 a 落到 c → b a c
    expect(reorderForDrop(tasks, "a", "c", [])).toEqual(["b", "a", "c"]);
  });

  it("重复拖拽以当前显示顺序为基准，不回退到初始顺序", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const first = reorderForDrop(tasks, "a", "c", []);
    expect(first).toEqual(["b", "a", "c"]);
    // 显示顺序 b a c；拖 c 落到 b → c b a
    expect(reorderForDrop(tasks, "c", "b", first!)).toEqual(["c", "b", "a"]);
  });

  it("拒绝拖动/落入已完成任务", () => {
    const tasks = [task("a"), task("b", "已完成"), task("c")];
    expect(reorderForDrop(tasks, "a", "b", [])).toBeNull();
    expect(reorderForDrop(tasks, "b", "c", [])).toBeNull();
  });

  it("拒绝子任务参与拖拽", () => {
    const tasks = [task("a", "待办", null), task("a1", "待办", "a"), task("b")];
    expect(reorderForDrop(tasks, "a1", "b", [])).toBeNull();
    expect(reorderForDrop(tasks, "a", "a1", [])).toBeNull();
  });

  it("拒绝不存在的任务", () => {
    const tasks = [task("a"), task("b")];
    expect(reorderForDrop(tasks, "missing", "b", [])).toBeNull();
    expect(reorderForDrop(tasks, "a", "missing", [])).toBeNull();
  });
});

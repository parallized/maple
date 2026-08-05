import { describe, expect, it } from "bun:test";
import type { Todo } from "@maple/protocol";
import { mapTodoToTask } from "../src/board/snapshot-mapper";

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "todo-1",
    projectId: "project-1",
    title: "任务一",
    details: "",
    status: "done",
    parentId: null,
    priority: 0,
    workerKind: "deepseek",
    claimedByRunnerId: null,
    activeAttemptId: null,
    leaseExpiresAt: null,
    retryAfter: null,
    resultSummary: null,
    lastError: null,
    tags: [],
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides
  };
}

describe("mapTodoToTask", () => {
  it("透传 Leader 发起说明（dispatchBrief）", () => {
    const task = mapTodoToTask(todo({ dispatchBrief: "按新需求重构，复用上次会话上下文" }));
    expect(task.dispatchBrief).toBe("按新需求重构，复用上次会话上下文");
  });

  it("数据库未记载 leader 发起说明时导出为空", () => {
    const task = mapTodoToTask(todo({ dispatchBrief: null }));
    expect(task.dispatchBrief).toBeNull();
  });

  it("透传 token 用量与 sessionId", () => {
    const task = mapTodoToTask(todo({
      usage: { inputTokens: 10, cachedInputTokens: 90, outputTokens: 20, reasoningOutputTokens: 5 },
      sessionId: "session_abc"
    }));
    expect(task.usage?.cachedInputTokens).toBe(90);
    expect(task.sessionId).toBe("session_abc");
  });
});

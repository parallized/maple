import { describe, expect, it } from "bun:test";
import type { Task } from "@maple/board-ui";
import type { CreateTodoRequest, Todo, UpdateTodoRequest } from "@maple/protocol";
import type { DashboardApi } from "../src/api/client";
import { buildTodoUpdateRequest, createServerPlatform } from "../src/board/server-platform";

function boardTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: "task-client-123",
    title: "Create directly",
    details: "",
    status: "待办",
    workerKind: "codex",
    tags: [],
    createdAt: now,
    updatedAt: now,
    reports: [],
    ...overrides
  };
}

function todoFrom(task: Task, projectId = "project-1"): Todo {
  return {
    id: task.id,
    projectId,
    title: task.title,
    details: task.details,
    status: task.status === "草稿" ? "draft" : "todo",
    priority: 0,
    workerKind: task.workerKind,
    claimedByRunnerId: null,
    activeAttemptId: null,
    leaseExpiresAt: null,
    resultSummary: null,
    lastError: null,
    tags: [...task.tags],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: null,
    completedAt: null
  };
}

describe("Web Server task source", () => {
  it("creates a task through the Server command immediately", async () => {
    const calls: Array<{ projectId: string; input: CreateTodoRequest }> = [];
    const task = boardTask();
    const api = {
      createTodo: async (projectId: string, input: CreateTodoRequest) => {
        calls.push({ projectId, input });
        return todoFrom(task, projectId);
      }
    } as unknown as DashboardApi;
    const platform = createServerPlatform(api);

    const created = await platform.taskCommands!.create("project-1", task, "claude");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      projectId: "project-1",
      input: {
        id: task.id,
        title: task.title,
        details: "",
        workerKind: "codex",
        tags: [],
        status: "todo"
      }
    });
    expect(created.id).toBe(task.id);
    expect(created.title).toBe(task.title);
  });

  it("builds explicit PATCH fields without sending render-only state", () => {
    const previous = boardTask({ needsConfirmation: true });
    const next = boardTask({
      title: "Updated",
      details: "New details",
      detailsDoc: [{ type: "paragraph" }],
      status: "待返工",
      workerKind: "claude",
      tags: ["bug"],
      needsConfirmation: false
    });

    const body: UpdateTodoRequest = buildTodoUpdateRequest(previous, next);

    expect(body).toEqual({
      title: "Updated",
      details: "New details",
      detailsDoc: JSON.stringify([{ type: "paragraph" }]),
      tags: ["bug"],
      workerKind: "claude",
      status: "rework"
    });
    expect("needsConfirmation" in body).toBe(false);
    expect("reports" in body).toBe(false);
  });

  it("routes updates and deletes through explicit Server calls", async () => {
    const updates: Array<{ taskId: string; input: UpdateTodoRequest }> = [];
    const deletes: string[] = [];
    const previous = boardTask();
    const next = boardTask({ title: "Stored by Server" });
    const api = {
      updateTodo: async (taskId: string, input: UpdateTodoRequest) => {
        updates.push({ taskId, input });
        return todoFrom(next);
      },
      deleteTodo: async (taskId: string) => {
        deletes.push(taskId);
        return { deleted: true as const };
      }
    } as unknown as DashboardApi;
    const platform = createServerPlatform(api);

    const updated = await platform.taskCommands!.update("project-1", previous, next);
    await platform.taskCommands!.remove("project-1", next.id);

    expect(updates).toEqual([{ taskId: next.id, input: { title: "Stored by Server" } }]);
    expect(deletes).toEqual([next.id]);
    expect(updated.title).toBe("Stored by Server");
  });

  it("deletes a project through an explicit Server command", async () => {
    const deletes: string[] = [];
    const api = {
      deleteProject: async (projectId: string) => {
        deletes.push(projectId);
        return { deleted: true as const };
      }
    } as unknown as DashboardApi;
    const platform = createServerPlatform(api);

    await platform.projectCommands!.remove("project-1");

    expect(deletes).toEqual(["project-1"]);
  });

  it("does not let the client move a task into runner-managed states", () => {
    const previous = boardTask({ status: "待办" });
    const next = boardTask({ status: "进行中" });

    expect(buildTodoUpdateRequest(previous, next)).toEqual({});
  });
});

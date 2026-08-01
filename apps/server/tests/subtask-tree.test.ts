import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import type {
  ClaimJobResponse,
  CreatePairingResponse,
  DashboardSnapshot,
  ExchangePairingResponse,
  RegisterProjectResponse,
  Todo,
  TodoDetailResponse
} from "@maple/protocol";
import { createServerApp } from "../src/app";
import type { ServerConfig } from "../src/config";
import { createDatabase } from "../src/database/client";
import { hashSecret } from "../src/lib/crypto";
import { TodoRepository } from "../src/repositories/todo-repository";

const ADMIN_TOKEN = "test-admin-token";
const TEST_WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const TEST_USER_ID = "10000000-0000-4000-8000-000000000002";
const TEST_SESSION_TOKEN = "test-web-session-token";
const TEST_CSRF_TOKEN = "test-web-csrf-token";
const databases: Database[] = [];

function testConfig(webRoot = "missing-dashboard"): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir: ".",
    databasePath: ":memory:",
    webRoot,
    allowedOrigins: ["http://localhost:5173"],
    leaseSeconds: 45,
    runnerOfflineSeconds: 30,
    pairingTtlSeconds: 600,
    runnerCommandTtlSeconds: 900
  };
}

function createTestApp() {
  const database = createDatabase(":memory:");
  databases.push(database);
  const now = "2026-07-27T00:00:00.000Z";
  database.run(
    `INSERT INTO users(id, email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [TEST_USER_ID, "subtask@example.com", "test-password-hash", "Subtask Flow", now, now]
  );
  database.run(
    `INSERT INTO workspaces(id, name, owner_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [TEST_WORKSPACE_ID, "Subtask Workspace", TEST_USER_ID, now, now]
  );
  database.run(
    `INSERT INTO workspace_members(workspace_id, user_id, role, created_at)
     VALUES (?, ?, 'owner', ?)`,
    [TEST_WORKSPACE_ID, TEST_USER_ID, now]
  );
  database.run(
    `INSERT INTO web_sessions(
       id, token_hash, user_id, active_workspace_id, csrf_token, csrf_token_hash, trust,
       ip_address, network_key, user_agent_hash, device_label,
       created_at, last_seen_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'trusted', ?, ?, ?, ?, ?, ?, ?)`,
    [
      "test-session-id",
      hashSecret(TEST_SESSION_TOKEN),
      TEST_USER_ID,
      TEST_WORKSPACE_ID,
      TEST_CSRF_TOKEN,
      hashSecret(TEST_CSRF_TOKEN),
      "127.0.0.1",
      "loopback",
      "test-agent",
      "Test browser",
      now,
      now,
      "2099-01-01T00:00:00.000Z"
    ]
  );
  return createServerApp({ config: testConfig(), database });
}

function request(
  app: ReturnType<typeof createServerApp>,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (options.token === ADMIN_TOKEN) {
    headers.set("cookie", `maple_session=${TEST_SESSION_TOKEN}`);
    headers.set("x-maple-workspace", TEST_WORKSPACE_ID);
    if (options.method && options.method !== "GET") {
      headers.set("x-maple-csrf", TEST_CSRF_TOKEN);
      headers.set("origin", "http://maple.test");
    }
  } else if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return app.handle(
    new Request(`http://maple.test${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    })
  );
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function setupProjectAndTodos(): Promise<{
  app: ReturnType<typeof createServerApp>;
  runnerToken: string;
  projectId: string;
  parent: Todo;
  child: Todo;
  grandchild: Todo;
}> {
  const app = createTestApp();
  const pairingResponse = await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN });
  const pairing = (await pairingResponse.json()) as CreatePairingResponse;
  const exchangeResponse = await request(app, "/api/pairings/exchange", {
    method: "POST",
    token: ADMIN_TOKEN,
    body: {
      code: pairing.code,
      runnerName: "Subtask runner",
      hostname: "test-host",
      platform: "test/x64",
      version: "0.1.6"
    }
  });
  const exchange = (await exchangeResponse.json()) as ExchangePairingResponse;
  const projectResponse = await request(app, "/api/runner/projects", {
    method: "POST",
    token: exchange.runnerToken,
    body: {
      externalKey: "git:subtask-tree",
      name: "Subtask Tree",
      repositoryUrl: "https://example.com/subtask.git",
      defaultBranch: "main",
      workspaceLabel: "subtask-test",
      gitBranch: "main",
      gitHead: "0123456789abcdef"
    }
  });
  const registration = (await projectResponse.json()) as RegisterProjectResponse;

  const parentResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
    method: "POST",
    token: ADMIN_TOKEN,
    body: { title: "父任务", status: "todo", workerKind: "codex" }
  });
  const parent = (await parentResponse.json()) as Todo;
  const childResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
    method: "POST",
    token: ADMIN_TOKEN,
    body: { title: "子任务", status: "draft", workerKind: "codex", parentId: parent.id }
  });
  const child = (await childResponse.json()) as Todo;
  const grandchildResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
    method: "POST",
    token: ADMIN_TOKEN,
    body: { title: "孙任务", status: "draft", workerKind: "codex", parentId: child.id }
  });
  const grandchild = (await grandchildResponse.json()) as Todo;
  return { app, runnerToken: exchange.runnerToken, projectId: registration.project.id, parent, child, grandchild };
}

describe("Maple subtask tree", () => {
  it("creates parent/child/grandchild todos and lists them with parentId", async () => {
    const { app, projectId, parent, child, grandchild } = await setupProjectAndTodos();
    expect(parent.parentId).toBeNull();
    expect(child.parentId).toBe(parent.id);
    expect(grandchild.parentId).toBe(child.id);

    const listResponse = await request(app, `/api/projects/${projectId}/todos`, { token: ADMIN_TOKEN });
    const { todos } = (await listResponse.json()) as { todos: Todo[] };
    const byId = new Map(todos.map((todo) => [todo.id, todo]));
    expect(byId.get(child.id)?.parentId).toBe(parent.id);
    expect(byId.get(grandchild.id)?.parentId).toBe(child.id);
  });

  it("resets all descendants to 待办 when the parent task is claimed for execution", async () => {
    const { app, runnerToken, child, grandchild } = await setupProjectAndTodos();
    const claimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      token: runnerToken
    });
    const claim = (await claimResponse.json()) as ClaimJobResponse;
    expect(claim.job?.todo.title).toBe("父任务");

    const database = databases[databases.length - 1]!;
    const rows = database
      .query("SELECT status FROM todos WHERE id IN (?, ?)")
      .all(child.id, grandchild.id) as Array<{ status: string }>;
    expect(rows.map((row) => row.status).sort()).toEqual(["todo", "todo"]);
  });

  it("cascades a manual status change to all descendants", async () => {
    const { app, parent, child, grandchild } = await setupProjectAndTodos();
    const patchResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "done" }
    });
    expect(patchResponse.status).toBe(200);

    const database = databases[databases.length - 1]!;
    const rows = database
      .query("SELECT status FROM todos WHERE id IN (?, ?)")
      .all(child.id, grandchild.id) as Array<{ status: string }>;
    expect(rows.map((row) => row.status)).toEqual(["done", "done"]);
  });

  it("keeps the execution report when a completed task is reworked", async () => {
    const { app, runnerToken, parent } = await setupProjectAndTodos();

    const claimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      token: runnerToken
    });
    expect(claimResponse.status).toBe(200);
    const claim = (await claimResponse.json()) as ClaimJobResponse;
    const job = claim.job!;
    expect(job.todo.id).toBe(parent.id);

    const startResponse = await request(app, `/api/runner/jobs/${job.todo.id}/start`, {
      method: "POST",
      token: runnerToken,
      body: { leaseToken: job.leaseToken }
    });
    expect(startResponse.status).toBe(200);
    const completeResponse = await request(app, `/api/runner/jobs/${job.todo.id}/complete`, {
      method: "POST",
      token: runnerToken,
      body: { leaseToken: job.leaseToken, success: true, exitCode: 0, summary: "首次执行报告" }
    });
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as { todo: Todo };
    expect(completed.todo.status).toBe("review");
    expect(completed.todo.resultSummary).toBe("首次执行报告");

    // 修改任务并返工：上一次的执行报告必须保留，直到新执行完成后才被替换。
    const reworkResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { details: "补充说明后返工", status: "rework" }
    });
    expect(reworkResponse.status).toBe(200);
    const reworked = (await reworkResponse.json()) as Todo;
    expect(reworked.status).toBe("rework");
    expect(reworked.resultSummary).toBe("首次执行报告");

    // 手动置回待办同样不应清掉已有报告。
    const todoResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "todo" }
    });
    expect(todoResponse.status).toBe(200);
    const resetTodo = (await todoResponse.json()) as Todo;
    expect(resetTodo.status).toBe("todo");
    expect(resetTodo.resultSummary).toBe("首次执行报告");
  });

  it("keeps descendant reports when the parent status change cascades", async () => {
    const { app, parent, child, grandchild } = await setupProjectAndTodos();
    const database = databases[databases.length - 1]!;
    database.run("UPDATE todos SET result_summary = ? WHERE id = ?", ["子任务报告", child.id]);
    database.run("UPDATE todos SET result_summary = ? WHERE id = ?", ["孙任务报告", grandchild.id]);

    const patchResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "rework" }
    });
    expect(patchResponse.status).toBe(200);

    const rows = database
      .query("SELECT id, status, result_summary FROM todos WHERE id IN (?, ?)")
      .all(child.id, grandchild.id) as Array<{
        id: string;
        status: string;
        result_summary: string | null;
      }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(child.id)).toMatchObject({ status: "rework", result_summary: "子任务报告" });
    expect(byId.get(grandchild.id)).toMatchObject({ status: "rework", result_summary: "孙任务报告" });
  });

  it("pulls a queued worker job back to draft and abandons the claim", async () => {
    const { app, runnerToken, parent } = await setupProjectAndTodos();
    const claimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      token: runnerToken
    });
    const claim = (await claimResponse.json()) as ClaimJobResponse;
    const job = claim.job!;
    expect(job.todo.status).toBe("queued");
    expect(job.todo.activeAttemptId).toBe(job.attempt.id);

    // 情况1：刚进入队列（已认领、未开始），改回草稿。
    const patchResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "draft" }
    });
    expect(patchResponse.status).toBe(200);
    const todo = (await patchResponse.json()) as Todo;
    expect(todo.status).toBe("draft");
    expect(todo.activeAttemptId).toBeNull();
    expect(todo.claimedByRunnerId).toBeNull();
    expect(todo.leaseExpiresAt).toBeNull();

    // 原执行租约已作废：旧租约无法再完成、心跳。
    const staleComplete = await request(app, `/api/runner/jobs/${parent.id}/complete`, {
      method: "POST",
      token: runnerToken,
      body: { leaseToken: job.leaseToken, success: true, exitCode: 0, summary: "不应生效" }
    });
    expect(staleComplete.status).toBe(409);

    const detailResponse = await request(app, `/api/todos/${parent.id}`, { token: ADMIN_TOKEN });
    const detail = (await detailResponse.json()) as TodoDetailResponse;
    expect(detail.attempts[0]).toMatchObject({
      state: "abandoned",
      error: expect.stringContaining("撤销")
    });
  });

  it("pulls a running job back to draft, abandons the attempt and keeps any report", async () => {
    const { app, runnerToken, parent } = await setupProjectAndTodos();
    const claimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      token: runnerToken
    });
    const claim = (await claimResponse.json()) as ClaimJobResponse;
    const job = claim.job!;
    await request(app, `/api/runner/jobs/${job.todo.id}/start`, {
      method: "POST",
      token: runnerToken,
      body: { leaseToken: job.leaseToken }
    });
    const detailBefore = (await request(app, `/api/todos/${parent.id}`, {
      token: ADMIN_TOKEN
    }).then((r) => r.json())) as TodoDetailResponse;
    expect(detailBefore.todo).toMatchObject({ status: "running", activeAttemptId: job.attempt.id });

    // 情况3：执行中改回草稿。
    const patchResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "draft" }
    });
    expect(patchResponse.status).toBe(200);
    const todo = (await patchResponse.json()) as Todo;
    expect(todo.status).toBe("draft");
    expect(todo.activeAttemptId).toBeNull();
    expect(todo.startedAt).toBeNull();
    expect(todo.completedAt).toBeNull();

    const detailResponse = await request(app, `/api/todos/${parent.id}`, { token: ADMIN_TOKEN });
    const detail = (await detailResponse.json()) as TodoDetailResponse;
    expect(detail.attempts[0]).toMatchObject({ state: "abandoned" });
  });

  it("releases a claimed project-manager planning route when pulled back to draft", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const now = "2026-07-27T00:00:00.000Z";
    database.run(
      `INSERT INTO workspaces(id, name, owner_user_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?)`,
      [TEST_WORKSPACE_ID, "Workspace", now, now]
    );
    database.run(
      `INSERT INTO projects(id, workspace_id, external_key, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["project-a", TEST_WORKSPACE_ID, "local:a", "Project A", now, now]
    );
    database.run(
      `INSERT INTO runners(id, workspace_id, token_hash, name, hostname, platform, version, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["runner-a", TEST_WORKSPACE_ID, "hash", "Runner A", "host", "test/x64", "0.1.6", now, now]
    );
    const todos = new TodoRepository(database);
    const todo = todos.create("project-a", { title: "planning", workerKind: "codex", status: "draft" });
    // 模拟项目经理已认领、正在规划：todo 进入 queued，route 处于 claimed。
    database.run("UPDATE todos SET status = 'queued' WHERE id = ?", [todo.id]);
    database.run(
      `INSERT INTO todo_routes(todo_id, source_status, state, manager_runner_id, attempt_id,
                               lease_token_hash, lease_expires_at, manager_worker_kind,
                               selected_worker_kind, dispatch_brief, created_at, updated_at)
       VALUES (?, 'todo', 'claimed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        todo.id,
        "runner-a",
        "manager-attempt",
        "lease-hash",
        "2099-01-01T00:00:00.000Z",
        "deepseek",
        "codex",
        "brief",
        now,
        now
      ]
    );

    // 情况2：规划中改回草稿，队列槽位回到可复用状态。
    const updated = todos.update(todo.id, { status: "draft" });
    expect(updated?.status).toBe("draft");
    const route = database
      .query("SELECT state, attempt_id, manager_runner_id, manager_worker_kind, lease_token_hash FROM todo_routes WHERE todo_id = ?")
      .get(todo.id) as {
        state: string;
        attempt_id: string | null;
        manager_runner_id: string | null;
        manager_worker_kind: string | null;
        lease_token_hash: string | null;
      };
    expect(route.state).toBe("pending");
    expect(route.attempt_id).toBeNull();
    expect(route.manager_runner_id).toBeNull();
    expect(route.manager_worker_kind).toBeNull();
    expect(route.lease_token_hash).toBeNull();
  });

  it("keeps the report when a reworked task is pulled back to draft before the rerun", async () => {
    const { app, runnerToken, parent } = await setupProjectAndTodos();

    const claimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      token: runnerToken
    });
    const claim = (await claimResponse.json()) as ClaimJobResponse;
    const job = claim.job!;
    await request(app, `/api/runner/jobs/${job.todo.id}/start`, {
      method: "POST",
      token: runnerToken,
      body: { leaseToken: job.leaseToken }
    });
    await request(app, `/api/runner/jobs/${job.todo.id}/complete`, {
      method: "POST",
      token: runnerToken,
      body: { leaseToken: job.leaseToken, success: true, exitCode: 0, summary: "已完成报告" }
    });

    // 返工后再误操作撤回草稿：报告必须仍在。
    const reworkResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "rework" }
    });
    expect((await reworkResponse.json()) as Todo).toMatchObject({
      status: "rework",
      resultSummary: "已完成报告"
    });
    const draftResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "draft" }
    });
    const draftTodo = (await draftResponse.json()) as Todo;
    expect(draftTodo.status).toBe("draft");
    expect(draftTodo.resultSummary).toBe("已完成报告");
  });

  it("accumulates one report per execution with the latest first", async () => {
    const { app, runnerToken, parent } = await setupProjectAndTodos();

    const run = async (summary: string) => {
      const claimResponse = await request(app, "/api/runner/jobs/claim", {
        method: "POST",
        token: runnerToken
      });
      expect(claimResponse.status).toBe(200);
      const claim = (await claimResponse.json()) as ClaimJobResponse;
      const job = claim.job!;
      await request(app, `/api/runner/jobs/${job.todo.id}/start`, {
        method: "POST",
        token: runnerToken,
        body: { leaseToken: job.leaseToken }
      });
      const completeResponse = await request(app, `/api/runner/jobs/${job.todo.id}/complete`, {
        method: "POST",
        token: runnerToken,
        body: { leaseToken: job.leaseToken, success: true, exitCode: 0, summary }
      });
      expect(completeResponse.status).toBe(200);
    };

    await run("第一份报告");
    const reworkResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "rework" }
    });
    expect(reworkResponse.status).toBe(200);
    await run("第二份报告");

    // 列表（看板数据源）与详情都应保留多份报告，最新在前。
    const dashboardResponse = await request(app, "/api/dashboard", { token: ADMIN_TOKEN });
    const dashboard = (await dashboardResponse.json()) as DashboardSnapshot;
    const todo = dashboard.todos.find((item) => item.id === parent.id)!;
    expect(todo.resultSummary).toBe("第二份报告");
    expect(todo.reports?.map((report) => report.content)).toEqual(["第二份报告", "第一份报告"]);

    const detailResponse = await request(app, `/api/todos/${parent.id}`, { token: ADMIN_TOKEN });
    const detail = (await detailResponse.json()) as TodoDetailResponse;
    expect(detail.todo.reports?.map((report) => report.content)).toEqual(["第二份报告", "第一份报告"]);
    expect(detail.attempts[0]?.resultSummary).toBe("第二份报告");
  });

  it("deletes descendants together with the parent task", async () => {
    const { app, projectId, parent } = await setupProjectAndTodos();
    const deleteResponse = await request(app, `/api/todos/${parent.id}`, {
      method: "DELETE",
      token: ADMIN_TOKEN
    });
    expect(deleteResponse.status).toBe(200);
    const listResponse = await request(app, `/api/projects/${projectId}/todos`, { token: ADMIN_TOKEN });
    const { todos } = (await listResponse.json()) as { todos: Todo[] };
    expect(todos).toEqual([]);
  });

  it("flags a routed todo as waiting serial when a workflow sibling is executing", async () => {
    const { app, projectId, parent } = await setupProjectAndTodos();
    const database = databases[databases.length - 1]!;
    const now = "2026-07-27T00:00:00.000Z";
    const workflowId = "workflow-serial-test";
    database.run(
      `INSERT INTO project_workflows(id, project_id, worker_kind, title, summary, created_at, updated_at)
       VALUES (?, ?, 'codex', ?, '', ?, ?)`,
      [workflowId, projectId, "Serial workflow", now, now]
    );
    database.run(
      `INSERT INTO todo_routes(todo_id, workflow_id, state, created_at, updated_at)
       VALUES (?, ?, 'claimed', ?, ?)`,
      [parent.id, workflowId, now, now]
    );
    database.run(
      `INSERT INTO todos(id, project_id, title, details, status, worker_kind, created_at, updated_at)
       VALUES ('serial-sibling', ?, ?, '', 'running', 'codex', ?, ?)`,
      [projectId, "Serial sibling", now, now]
    );
    database.run(
      `INSERT INTO todo_routes(todo_id, workflow_id, state, created_at, updated_at)
       VALUES (?, ?, 'routed', ?, ?)`,
      ["serial-sibling", workflowId, now, now]
    );
    database.run(`UPDATE todos SET status = 'queued' WHERE id = ?`, [parent.id]);

    const listResponse = await request(app, `/api/projects/${projectId}/todos`, { token: ADMIN_TOKEN });
    const { todos } = (await listResponse.json()) as { todos: Todo[] };
    const parentRow = todos.find((todo) => todo.id === parent.id)!;
    const sibling = todos.find((todo) => todo.id === "serial-sibling")!;
    expect(parentRow.serialBlocked).toBe(true);
    expect(sibling.serialBlocked).toBe(false);
  });

  it("rejects cycles and cross-project parents at the repository level", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const now = "2026-07-27T00:00:00.000Z";
    database.run(
      `INSERT INTO workspaces(id, name, owner_user_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?)`,
      [TEST_WORKSPACE_ID, "Workspace", now, now]
    );
    database.run(
      `INSERT INTO projects(id, workspace_id, external_key, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["project-a", TEST_WORKSPACE_ID, "local:a", "Project A", now, now]
    );
    database.run(
      `INSERT INTO projects(id, workspace_id, external_key, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["project-b", TEST_WORKSPACE_ID, "local:b", "Project B", now, now]
    );
    const todos = new TodoRepository(database);
    const root = todos.create("project-a", { title: "root", workerKind: "codex" });
    const child = todos.create("project-a", { title: "child", workerKind: "codex", parentId: root.id });
    const grandchild = todos.create("project-a", { title: "grandchild", workerKind: "codex", parentId: child.id });
    const other = todos.create("project-b", { title: "other", workerKind: "codex" });

    expect(() => todos.update(root.id, { parentId: grandchild.id }))
      .toThrow("不能把任务移动到自己的子任务下");
    expect(() => todos.update(child.id, { parentId: child.id }))
      .toThrow("任务不能成为自己的子任务");
    expect(() => todos.update(child.id, { parentId: other.id }))
      .toThrow("父任务必须属于同一项目");
    expect(todos.update(child.id, { parentId: null })?.parentId).toBeNull();
  });
});

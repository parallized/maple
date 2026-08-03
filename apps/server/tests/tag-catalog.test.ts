import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import type {
  ClaimProjectManagerJobResponse,
  CompleteProjectManagerJobResponse,
  CreatePairingResponse,
  DashboardSnapshot,
  ExchangePairingResponse,
  RegisterProjectResponse,
  Todo
} from "@maple/protocol";
import { createServerApp } from "../src/app";
import type { ServerConfig } from "../src/config";
import { createDatabase } from "../src/database/client";
import { hashSecret } from "../src/lib/crypto";
import {
  MORANDI_TAG_COLORS,
  TAG_MINGCUTE_ICONS
} from "../src/services/tag-catalog-service";

const ADMIN_TOKEN = "test-admin-token";
const TEST_WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const TEST_USER_ID = "10000000-0000-4000-8000-000000000002";
const TEST_SESSION_TOKEN = "test-web-session-token";
const TEST_CSRF_TOKEN = "test-web-csrf-token";
const databases: Database[] = [];

function testConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir: ".",
    databasePath: ":memory:",
    webRoot: join(import.meta.dir, "fixtures/missing-dashboard"),
    allowedOrigins: ["http://localhost:5173"],
    leaseSeconds: 45,
    runnerOfflineSeconds: 30,
    pairingTtlSeconds: 600,
    runnerCommandTtlSeconds: 900
  };
}

function createTestApp(): ReturnType<typeof createServerApp> {
  const database = createDatabase(":memory:");
  databases.push(database);
  const now = "2026-07-27T00:00:00.000Z";
  database.run(
    `INSERT INTO users(id, email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [TEST_USER_ID, "tags@example.com", "test-password-hash", "Tag Flow", now, now]
  );
  database.run(
    `INSERT INTO workspaces(id, name, owner_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [TEST_WORKSPACE_ID, "Tag Workspace", TEST_USER_ID, now, now]
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

async function setupManagedProject(app: ReturnType<typeof createServerApp>): Promise<{
  runnerToken: string;
  project: RegisterProjectResponse;
}> {
  const pairing = (await (
    await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN })
  ).json()) as CreatePairingResponse;
  const exchange = (await (
    await request(app, "/api/pairings/exchange", {
      method: "POST",
      body: {
        code: pairing.code,
        runnerName: "Tag runner",
        hostname: "tag-host",
        platform: "test/x64",
        version: "0.1.7",
        supportedWorkers: ["codex"],
        capabilities: ["project_manager_v1"]
      }
    })
  ).json()) as ExchangePairingResponse;
  const registration = (await (
    await request(app, "/api/runner/projects", {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        externalKey: "local:tag-catalog-project",
        name: "Tag Project",
        workspaceLabel: "tag-project"
      }
    })
  ).json()) as RegisterProjectResponse;
  return { runnerToken: exchange.runnerToken, project: registration };
}

async function createTodo(
  app: ReturnType<typeof createServerApp>,
  projectId: string,
  body: { title: string; details?: string; tags?: string[]; workerKind?: string }
): Promise<Todo> {
  return (await (
    await request(app, `/api/projects/${projectId}/todos`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { workerKind: "codex", ...body }
    })
  ).json()) as Todo;
}

async function claimManagerJob(
  app: ReturnType<typeof createServerApp>,
  runnerToken: string
): Promise<ClaimProjectManagerJobResponse> {
  return (await (
    await request(app, "/api/runner/project-manager/claim", {
      method: "POST",
      token: runnerToken
    })
  ).json()) as ClaimProjectManagerJobResponse;
}

async function completeManagerJob(
  app: ReturnType<typeof createServerApp>,
  runnerToken: string,
  todoId: string,
  claim: ClaimProjectManagerJobResponse,
  body: { tags?: string[]; title?: string; summary?: string; brief?: string }
): Promise<Response> {
  return request(app, `/api/runner/project-manager/${todoId}/complete`, {
    method: "POST",
    token: runnerToken,
    body: {
      leaseToken: claim.job!.leaseToken,
      managerWorkerKind: "codex",
      selectedWorkerKind: "codex",
      workflowId: null,
      workflowTitle: body.title ?? "Tag workflow",
      workflowSummary: body.summary ?? "Keep the tag flow working.",
      dispatchBrief: body.brief ?? "Continue.",
      ...(body.tags !== undefined ? { tags: body.tags } : {})
    }
  });
}

function catalogOf(project: DashboardSnapshot["projects"][number]): Record<string, unknown> {
  if (!project.tagCatalog) return {};
  return JSON.parse(project.tagCatalog) as Record<string, unknown>;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("Leader tag registration", () => {
  it("applies Leader tags to the Todo and registers them with Morandi colors and mingcute icons", async () => {
    const app = createTestApp();
    const { runnerToken, project } = await setupManagedProject(app);
    const todo = await createTodo(app, project.project.id, {
      title: "修复登录认证",
      details: "补齐刷新令牌处理。"
    });
    const claim = await claimManagerJob(app, runnerToken);
    expect(claim.job?.todo.id).toBe(todo.id);

    const complete = await completeManagerJob(app, runnerToken, todo.id, claim, {
      tags: ["认证", "后端"],
      title: "认证修复",
      summary: "修复登录认证。",
      brief: "继续认证上下文。"
    });
    expect(complete.status).toBe(200);
    const dispatch = (await complete.json()) as CompleteProjectManagerJobResponse;
    expect(dispatch.todo.tags).toEqual(["认证", "后端"]);

    const dashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    const managedProject = dashboard.projects.find((item) => item.id === project.project.id);
    expect(managedProject).toBeDefined();
    const catalog = catalogOf(managedProject!);
    for (const tag of ["认证", "后端"]) {
      const definition = catalog[tag] as { color: string; icon: string } | undefined;
      expect(definition).toBeDefined();
      expect(MORANDI_TAG_COLORS as readonly string[]).toContain(definition!.color);
      expect(TAG_MINGCUTE_ICONS as readonly string[]).toContain(definition!.icon);
    }
  });

  it("keeps catalog colors stable and preserves user-set tags when merging", async () => {
    const app = createTestApp();
    const { runnerToken, project } = await setupManagedProject(app);
    const first = await createTodo(app, project.project.id, {
      title: "Implement token refresh",
      details: "Add the refresh endpoint."
    });
    let claim = await claimManagerJob(app, runnerToken);
    await completeManagerJob(app, runnerToken, first.id, claim, { tags: ["auth", "backend"] });

    const firstDashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    const firstCatalog = catalogOf(firstDashboard.projects.find((item) => item.id === project.project.id)!);
    const firstAuthDefinition = firstCatalog["auth"] as { color: string; icon: string };
    expect(MORANDI_TAG_COLORS as readonly string[]).toContain(firstAuthDefinition.color);
    expect(TAG_MINGCUTE_ICONS as readonly string[]).toContain(firstAuthDefinition.icon);

    const second = await createTodo(app, project.project.id, {
      title: "Test refresh expiry",
      details: "Cover expiry handling.",
      tags: ["前端"]
    });
    claim = await claimManagerJob(app, runnerToken);
    expect(claim.job?.todo.id).toBe(second.id);
    const complete = await completeManagerJob(app, runnerToken, second.id, claim, { tags: ["auth"] });
    expect(complete.status).toBe(200);
    const dispatch = (await complete.json()) as CompleteProjectManagerJobResponse;
    // Leader 标签在前，用户已有标签保留，合并后不重复。
    expect(dispatch.todo.tags).toEqual(["auth", "前端"]);

    const dashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    const managedProject = dashboard.projects.find((item) => item.id === project.project.id);
    const catalog = catalogOf(managedProject!);
    // 同一标签重复注册时配色与图标保持固定。
    expect(catalog["auth"]).toEqual(firstAuthDefinition);
  });

  it("caps merged tags at three and drops foreign-language tags for Chinese workspaces", async () => {
    const app = createTestApp();
    const executionUpdate = await request(app, "/api/settings/execution", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { aiOutputLanguage: "zh" }
    });
    expect(executionUpdate.status).toBe(200);

    const { runnerToken, project } = await setupManagedProject(app);
    const todo = await createTodo(app, project.project.id, {
      title: "修复登录认证",
      details: "补齐刷新令牌处理。",
      tags: ["前端"]
    });
    const claim = await claimManagerJob(app, runnerToken);
    const complete = await completeManagerJob(app, runnerToken, todo.id, claim, {
      tags: ["认证", "auth", "后端", "测试"]
    });
    expect(complete.status).toBe(200);
    const dispatch = (await complete.json()) as CompleteProjectManagerJobResponse;
    // "auth" 是英文标签被过滤；Leader 标签 3 个已满，用户标签不再挤入。
    expect(dispatch.todo.tags).toEqual(["认证", "后端", "测试"]);
  });

  it("leaves existing tags untouched when the Leader returns none", async () => {
    const app = createTestApp();
    const { runnerToken, project } = await setupManagedProject(app);
    const todo = await createTodo(app, project.project.id, {
      title: "Implement token refresh",
      details: "Add the refresh endpoint.",
      tags: ["auth"]
    });
    const claim = await claimManagerJob(app, runnerToken);
    const complete = await completeManagerJob(app, runnerToken, todo.id, claim, {});
    expect(complete.status).toBe(200);
    const dispatch = (await complete.json()) as CompleteProjectManagerJobResponse;
    expect(dispatch.todo.tags).toEqual(["auth"]);
  });

  it("registers manually created tags when a Todo is updated like a status change", async () => {
    const app = createTestApp();
    const { project } = await setupManagedProject(app);
    const todo = await createTodo(app, project.project.id, {
      title: "Manual tag edit",
      details: "Edit tags from the board."
    });

    // 看板保存：PATCH 标签（手动创建/变更，不去做语言过滤，只去重并截断到 3 个）。
    const patched = (await (
      await request(app, `/api/todos/${todo.id}`, {
        method: "PATCH",
        token: ADMIN_TOKEN,
        body: { tags: ["手动", "Manual", "手动", "extra", "one-more"] }
      })
    ).json()) as Todo;
    expect(patched.tags).toEqual(["手动", "Manual", "extra"]);

    const dashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    const managedProject = dashboard.projects.find((item) => item.id === project.project.id);
    const catalog = catalogOf(managedProject!);
    for (const tag of ["手动", "manual", "extra"]) {
      const definition = catalog[tag] as { color: string; icon: string } | undefined;
      expect(definition).toBeDefined();
      expect(MORANDI_TAG_COLORS as readonly string[]).toContain(definition!.color);
      expect(TAG_MINGCUTE_ICONS as readonly string[]).toContain(definition!.icon);
    }
  });
});

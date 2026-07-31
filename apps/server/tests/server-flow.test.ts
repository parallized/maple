import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { DEFAULT_SCREENSHOT_COMPRESSION_PRESET } from "@maple/protocol";
import type {
  ClaimJobResponse,
  ClaimProjectManagerJobResponse,
  ClaimRunnerCommandResponse,
  CreatePairingResponse,
  DashboardSnapshot,
  CompleteProjectManagerJobResponse,
  ExchangePairingResponse,
  RegisterProjectResponse,
  RunnerCommand,
  RunnerCommandListResponse,
  RunnerRunListResponse,
  RunnerRunLogResponse,
  Todo,
  TodoDetailResponse,
  UploadTodoArtifactResponse,
  WorkspaceExecutionSettings
} from "@maple/protocol";
import { createServerApp } from "../src/app";
import {
  normalizeScreenshot,
  SCREENSHOT_COMPRESSION_PROFILES
} from "../src/artifacts/screenshot-image";
import type { ServerConfig } from "../src/config";
import { createDatabase } from "../src/database/client";
import { hashSecret } from "../src/lib/crypto";

const ADMIN_TOKEN = "test-admin-token";
const TEST_WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const TEST_USER_ID = "10000000-0000-4000-8000-000000000002";
const TEST_SESSION_TOKEN = "test-web-session-token";
const TEST_CSRF_TOKEN = "test-web-csrf-token";
const databases: Database[] = [];
const temporaryDirectories: string[] = [];

function testConfig(webRoot = join(import.meta.dir, "fixtures/missing-dashboard")): ServerConfig {
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
  return createAuthenticatedTestApp(database, testConfig());
}

function seedTestAccount(database: Database): void {
  const now = "2026-07-27T00:00:00.000Z";
  database.run(
    `INSERT OR IGNORE INTO users(id, email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [TEST_USER_ID, "server-flow@example.com", "test-password-hash", "Server Flow", now, now]
  );
  database.run(
    `INSERT OR IGNORE INTO workspaces(id, name, owner_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [TEST_WORKSPACE_ID, "Server Flow Workspace", TEST_USER_ID, now, now]
  );
  database.run(
    `INSERT OR IGNORE INTO workspace_members(workspace_id, user_id, role, created_at)
     VALUES (?, ?, 'owner', ?)`,
    [TEST_WORKSPACE_ID, TEST_USER_ID, now]
  );
  database.run(
    `INSERT OR IGNORE INTO web_sessions(
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
}

function createAuthenticatedTestApp(database: Database, config: ServerConfig) {
  seedTestAccount(database);
  return createServerApp({ config, database });
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
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Maple Server execution flow", () => {
  it("purges the unreleased placeholder workspace and its legacy records", () => {
    const directory = mkdtempSync(join(tmpdir(), "maple-worker-migration-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "legacy.sqlite");
    const legacy = new Database(databasePath, { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        external_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        repository_url TEXT,
        default_branch TEXT,
        tag_catalog_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runners (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        hostname TEXT NOT NULL,
        platform TEXT NOT NULL,
        version TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE project_bindings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        runner_id TEXT NOT NULL,
        workspace_label TEXT NOT NULL,
        worker_kind TEXT NOT NULL,
        git_branch TEXT,
        git_head TEXT,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, runner_id)
      );
      CREATE TABLE runner_commands (
        id TEXT PRIMARY KEY,
        runner_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        worker_kind TEXT NOT NULL,
        lease_token_hash TEXT,
        lease_expires_at TEXT,
        result_project_id TEXT,
        result_binding_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT
      );
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        preferred_worker TEXT,
        claimed_by_runner_id TEXT,
        active_attempt_id TEXT,
        lease_token_hash TEXT,
        lease_expires_at TEXT,
        result_summary TEXT,
        last_error TEXT,
        tags_json TEXT,
        details_doc TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
    `);
    const now = "2026-07-27T00:00:00.000Z";
    for (const projectId of ["project-preferred", "project-binding", "project-default"]) {
      legacy.run(
        `INSERT INTO projects(id, external_key, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [projectId, `local:${projectId}`, projectId, now, now]
      );
    }
    legacy.run(
      `INSERT INTO runners(id, token_hash, name, hostname, platform, version, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["runner-legacy", "legacy-token", "Legacy runner", "legacy-host", "test/x64", "0.1.6", now, now]
    );
    legacy.run(
      `INSERT INTO project_bindings(
         id, project_id, runner_id, workspace_label, worker_kind, last_seen_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["binding-preferred", "project-preferred", "runner-legacy", "preferred", "codex", now, now, now]
    );
    legacy.run(
      `INSERT INTO project_bindings(
         id, project_id, runner_id, workspace_label, worker_kind, last_seen_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["binding-fallback", "project-binding", "runner-legacy", "fallback", "glm", now, now, now]
    );
    for (const [id, projectId, preferredWorker] of [
      ["todo-preferred", "project-preferred", "kimi"],
      ["todo-binding", "project-binding", null],
      ["todo-default", "project-default", null]
    ] as const) {
      legacy.run(
        `INSERT INTO todos(
           id, project_id, title, status, priority, preferred_worker, created_at, updated_at
         ) VALUES (?, ?, ?, 'todo', 0, ?, ?, ?)`,
        [id, projectId, id, preferredWorker, now, now]
      );
    }
    legacy.close();

    const database = createDatabase(databasePath);
    databases.push(database);
    const workers = database
      .query("SELECT id, worker_kind FROM todos ORDER BY id")
      .all() as Array<{ id: string; worker_kind: string }>;
    expect(workers).toEqual([]);
    expect(database.query("SELECT COUNT(*) AS count FROM projects").get()).toEqual({ count: 0 });
    expect(database.query("SELECT COUNT(*) AS count FROM runners").get()).toEqual({ count: 0 });
    expect(database.query("SELECT * FROM workspaces WHERE id = ?").get("00000000-0000-4000-8000-000000000001"))
      .toBeNull();

    const columns = (table: string) =>
      (database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns("todos")).toContain("worker_kind");
    expect(columns("todos")).not.toContain("preferred_worker");
    expect(columns("project_bindings")).not.toContain("worker_kind");
    expect(columns("runner_commands")).not.toContain("worker_kind");
  });

  it("rebuilds the legacy Todo Worker constraint and preserves every public task field", () => {
    const directory = mkdtempSync(join(tmpdir(), "maple-deepseek-worker-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "maple.sqlite");
    const initial = createDatabase(databasePath);
    seedTestAccount(initial);
    const now = "2026-07-31T00:00:00.000Z";
    initial.run(
      `INSERT INTO projects(id, workspace_id, external_key, workspace_external_key, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["project-deepseek-migration", TEST_WORKSPACE_ID, "local:deepseek-migration", "local:deepseek-migration", "DeepSeek", now, now]
    );
    initial.exec("PRAGMA foreign_keys = OFF;");
    initial.exec(`
      DROP TABLE todos;
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        worker_kind TEXT NOT NULL CHECK(worker_kind IN ('codex', 'claude', 'kimi', 'glm', 'iflow', 'gemini', 'opencode')),
        claimed_by_runner_id TEXT REFERENCES runners(id) ON DELETE SET NULL,
        active_attempt_id TEXT,
        lease_token_hash TEXT,
        lease_expires_at TEXT,
        retry_after TEXT,
        result_summary TEXT,
        last_error TEXT,
        tags_json TEXT,
        details_doc TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
    `);
    initial.run(
      `INSERT INTO todos(
         id, project_id, title, details, status, priority, worker_kind, retry_after,
         result_summary, last_error, tags_json, details_doc, created_at, updated_at, started_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "todo-before-deepseek",
        "project-deepseek-migration",
        "保留任务",
        "保留详情",
        "blocked",
        7,
        "codex",
        "2026-07-31T00:01:00.000Z",
        "保留结果",
        "保留错误",
        '["provider"]',
        '{"type":"doc"}',
        now,
        now,
        now,
        now
      ]
    );
    initial.close();

    const migrated = createDatabase(databasePath);
    databases.push(migrated);
    expect(migrated.query("SELECT * FROM todos WHERE id = ?").get("todo-before-deepseek")).toMatchObject({
      title: "保留任务",
      details: "保留详情",
      priority: 7,
      worker_kind: "codex",
      retry_after: "2026-07-31T00:01:00.000Z",
      result_summary: "保留结果",
      last_error: "保留错误",
      tags_json: '["provider"]',
      details_doc: '{"type":"doc"}'
    });

    migrated.run(
      `INSERT INTO todos(id, project_id, title, status, worker_kind, created_at, updated_at)
       VALUES (?, ?, ?, 'todo', 'deepseek', ?, ?)`,
      ["todo-deepseek", "project-deepseek-migration", "DeepSeek Flash", now, now]
    );
    expect(migrated.query("SELECT worker_kind FROM todos WHERE id = ?").get("todo-deepseek"))
      .toEqual({ worker_kind: "deepseek" });

    const indexes = migrated
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'todos'")
      .all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
      "idx_todos_project_status",
      "idx_todos_lease",
      "idx_todos_retry"
    ]));
  });

  it("migrates legacy raw log tables without losing compatibility", () => {
    const directory = mkdtempSync(join(tmpdir(), "maple-log-migration-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "legacy.sqlite");
    const legacy = new Database(databasePath, { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE todo_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id TEXT NOT NULL,
        stream TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const database = createDatabase(databasePath);
    databases.push(database);
    const columns = database.query("PRAGMA table_info(todo_logs)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "attempt_id",
      "stream",
      "content",
      "created_at",
      "sequence",
      "occurred_at",
      "kind",
      "level",
      "status",
      "title",
      "group_id",
      "delivery_id"
    ]);

    database.run(
      "INSERT INTO todo_logs(attempt_id, stream, content, created_at) VALUES (?, ?, ?, ?)",
      ["legacy-attempt", "stdout", "legacy output", "2026-07-27T00:00:00.000Z"]
    );
    const row = database.query("SELECT * FROM todo_logs WHERE attempt_id = ?").get("legacy-attempt") as {
      sequence: number;
      occurred_at: string | null;
      kind: string;
      level: string;
    };
    expect(row).toMatchObject({ sequence: 0, occurred_at: null, kind: "raw", level: "info" });
  });

  it("removes the legacy Maple CLI suffix only from generated device names", () => {
    const directory = mkdtempSync(join(tmpdir(), "maple-runner-name-migration-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "maple.sqlite");
    const createdAt = "2026-07-27T00:00:00.000Z";
    const expiresAt = "2026-07-28T00:00:00.000Z";
    const initial = createDatabase(databasePath);
    seedTestAccount(initial);
    initial.run(
      `INSERT INTO runners(
         id, workspace_id, token_hash, name, hostname, platform, version, last_seen_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'win32/x64', '0.1.7', ?, ?)`,
      ["generated-runner", TEST_WORKSPACE_ID, "token-generated", "holybread · Maple CLI", "holybread", createdAt, createdAt]
    );
    initial.run(
      `INSERT INTO runners(
         id, workspace_id, token_hash, name, hostname, platform, version, last_seen_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'win32/x64', '0.1.7', ?, ?)`,
      ["custom-runner", TEST_WORKSPACE_ID, "token-custom", "Studio · Maple CLI", "studio-host", createdAt, createdAt]
    );
    initial.run(
      `INSERT INTO device_authorizations(
         id, device_code_hash, user_code_hash, code_challenge, runner_name,
         hostname, platform, version, state, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'win32/x64', '0.1.7', 'pending', ?, ?)`,
      [
        "authorization-1",
        "device-hash",
        "user-hash",
        "challenge",
        "holybread · Maple CLI",
        "holybread",
        createdAt,
        expiresAt
      ]
    );
    initial.close();

    const migrated = createDatabase(databasePath);
    databases.push(migrated);
    expect(migrated.query("SELECT name FROM runners WHERE id = ?").get("generated-runner"))
      .toEqual({ name: "holybread" });
    expect(migrated.query("SELECT name FROM runners WHERE id = ?").get("custom-runner"))
      .toEqual({ name: "Studio · Maple CLI" });
    expect(migrated.query("SELECT runner_name FROM device_authorizations WHERE id = ?").get("authorization-1"))
      .toEqual({ runner_name: "holybread" });
  });

  it("serves the dashboard and API from one online service", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "maple-dashboard-test-"));
    temporaryDirectories.push(webRoot);
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Maple dashboard</title>", "utf8");
    writeFileSync(join(webRoot, "assets/app.js"), "console.log('maple');\n", "utf8");
    writeFileSync(join(webRoot, "install.ps1"), "$server='__MAPLE_SERVER_URL__'\n", "utf8");
    writeFileSync(join(webRoot, "install-local.sh"), "server='__MAPLE_SERVER_URL__'\n", "utf8");

    const database = createDatabase(":memory:");
    databases.push(database);
    const app = createAuthenticatedTestApp(database, testConfig(webRoot));

    const dashboard = await request(app, "/");
    expect(dashboard.status).toBe(200);
    expect(dashboard.headers.get("content-type")).toContain("text/html");
    expect(dashboard.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(await dashboard.text()).toContain("Maple dashboard");

    const clientRoute = await request(app, "/projects/maple");
    expect(clientRoute.status).toBe(200);
    expect(await clientRoute.text()).toContain("Maple dashboard");

    const asset = await request(app, "/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const missingAsset = await request(app, "/assets/missing.js");
    expect(missingAsset.status).toBe(404);

    const installer = await request(app, "/install.ps1");
    expect(installer.status).toBe(200);
    expect(installer.headers.get("cache-control")).toBe("no-store");
    const installerContent = await installer.text();
    expect(installerContent).toContain("http://maple.test");
    expect(installerContent).not.toContain("__MAPLE_SERVER_URL__");

    const localInstaller = await request(app, "/install-local.sh");
    expect(localInstaller.status).toBe(200);
    expect(localInstaller.headers.get("content-type")).toContain("text/x-shellscript");
    expect(localInstaller.headers.get("cache-control")).toBe("no-store");
    const localInstallerContent = await localInstaller.text();
    expect(localInstallerContent).toContain("http://maple.test");
    expect(localInstallerContent).not.toContain("__MAPLE_SERVER_URL__");

    const missingApi = await request(app, "/api/missing");
    expect(missingApi.status).toBe(404);
    expect(await missingApi.json()).toEqual({
      error: { code: "not_found", message: "API 接口不存在。" }
    });

    const missingMutation = await request(app, "/api/missing", { method: "POST" });
    expect(missingMutation.status).toBe(404);
    expect(await missingMutation.json()).toEqual({
      error: { code: "not_found", message: "请求的接口或资源不存在。" }
    });
  });

  it("deletes all Server project records without touching the workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "maple-project-delete-test-"));
    temporaryDirectories.push(workspace);
    const marker = join(workspace, "keep.txt");
    writeFileSync(marker, "keep", "utf8");

    const database = createDatabase(":memory:");
    databases.push(database);
    const app = createAuthenticatedTestApp(database, testConfig());
    const now = "2026-07-27T00:00:00.000Z";
    database.run(
      `INSERT INTO runners(id, workspace_id, token_hash, name, hostname, platform, version, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["runner-delete", TEST_WORKSPACE_ID, "token-delete", "Delete runner", "host", "test", "0.1.7", now, now]
    );
    database.run(
      `INSERT INTO projects(id, workspace_id, external_key, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["project-delete", TEST_WORKSPACE_ID, "local:delete", "Delete project", now, now]
    );
    database.run(
      `INSERT INTO project_bindings(id, project_id, runner_id, workspace_label, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["binding-delete", "project-delete", "runner-delete", workspace, now, now, now]
    );
    database.run(
      `INSERT INTO project_workflows(id, project_id, title, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["workflow-delete", "project-delete", "Delete workflow", "Delete summary", now, now]
    );
    database.run(
      `INSERT INTO todos(id, project_id, title, status, worker_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["todo-delete", "project-delete", "Delete todo", "review", "codex", now, now]
    );
    database.run(
      `INSERT INTO todo_attempts(id, todo_id, runner_id, worker_kind, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["attempt-delete", "todo-delete", "runner-delete", "codex", "succeeded", now]
    );
    database.run(
      `INSERT INTO todo_logs(attempt_id, stream, content, created_at)
       VALUES (?, ?, ?, ?)`,
      ["attempt-delete", "stdout", "Delete log", now]
    );
    database.run(
      `INSERT INTO todo_routes(todo_id, workflow_id, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["todo-delete", "workflow-delete", "routed", now, now]
    );

    const response = await request(app, "/api/projects/project-delete", {
      method: "DELETE",
      token: ADMIN_TOKEN
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    for (const table of [
      "projects",
      "project_bindings",
      "project_workflows",
      "todos",
      "todo_routes",
      "todo_attempts",
      "todo_logs",
      "todo_artifacts"
    ]) {
      expect((database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count).toBe(0);
    }
    expect((database.query("SELECT COUNT(*) AS count FROM runners").get() as { count: number }).count).toBe(1);
    expect(existsSync(marker)).toBe(true);
    expect(await Bun.file(marker).text()).toBe("keep");
  });

  it("pairs a runner, registers a local project and completes a claimed Todo", async () => {
    const app = createTestApp();

    const unauthorized = await request(app, "/api/dashboard");
    expect(unauthorized.status).toBe(401);

    const pairingResponse = await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN });
    expect(pairingResponse.status).toBe(200);
    const pairing = (await pairingResponse.json()) as CreatePairingResponse;
    expect(pairing.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const exchangeResponse = await request(app, "/api/pairings/exchange", {
      method: "POST",
      body: {
        code: pairing.code,
        runnerName: "Test runner",
        hostname: "test-host",
        platform: "test/x64",
        version: "0.1.6"
      }
    });
    expect(exchangeResponse.status).toBe(200);
    const exchange = (await exchangeResponse.json()) as ExchangePairingResponse;
    expect(exchange.runnerToken.length).toBeGreaterThan(20);

    const reusedCode = await request(app, "/api/pairings/exchange", {
      method: "POST",
      body: {
        code: pairing.code,
        runnerName: "Second runner",
        hostname: "test-host",
        platform: "test/x64",
        version: "0.1.6"
      }
    });
    expect(reusedCode.status).toBe(410);

    const projectResponse = await request(app, "/api/runner/projects", {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        externalKey: "git:1234567890abcdef",
        name: "Maple Test",
        repositoryUrl: "https://example.com/maple.git",
        defaultBranch: "main",
        workspaceLabel: "maple-test",
        gitBranch: "main",
        gitHead: "0123456789abcdef"
      }
    });
    expect(projectResponse.status).toBe(200);
    const registration = (await projectResponse.json()) as RegisterProjectResponse;
    expect(registration.project.name).toBe("Maple Test");
    expect("workerKind" in registration.binding).toBe(false);

    const missingWorkerResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { title: "Missing task worker", status: "todo" }
    });
    expect(missingWorkerResponse.status).toBe(422);

    const todoResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: {
        title: "Implement server flow",
        details: "Run the integration test.",
        status: "todo",
        workerKind: "codex"
      }
    });
    expect(todoResponse.status).toBe(200);
    const createdTodo = (await todoResponse.json()) as Todo;

    const claimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      token: exchange.runnerToken
    });
    expect(claimResponse.status).toBe(200);
    const claim = (await claimResponse.json()) as ClaimJobResponse;
    expect(claim.job?.todo.id).toBe(createdTodo.id);
    expect(claim.job?.attempt.workerKind).toBe("codex");

    const job = claim.job!;
    const start = await request(app, `/api/runner/jobs/${job.todo.id}/start`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: job.leaseToken }
    });
    expect(start.status).toBe(200);

    const log = await request(app, `/api/runner/jobs/${job.todo.id}/logs`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: job.leaseToken, stream: "stdout", content: "typecheck passed\n" }
    });
    expect(log.status).toBe(200);

    const structuredOccurredAt = "2026-07-27T08:00:00.000Z";
    const structuredLog = await request(app, `/api/runner/jobs/${job.todo.id}/logs`, {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        leaseToken: job.leaseToken,
        sequence: 7,
        occurredAt: structuredOccurredAt,
        stream: "stdout",
        kind: "command",
        level: "info",
        status: "completed",
        title: "bun test",
        content: "41 tests passed",
        groupId: "command-1"
      }
    });
    expect(structuredLog.status).toBe(200);

    const unauthenticatedRuns = await request(app, "/api/runner/runs");
    expect(unauthenticatedRuns.status).toBe(401);
    const liveRunsResponse = await request(app, "/api/runner/runs?limit=10", {
      token: exchange.runnerToken
    });
    expect(liveRunsResponse.status).toBe(200);
    const liveRuns = (await liveRunsResponse.json()) as RunnerRunListResponse;
    expect(liveRuns.runs[0]).toMatchObject({
      attemptId: job.attempt.id,
      todoId: job.todo.id,
      todoTitle: "Implement server flow",
      projectName: "Maple Test",
      workerKind: "codex",
      state: "running"
    });

    const firstLogPageResponse = await request(
      app,
      `/api/runner/runs/${job.attempt.id}/logs?after=0&limit=1`,
      { token: exchange.runnerToken }
    );
    const firstLogPage = (await firstLogPageResponse.json()) as RunnerRunLogResponse;
    expect(firstLogPage.logs).toHaveLength(1);
    expect(firstLogPage.logs[0]).toMatchObject({
      attemptId: job.attempt.id,
      sequence: 0,
      stream: "stdout",
      kind: "raw",
      level: "info",
      content: "typecheck passed\n"
    });
    expect(firstLogPage.logs[0]?.occurredAt).toBeString();
    expect(firstLogPage.nextAfterId).toBe(firstLogPage.logs[0]?.id);

    const nextLogPageResponse = await request(
      app,
      `/api/runner/runs/${job.attempt.id}/logs?after=${firstLogPage.nextAfterId}&limit=10`,
      { token: exchange.runnerToken }
    );
    const nextLogPage = (await nextLogPageResponse.json()) as RunnerRunLogResponse;
    expect(nextLogPage.logs).toHaveLength(1);
    expect(nextLogPage.logs[0]).toMatchObject({
      sequence: 7,
      occurredAt: structuredOccurredAt,
      kind: "command",
      status: "completed",
      title: "bun test",
      content: "41 tests passed",
      groupId: "command-1"
    });

    const complete = await request(app, `/api/runner/jobs/${job.todo.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: job.leaseToken, success: true, exitCode: 0, summary: "Implemented and verified." }
    });
    expect(complete.status).toBe(200);

    const dashboardResponse = await request(app, "/api/dashboard", { token: ADMIN_TOKEN });
    const dashboard = (await dashboardResponse.json()) as DashboardSnapshot;
    const completedTodo = dashboard.todos.find((todo) => todo.id === createdTodo.id);
    expect(completedTodo?.status).toBe("review");
    expect(completedTodo?.resultSummary).toBe("Implemented and verified.");

    const detailResponse = await request(app, `/api/todos/${createdTodo.id}`, { token: ADMIN_TOKEN });
    const detail = (await detailResponse.json()) as TodoDetailResponse;
    expect(detail.logs.map((entry) => entry.content).join("")).toContain("typecheck passed");
    expect(detail.logs[1]).toMatchObject({
      sequence: 7,
      occurredAt: structuredOccurredAt,
      kind: "command",
      level: "info",
      status: "completed",
      title: "bun test",
      groupId: "command-1"
    });

    const invalidPagination = await request(app, "/api/runner/runs?limit=0", {
      token: exchange.runnerToken
    });
    expect(invalidPagination.status).toBe(422);

    const secondPairingResponse = await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN });
    const secondPairing = (await secondPairingResponse.json()) as CreatePairingResponse;
    const secondExchangeResponse = await request(app, "/api/pairings/exchange", {
      method: "POST",
      body: {
        code: secondPairing.code,
        runnerName: "Isolated runner",
        hostname: "isolated-host",
        platform: "test/x64",
        version: "0.1.7"
      }
    });
    const secondExchange = (await secondExchangeResponse.json()) as ExchangePairingResponse;
    const foreignLogs = await request(app, `/api/runner/runs/${job.attempt.id}/logs`, {
      token: secondExchange.runnerToken
    });
    expect(foreignLogs.status).toBe(404);
    const isolatedRunsResponse = await request(app, "/api/runner/runs", {
      token: secondExchange.runnerToken
    });
    expect(((await isolatedRunsResponse.json()) as RunnerRunListResponse).runs).toEqual([]);

    const cancellableResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { title: "Cancel an active job", status: "todo", workerKind: "codex" }
    });
    const cancellable = (await cancellableResponse.json()) as Todo;
    const secondClaimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      token: exchange.runnerToken
    });
    const secondClaim = (await secondClaimResponse.json()) as ClaimJobResponse;
    expect(secondClaim.job?.todo.id).toBe(cancellable.id);
    const secondJob = secondClaim.job!;
    await request(app, `/api/runner/jobs/${secondJob.todo.id}/start`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: secondJob.leaseToken }
    });

    const cancelResponse = await request(app, `/api/todos/${secondJob.todo.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { status: "cancelled" }
    });
    expect(cancelResponse.status).toBe(200);
    const staleHeartbeat = await request(app, `/api/runner/jobs/${secondJob.todo.id}/heartbeat`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: secondJob.leaseToken }
    });
    expect(staleHeartbeat.status).toBe(409);
  });

  it("stores the default Worker and Leader PM Worker independently", async () => {
    const app = createTestApp();

    const initial = (await (
      await request(app, "/api/settings/execution", { token: ADMIN_TOKEN })
    ).json()) as WorkspaceExecutionSettings;
    expect(initial).toMatchObject({
      defaultWorker: "claude",
      leaderWorker: "claude",
      baseWorker: "claude"
    });

    const defaultUpdate = await request(app, "/api/settings/execution", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { defaultWorker: "kimi" }
    });
    expect(defaultUpdate.status).toBe(200);
    expect(await defaultUpdate.json()).toMatchObject({
      defaultWorker: "kimi",
      leaderWorker: "claude",
      baseWorker: "kimi"
    });

    const leaderUpdate = await request(app, "/api/settings/execution", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { leaderWorker: "glm" }
    });
    expect(leaderUpdate.status).toBe(200);
    expect(await leaderUpdate.json()).toMatchObject({
      defaultWorker: "kimi",
      leaderWorker: "glm",
      baseWorker: "kimi"
    });

    const legacyUpdate = await request(app, "/api/settings/execution", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { baseWorker: "opencode" }
    });
    expect(legacyUpdate.status).toBe(200);
    expect(await legacyUpdate.json()).toMatchObject({
      defaultWorker: "opencode",
      leaderWorker: "opencode",
      baseWorker: "opencode"
    });
  });

  it("persists screenshot acceptance and stores authenticated task artifacts", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "maple-artifact-test-"));
    temporaryDirectories.push(dataDir);
    const database = createDatabase(":memory:");
    databases.push(database);
    const app = createAuthenticatedTestApp(database, { ...testConfig(), dataDir });

    const initialDashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    expect(initialDashboard.settings.acceptance).toEqual({
      backgroundPlaywrightScreenshot: false,
      screenshotCompressionPreset: DEFAULT_SCREENSHOT_COMPRESSION_PRESET
    });

    const updatePreset = await request(app, "/api/settings/acceptance", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { screenshotCompressionPreset: "high" }
    });
    expect(updatePreset.status).toBe(200);
    expect(await updatePreset.json()).toEqual({
      backgroundPlaywrightScreenshot: false,
      screenshotCompressionPreset: "high"
    });

    const updateSettings = await request(app, "/api/settings/acceptance", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { backgroundPlaywrightScreenshot: true }
    });
    expect(updateSettings.status).toBe(200);
    expect(await updateSettings.json()).toEqual({
      backgroundPlaywrightScreenshot: true,
      screenshotCompressionPreset: "high"
    });

    const invalidPreset = await request(app, "/api/settings/acceptance", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { screenshotCompressionPreset: "unlimited" }
    });
    expect(invalidPreset.status).toBe(422);

    const pairing = (await (
      await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN })
    ).json()) as CreatePairingResponse;
    const exchange = (await (
      await request(app, "/api/pairings/exchange", {
        method: "POST",
        body: {
          code: pairing.code,
          runnerName: "Artifact runner",
          hostname: "artifact-host",
          platform: "test/x64",
          version: "0.1.7"
        }
      })
    ).json()) as ExchangePairingResponse;
    const registration = (await (
      await request(app, "/api/runner/projects", {
        method: "POST",
        token: exchange.runnerToken,
        body: {
          externalKey: "git:artifact-test-123456",
          name: "Artifact project",
          workspaceLabel: "artifact-project"
        }
      })
    ).json()) as RegisterProjectResponse;
    const todo = (await (
      await request(app, `/api/projects/${registration.project.id}/todos`, {
        method: "POST",
        token: ADMIN_TOKEN,
        body: { title: "Capture acceptance", status: "todo", workerKind: "codex" }
      })
    ).json()) as Todo;
    const claim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    const job = claim.job!;
    expect(job.todo.id).toBe(todo.id);
    expect(job.acceptanceSettings).toEqual({
      backgroundPlaywrightScreenshot: true,
      screenshotCompressionPreset: "high"
    });
    expect(job.attempt.acceptanceSettings).toEqual(job.acceptanceSettings);

    const switchFutureTasksToCompact = await request(app, "/api/settings/acceptance", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { screenshotCompressionPreset: "compact" }
    });
    expect(await switchFutureTasksToCompact.json()).toEqual({
      backgroundPlaywrightScreenshot: true,
      screenshotCompressionPreset: "compact"
    });

    await request(app, `/api/runner/jobs/${todo.id}/start`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: job.leaseToken }
    });

    const invalidForm = new FormData();
    invalidForm.set("leaseToken", job.leaseToken);
    invalidForm.set("file", new File(["not an image"], "fake.png", { type: "image/png" }));
    const invalidUpload = await app.handle(new Request(
      `http://maple.test/api/runner/jobs/${todo.id}/artifacts`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${exchange.runnerToken}` },
        body: invalidForm
      }
    ));
    expect(invalidUpload.status).toBe(422);

    const pngBytes = new Uint8Array(await sharp({
      create: {
        width: 4_000,
        height: 2_000,
        channels: 3,
        background: { r: 32, g: 96, b: 192 }
      }
    }).png().toBuffer());
    const validForm = new FormData();
    validForm.set("leaseToken", job.leaseToken);
    validForm.set("deliveryId", "artifact-delivery-1");
    validForm.set("file", new File([pngBytes], "acceptance.png", { type: "image/png" }));
    const validUpload = await app.handle(new Request(
      `http://maple.test/api/runner/jobs/${todo.id}/artifacts`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${exchange.runnerToken}` },
        body: validForm
      }
    ));
    expect(validUpload.status).toBe(200);
    const uploaded = (await validUpload.json()) as UploadTodoArtifactResponse;
    expect(uploaded.artifact).toMatchObject({
      todoId: todo.id,
      attemptId: job.attempt.id,
      kind: "screenshot",
      fileName: "acceptance.webp",
      mimeType: "image/webp"
    });
    expect(uploaded.artifact.sizeBytes).toBeGreaterThan(0);

    const stored = database
      .query("SELECT storage_name FROM todo_artifacts WHERE id = ?")
      .get(uploaded.artifact.id) as { storage_name: string };
    const storedPath = join(dataDir, "artifacts", stored.storage_name);
    expect(existsSync(storedPath)).toBe(true);
    expect(stored.storage_name.endsWith(".webp")).toBe(true);
    const storedBytes = readFileSync(storedPath);
    expect(uploaded.artifact.sizeBytes).toBe(storedBytes.byteLength);
    const storedMetadata = await sharp(storedBytes).metadata();
    expect(SCREENSHOT_COMPRESSION_PROFILES).toEqual({
      high: { maxEdge: 3200, quality: 95 },
      balanced: { maxEdge: 1600, quality: 80 },
      compact: { maxEdge: 800, quality: 70 }
    });
    expect(storedMetadata).toMatchObject({
      format: "webp",
      width: 3200,
      height: 1600
    });

    for (const [preset, width, height] of [
      ["balanced", 1600, 800],
      ["compact", 800, 400]
    ] as const) {
      const normalized = await normalizeScreenshot(pngBytes, `${preset}.png`, preset);
      expect(await sharp(normalized.bytes).metadata()).toMatchObject({ format: "webp", width, height });
    }

    const unauthorizedImage = await request(
      app,
      `/api/todos/${todo.id}/artifacts/${uploaded.artifact.id}`
    );
    expect(unauthorizedImage.status).toBe(401);
    const imageResponse = await request(
      app,
      `/api/todos/${todo.id}/artifacts/${uploaded.artifact.id}`,
      { token: ADMIN_TOKEN }
    );
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await imageResponse.arrayBuffer())).toEqual(new Uint8Array(storedBytes));

    const detail = (await (
      await request(app, `/api/todos/${todo.id}`, { token: ADMIN_TOKEN })
    ).json()) as TodoDetailResponse;
    expect(detail.artifacts).toEqual([uploaded.artifact]);

    await request(app, `/api/runner/jobs/${todo.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: job.leaseToken, success: true, exitCode: 0, summary: "截图已上传。" }
    });
    const uploadAfterCompletion = await app.handle(new Request(
      `http://maple.test/api/runner/jobs/${todo.id}/artifacts`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${exchange.runnerToken}` },
        body: validForm
      }
    ));
    expect(uploadAfterCompletion.status).toBe(409);

    const deleteProject = await request(app, `/api/projects/${registration.project.id}`, {
      method: "DELETE",
      token: ADMIN_TOKEN
    });
    expect(deleteProject.status).toBe(200);
    expect(existsSync(storedPath)).toBe(false);
    expect((database.query("SELECT COUNT(*) AS count FROM todo_artifacts").get() as { count: number }).count)
      .toBe(0);
  });

  it("stores reported worker tools on exchange and refreshes them on heartbeat", async () => {
    const app = createTestApp();

    const pairingResponse = await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN });
    const pairing = (await pairingResponse.json()) as CreatePairingResponse;

    // exchange 携带 supportedWorkers（非法项应被忽略），exchange 响应与 dashboard snapshot 都能读到
    const exchangeResponse = await request(app, "/api/pairings/exchange", {
      method: "POST",
      body: {
        code: pairing.code,
        runnerName: "Capable runner",
        hostname: "capable-host",
        platform: "test/x64",
        version: "0.1.7",
        supportedWorkers: ["codex", "kimi", "not-a-worker"],
        workerInventory: [
          {
            kind: "codex",
            available: true,
            modelId: "gpt-5.6-sol",
            modelName: "GPT 5.6 Sol",
            reasoningEffort: "ultra"
          },
          {
            kind: "not-a-worker",
            available: true,
            modelId: "invalid",
            modelName: "Invalid",
            reasoningEffort: null
          }
        ],
        capabilities: ["project_manager_v1", "unknown-capability"]
      }
    });
    expect(exchangeResponse.status).toBe(200);
    const exchange = (await exchangeResponse.json()) as ExchangePairingResponse;
    expect(exchange.runner.supportedWorkers).toEqual(["codex", "kimi"]);
    expect(exchange.runner.workerInventory).toEqual([{
      kind: "codex",
      available: true,
      modelId: "gpt-5.6-sol",
      modelName: "GPT 5.6 Sol",
      reasoningEffort: "ultra"
    }]);
    expect(exchange.runner.capabilities).toEqual(["project_manager_v1"]);

    const dashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    expect(dashboard.runners.find((runner) => runner.id === exchange.runner.id)?.supportedWorkers).toEqual([
      "codex",
      "kimi"
    ]);

    // 心跳携带 supportedWorkers 时刷新能力记录
    const heartbeatResponse = await request(app, "/api/runner/heartbeat", {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        version: "0.1.7",
        supportedWorkers: ["gemini"],
        workerInventory: [{
          kind: "gemini",
          available: true,
          modelId: "gemini-2.5-pro",
          modelName: "Gemini 2.5 Pro",
          reasoningEffort: null
        }],
        capabilities: ["project_manager_v1"]
      }
    });
    expect(heartbeatResponse.status).toBe(200);
    const refreshed = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    expect(refreshed.runners.find((runner) => runner.id === exchange.runner.id)?.supportedWorkers).toEqual(["gemini"]);
    expect(refreshed.runners.find((runner) => runner.id === exchange.runner.id)?.workerInventory).toEqual([{
      kind: "gemini",
      available: true,
      modelId: "gemini-2.5-pro",
      modelName: "Gemini 2.5 Pro",
      reasoningEffort: null
    }]);
    expect(refreshed.runners.find((runner) => runner.id === exchange.runner.id)?.capabilities).toEqual([
      "project_manager_v1"
    ]);

    // 心跳不带 supportedWorkers 时保留既有记录
    const plainHeartbeat = await request(app, "/api/runner/heartbeat", {
      method: "POST",
      token: exchange.runnerToken,
      body: { version: "0.1.7" }
    });
    expect(plainHeartbeat.status).toBe(200);
    const kept = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    expect(kept.runners.find((runner) => runner.id === exchange.runner.id)?.supportedWorkers).toEqual(["gemini"]);
    expect(kept.runners.find((runner) => runner.id === exchange.runner.id)?.workerInventory?.[0]?.modelId)
      .toBe("gemini-2.5-pro");
  });

  it("coordinates a one-time project directory request with the selected runner", async () => {
    const app = createTestApp();

    const pairingResponse = await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN });
    const pairing = (await pairingResponse.json()) as CreatePairingResponse;
    const exchangeResponse = await request(app, "/api/pairings/exchange", {
      method: "POST",
      body: {
        code: pairing.code,
        runnerName: "Directory picker runner",
        hostname: "picker-host",
        platform: "test/x64",
        version: "0.1.7"
      }
    });
    const exchange = (await exchangeResponse.json()) as ExchangePairingResponse;

    const unauthorizedCreate = await request(app, `/api/runners/${exchange.runner.id}/commands`, {
      method: "POST",
      body: { type: "select_project_directory" }
    });
    expect(unauthorizedCreate.status).toBe(401);

    const createResponse = await request(app, `/api/runners/${exchange.runner.id}/commands`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { type: "select_project_directory" }
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as RunnerCommand;
    expect(created.status).toBe("pending");
    expect(created.runnerId).toBe(exchange.runner.id);
    expect("workerKind" in created).toBe(false);

    const duplicateResponse = await request(app, `/api/runners/${exchange.runner.id}/commands`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { type: "select_project_directory" }
    });
    const duplicate = (await duplicateResponse.json()) as RunnerCommand;
    expect(duplicate.id).toBe(created.id);

    const unauthorizedClaim = await request(app, "/api/runner/commands/claim", { method: "POST" });
    expect(unauthorizedClaim.status).toBe(401);

    const claimResponse = await request(app, "/api/runner/commands/claim", {
      method: "POST",
      token: exchange.runnerToken
    });
    const claim = (await claimResponse.json()) as ClaimRunnerCommandResponse;
    expect(claim.command?.id).toBe(created.id);
    expect(claim.command?.status).toBe("claimed");
    expect(claim.leaseToken?.length).toBeGreaterThan(20);

    const emptyClaimResponse = await request(app, "/api/runner/commands/claim", {
      method: "POST",
      token: exchange.runnerToken
    });
    const emptyClaim = (await emptyClaimResponse.json()) as ClaimRunnerCommandResponse;
    expect(emptyClaim.command).toBeNull();
    expect(emptyClaim.leaseToken).toBeNull();

    const invalidComplete = await request(app, `/api/runner/commands/${created.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: "invalid-runner-command-lease-token", outcome: "cancelled" }
    });
    expect(invalidComplete.status).toBe(409);

    const projectResponse = await request(app, "/api/runner/projects", {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        externalKey: "local:directory-picker-test",
        name: "Selected project",
        workspaceLabel: "selected-project"
      }
    });
    const registration = (await projectResponse.json()) as RegisterProjectResponse;

    const completeResponse = await request(app, `/api/runner/commands/${created.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        leaseToken: claim.leaseToken,
        outcome: "succeeded",
        projectId: registration.project.id,
        bindingId: registration.binding.id
      }
    });
    expect(completeResponse.status).toBe(200);
    const completed = (await completeResponse.json()) as RunnerCommand;
    expect(completed.status).toBe("succeeded");
    expect(completed.resultProjectId).toBe(registration.project.id);
    expect(completed.resultBindingId).toBe(registration.binding.id);

    const readResponse = await request(app, `/api/runner-commands/${created.id}`, { token: ADMIN_TOKEN });
    const reread = (await readResponse.json()) as RunnerCommand;
    expect(reread.status).toBe("succeeded");

    const secondCreateResponse = await request(app, `/api/runners/${exchange.runner.id}/commands`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { type: "select_project_directory" }
    });
    const second = (await secondCreateResponse.json()) as RunnerCommand;
    expect(second.id).not.toBe(created.id);

    const secondClaimResponse = await request(app, "/api/runner/commands/claim", {
      method: "POST",
      token: exchange.runnerToken
    });
    const secondClaim = (await secondClaimResponse.json()) as ClaimRunnerCommandResponse;
    const cancelResponse = await request(app, `/api/runner/commands/${second.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: secondClaim.leaseToken, outcome: "cancelled" }
    });
    expect(cancelResponse.status).toBe(200);
    expect(((await cancelResponse.json()) as RunnerCommand).status).toBe("cancelled");

    const listResponse = await request(app, `/api/runners/${exchange.runner.id}/commands`, {
      token: ADMIN_TOKEN
    });
    const list = (await listResponse.json()) as RunnerCommandListResponse;
    expect(list.commands.find((command) => command.id === created.id)?.status).toBe("succeeded");
    expect(list.commands.find((command) => command.id === second.id)?.status).toBe("cancelled");
  });

  it("dispatches different task Workers from the same project binding", async () => {
    const app = createTestApp();
    const pairingResponse = await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN });
    const pairing = (await pairingResponse.json()) as CreatePairingResponse;
    const exchangeResponse = await request(app, "/api/pairings/exchange", {
      method: "POST",
      body: {
        code: pairing.code,
        runnerName: "Multi-agent runner",
        hostname: "coding-agent-host",
        platform: "test/x64",
        version: "0.1.7"
      }
    });
    const exchange = (await exchangeResponse.json()) as ExchangePairingResponse;

    const projectResponse = await request(app, "/api/runner/projects", {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        externalKey: "local:multi-worker-project",
        name: "Multi Worker Project",
        workspaceLabel: "multi-worker-project"
      }
    });
    expect(projectResponse.status).toBe(200);
    const registration = (await projectResponse.json()) as RegisterProjectResponse;
    expect("workerKind" in registration.binding).toBe(false);

    for (const workerKind of ["kimi", "glm", "codex"] as const) {
      const todoResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
        method: "POST",
        token: ADMIN_TOKEN,
        body: { title: `Run ${workerKind}`, status: "todo", workerKind }
      });
      expect(todoResponse.status).toBe(200);
      const todo = (await todoResponse.json()) as Todo;
      expect(todo.workerKind).toBe(workerKind);

      const claimResponse = await request(app, "/api/runner/jobs/claim", {
        method: "POST",
        token: exchange.runnerToken
      });
      const claim = (await claimResponse.json()) as ClaimJobResponse;
      expect(claim.job?.todo.id).toBe(todo.id);
      expect(claim.job?.attempt.workerKind).toBe(workerKind);

      const job = claim.job!;
      expect((await request(app, `/api/runner/jobs/${todo.id}/start`, {
        method: "POST",
        token: exchange.runnerToken,
        body: { leaseToken: job.leaseToken }
      })).status).toBe(200);
      expect((await request(app, `/api/runner/jobs/${todo.id}/complete`, {
        method: "POST",
        token: exchange.runnerToken,
        body: { leaseToken: job.leaseToken, success: true, exitCode: 0, summary: `${workerKind} completed` }
      })).status).toBe(200);
    }
  });

  it("routes new Todo through its project manager before waking a Worker", async () => {
    const app = createTestApp();
    const pairing = (await (
      await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN })
    ).json()) as CreatePairingResponse;
    const exchange = (await (
      await request(app, "/api/pairings/exchange", {
        method: "POST",
        body: {
          code: pairing.code,
          runnerName: "Project manager runner",
          hostname: "manager-host",
          platform: "test/x64",
          version: "0.1.7",
          supportedWorkers: ["codex", "kimi"],
          capabilities: ["project_manager_v1"]
        }
      })
    ).json()) as ExchangePairingResponse;
    const registration = (await (
      await request(app, "/api/runner/projects", {
        method: "POST",
        token: exchange.runnerToken,
        body: {
          externalKey: "local:project-manager-flow",
          name: "Managed Project",
          workspaceLabel: "managed-project"
        }
      })
    ).json()) as RegisterProjectResponse;

    const firstTodo = (await (
      await request(app, `/api/projects/${registration.project.id}/todos`, {
        method: "POST",
        token: ADMIN_TOKEN,
        body: {
          title: "Implement token refresh",
          details: "Add the refresh endpoint.",
          priority: -10,
          workerKind: "codex"
        }
      })
    ).json()) as Todo;
    expect(firstTodo.status).toBe("todo");
    expect(firstTodo.executionPhase).toBe("queued");

    const blockedClaim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    expect(blockedClaim.job).toBeNull();

    const managerClaim = (await (
      await request(app, "/api/runner/project-manager/claim", {
        method: "POST",
        token: exchange.runnerToken
      })
    ).json()) as ClaimProjectManagerJobResponse;
    expect(managerClaim.job?.todo.id).toBe(firstTodo.id);
    expect(managerClaim.job?.todo.status).toBe("queued");
    expect(managerClaim.job?.todo.executionPhase).toBe("planning");
    expect(managerClaim.job?.todo.activeAttemptId).toBeNull();
    expect(managerClaim.job?.availableWorkers).toEqual(["codex", "kimi"]);
    expect(managerClaim.job?.workflows).toEqual([]);
    const diagnosingDashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    expect(diagnosingDashboard.todos.find((todo) => todo.id === firstTodo.id)?.status).toBe("queued");
    expect(diagnosingDashboard.todos.find((todo) => todo.id === firstTodo.id)?.executionPhase).toBe("planning");

    const secondTodo = (await (
      await request(app, `/api/projects/${registration.project.id}/todos`, {
        method: "POST",
        token: ADMIN_TOKEN,
        body: {
          title: "Test refresh expiry",
          details: "Cover expiry handling.",
          priority: 100,
          workerKind: "codex"
        }
      })
    ).json()) as Todo;
    expect(secondTodo.executionPhase).toBe("queued");
    const concurrentManagerClaim = (await (
      await request(app, "/api/runner/project-manager/claim", {
        method: "POST",
        token: exchange.runnerToken
      })
    ).json()) as ClaimProjectManagerJobResponse;
    expect(concurrentManagerClaim.job).toBeNull();

    const rejectedWorkerChange = await request(app, `/api/runner/project-manager/${firstTodo.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        leaseToken: managerClaim.job!.leaseToken,
        managerWorkerKind: "codex",
        selectedWorkerKind: "kimi",
        workflowId: null,
        workflowTitle: "Token refresh",
        workflowSummary: "Implement and verify the token refresh lifecycle.",
        executionMode: "serial",
        dispatchBrief: "Continue the authentication lifecycle work."
      }
    });
    expect(rejectedWorkerChange.status).toBe(409);

    const firstDispatch = (await (
      await request(app, `/api/runner/project-manager/${firstTodo.id}/complete`, {
        method: "POST",
        token: exchange.runnerToken,
        body: {
          leaseToken: managerClaim.job!.leaseToken,
          managerWorkerKind: "codex",
          selectedWorkerKind: "codex",
          workflowId: null,
          workflowTitle: "Token refresh",
          workflowSummary: "Implement and verify the token refresh lifecycle.",
          executionMode: "serial",
          dispatchBrief: "Continue the authentication lifecycle work."
        }
      })
    ).json()) as CompleteProjectManagerJobResponse;
    expect(firstDispatch.selectedWorkerKind).toBe("codex");
    expect(firstDispatch.todo.workerKind).toBe("codex");
    expect(firstDispatch.todo.status).toBe("queued");
    expect(firstDispatch.todo.executionPhase).toBe("planning");
    const secondManagerClaim = (await (
      await request(app, "/api/runner/project-manager/claim", {
        method: "POST",
        token: exchange.runnerToken
      })
    ).json()) as ClaimProjectManagerJobResponse;
    expect(secondManagerClaim.job?.todo.status).toBe("queued");
    expect(secondManagerClaim.job?.todo.executionPhase).toBe("planning");
    expect(secondManagerClaim.job?.workflows[0]?.id).toBe(firstDispatch.workflow.id);
    expect(secondManagerClaim.job?.history.some((item) => item.todoId === firstTodo.id)).toBe(true);
    expect((await request(app, `/api/runner/project-manager/${secondTodo.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        leaseToken: secondManagerClaim.job!.leaseToken,
        managerWorkerKind: "codex",
        selectedWorkerKind: "codex",
        workflowId: firstDispatch.workflow.id,
        workflowTitle: "Token refresh",
        workflowSummary: "Implement and verify the token refresh lifecycle.",
        executionMode: "serial",
        dispatchBrief: "Use the existing authentication context."
      }
    })).status).toBe(200);

    // serial Workflow 始终按创建顺序推进，后来的高优先级 Todo 不能越过上下文前序。
    const firstClaim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    expect(firstClaim.job?.todo.id).toBe(firstTodo.id);
    expect(firstClaim.job?.todo.status).toBe("queued");
    expect(firstClaim.job?.todo.executionPhase).toBe("planning");
    expect(firstClaim.job?.todo.activeAttemptId).not.toBeNull();
    expect(firstClaim.job?.attempt.workerKind).toBe("codex");
    expect(firstClaim.job?.workflow?.id).toBe(firstDispatch.workflow.id);
    expect(firstClaim.job?.workflowExecutionMode).toBe("serial");
    expect(firstClaim.job?.dispatchBrief).toBe("Continue the authentication lifecycle work.");
    const started = await request(app, `/api/runner/jobs/${firstTodo.id}/start`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: firstClaim.job!.leaseToken }
    });
    expect(started.status).toBe(200);
    const startedMutation = (await started.json()) as { todo: Todo };
    expect(startedMutation.todo.executionPhase).toBe("running");
    expect(startedMutation.todo.startedAt).not.toBeNull();

    const seriallyBlocked = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    expect(seriallyBlocked.job).toBeNull();

    expect((await request(app, `/api/runner/jobs/${firstTodo.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: firstClaim.job!.leaseToken, success: true, summary: "Refresh endpoint complete." }
    })).status).toBe(200);
    const secondClaim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    expect(secondClaim.job?.todo.id).toBe(secondTodo.id);
    expect(secondClaim.job?.attempt.workerKind).toBe("codex");
    expect(secondClaim.job?.workflowExecutionMode).toBe("serial");
  });

  it("persists todo tags, details doc and project tag catalog", async () => {
    const app = createTestApp();

    const pairingResponse = await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN });
    const pairing = (await pairingResponse.json()) as CreatePairingResponse;
    const exchangeResponse = await request(app, "/api/pairings/exchange", {
      method: "POST",
      body: {
        code: pairing.code,
        runnerName: "Tag runner",
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
        externalKey: "git:fedcba0987654321",
        name: "Tag Catalog Project",
        workspaceLabel: "tag-catalog"
      }
    });
    expect(projectResponse.status).toBe(200);
    const registration = (await projectResponse.json()) as RegisterProjectResponse;

    const todoResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { title: "Tagged todo", tags: ["bug", "ui"], workerKind: "codex" }
    });
    expect(todoResponse.status).toBe(200);
    const createdTodo = (await todoResponse.json()) as Todo;
    expect(createdTodo.tags).toEqual(["bug", "ui"]);

    const listResponse = await request(app, `/api/projects/${registration.project.id}/todos`, {
      token: ADMIN_TOKEN
    });
    const listed = ((await listResponse.json()) as { todos: Todo[] }).todos.find((todo) => todo.id === createdTodo.id);
    expect(listed?.tags).toEqual(["bug", "ui"]);

    const detailResponse = await request(app, `/api/todos/${createdTodo.id}`, { token: ADMIN_TOKEN });
    const detail = (await detailResponse.json()) as TodoDetailResponse;
    expect(detail.todo.tags).toEqual(["bug", "ui"]);
    expect(detail.todo.detailsDoc).toBeUndefined();

    const detailsDoc = JSON.stringify([{ type: "paragraph", content: [{ type: "text", text: "实现细节" }] }]);
    const patchResponse = await request(app, `/api/todos/${createdTodo.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { tags: ["ui", "p0"], detailsDoc, workerKind: "glm" }
    });
    expect(patchResponse.status).toBe(200);
    const patchedTodo = (await patchResponse.json()) as Todo;
    expect(patchedTodo.tags).toEqual(["ui", "p0"]);
    expect(patchedTodo.detailsDoc).toBe(detailsDoc);
    expect(patchedTodo.workerKind).toBe("glm");

    const nullWorkerResponse = await request(app, `/api/todos/${createdTodo.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { workerKind: null }
    });
    expect(nullWorkerResponse.status).toBe(422);

    const rereadResponse = await request(app, `/api/todos/${createdTodo.id}`, { token: ADMIN_TOKEN });
    const reread = (await rereadResponse.json()) as TodoDetailResponse;
    expect(reread.todo.tags).toEqual(["ui", "p0"]);
    expect(reread.todo.detailsDoc).toBe(detailsDoc);
    expect(reread.todo.workerKind).toBe("glm");

    const tagCatalog = JSON.stringify({ bug: { label: "缺陷", color: "red" }, ui: { label: "界面", color: "blue" } });
    const projectPatch = await request(app, `/api/projects/${registration.project.id}`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { tagCatalog }
    });
    expect(projectPatch.status).toBe(200);

    const missingProjectPatch = await request(app, "/api/projects/missing-project-id", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { tagCatalog }
    });
    expect(missingProjectPatch.status).toBe(404);

    const dashboardResponse = await request(app, "/api/dashboard", { token: ADMIN_TOKEN });
    const dashboard = (await dashboardResponse.json()) as DashboardSnapshot;
    const project = dashboard.projects.find((entry) => entry.id === registration.project.id);
    expect(project?.tagCatalog).toBe(tagCatalog);
    const dashboardTodo = dashboard.todos.find((entry) => entry.id === createdTodo.id);
    expect(dashboardTodo?.tags).toEqual(["ui", "p0"]);
  });

  it("reuses the same runner when a host re-pairs instead of creating duplicates", async () => {
    const app = createTestApp();
    const hostname = "dup-host";
    const platform = "linux/x64";

    // 第一次配对：同一台机器首次登记
    const firstPairing = (await (
      await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN })
    ).json()) as CreatePairingResponse;
    const firstExchange = (await (
      await request(app, "/api/pairings/exchange", {
        method: "POST",
        body: { code: firstPairing.code, runnerName: "Dup A", hostname, platform, version: "0.1.6" }
      })
    ).json()) as ExchangePairingResponse;

    // 第二次配对：同一台机器重新配对（新配对码），修复前会新建一条 runner
    const secondPairing = (await (
      await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN })
    ).json()) as CreatePairingResponse;
    const secondExchange = (await (
      await request(app, "/api/pairings/exchange", {
        method: "POST",
        body: { code: secondPairing.code, runnerName: "Dup A (re-paired)", hostname, platform, version: "0.1.6" }
      })
    ).json()) as ExchangePairingResponse;

    // 同一台机器复用同一条 runner
    expect(secondExchange.runner.id).toBe(firstExchange.runner.id);
    // 新 token 必须下发（旧 token 已轮换）
    expect(secondExchange.runnerToken).not.toBe(firstExchange.runnerToken);

    // dashboard 上该机器只应有一条 binding（用新 token 注册一次项目后验证）
    const registrationResponse = await request(app, "/api/runner/projects", {
      method: "POST",
      token: secondExchange.runnerToken,
      body: {
          externalKey: "git:dup-project-key",
        name: "dup-project",
          repositoryUrl: null,
          defaultBranch: null,
          workspaceLabel: "dup-project",
          gitBranch: null,
        gitHead: null
      }
    });
    expect(registrationResponse.status).toBe(200);
    const registration = (await registrationResponse.json()) as RegisterProjectResponse;

    const dashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    const bindingsForRunner = dashboard.bindings.filter((b) => b.runnerId === firstExchange.runner.id);
    expect(bindingsForRunner.length).toBe(1);
    expect(bindingsForRunner[0]?.projectId).toBe(registration.project.id);
    // 全局 runners 也只有这一台
    expect(dashboard.runners.filter((r) => r.hostname === hostname && r.platform === platform).length).toBe(1);
  });

  it("collapses pre-existing duplicate runners for the same host on startup", async () => {
    // 模拟历史脏数据：在迁移前直接写入两条同 (hostname, platform) 的 runner，
    // 验证 createDatabase 启动时把它们合并为一条。
    const directory = mkdtempSync(join(tmpdir(), "maple-runner-collapse-test-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "dup.sqlite");
    const legacy = new Database(databasePath, { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_user_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, external_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        repository_url TEXT, default_branch TEXT, tag_catalog_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE runners (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        hostname TEXT NOT NULL, platform TEXT NOT NULL, version TEXT NOT NULL,
        last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE project_bindings (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, runner_id TEXT NOT NULL,
        workspace_label TEXT NOT NULL, worker_kind TEXT NOT NULL,
        git_branch TEXT, git_head TEXT,
        last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(project_id, runner_id)
      );
    `);
    legacy.run(
      "INSERT INTO workspaces(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [TEST_WORKSPACE_ID, "Duplicate runner workspace", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]
    );
    legacy.run(
      "INSERT INTO projects(id, workspace_id, external_key, name, repository_url, default_branch, tag_catalog_json, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)",
      ["p1", TEST_WORKSPACE_ID, "git:legacy", "legacy-project", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]
    );
    // 两条同机器 runner，旧的那条挂着一个 binding
    legacy.run(
      "INSERT INTO runners(id, workspace_id, token_hash, name, hostname, platform, version, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["r-old", TEST_WORKSPACE_ID, "h-old", "Legacy", "ghost-host", "linux/x64", "0.1.5", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]
    );
    legacy.run(
      "INSERT INTO runners(id, workspace_id, token_hash, name, hostname, platform, version, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["r-new", TEST_WORKSPACE_ID, "h-new", "Latest", "ghost-host", "linux/x64", "0.1.6", "2026-07-01T00:00:00Z", "2026-06-01T00:00:00Z"]
    );
    legacy.run(
      "INSERT INTO project_bindings(id, project_id, runner_id, workspace_label, worker_kind, git_branch, git_head, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
      ["b1", "p1", "r-old", "legacy-project", "kimi", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"]
    );
    legacy.close();

    const database = createDatabase(databasePath);
    databases.push(database);
    const runners = database
      .query("SELECT id FROM runners WHERE hostname = ? AND platform = ?")
      .all("ghost-host", "linux/x64") as Array<{ id: string }>;
    expect(runners.length).toBe(1);
    expect(runners[0]?.id).toBe("r-new"); // 保留最近活跃的那条
    const bindings = database
      .query("SELECT runner_id FROM project_bindings WHERE project_id = ?")
      .all("p1") as Array<{ runner_id: string }>;
    expect(bindings.length).toBe(1);
    expect(bindings[0]?.runner_id).toBe("r-new"); // binding 已迁移到保留 runner
  });

  it("never replaces a specified Worker and stores only the Leader PM failure report", async () => {
    const app = createTestApp();
    const pairing = (await (
      await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN })
    ).json()) as CreatePairingResponse;
    const exchange = (await (
      await request(app, "/api/pairings/exchange", {
        method: "POST",
        body: {
          code: pairing.code,
          runnerName: "Strict worker runner",
          hostname: "strict-worker-host",
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
          externalKey: "local:strict-worker-project",
          name: "Strict Worker Project",
          workspaceLabel: "strict-worker-project"
        }
      })
    ).json()) as RegisterProjectResponse;

    const unavailableTodo = (await (
      await request(app, `/api/projects/${registration.project.id}/todos`, {
        method: "POST",
        token: ADMIN_TOKEN,
        body: {
          title: "Use Kimi only",
          details: "Do not replace the requested Worker.",
          workerKind: "kimi"
        }
      })
    ).json()) as Todo;
    const unavailableManagerClaim = (await (
      await request(app, "/api/runner/project-manager/claim", {
        method: "POST",
        token: exchange.runnerToken
      })
    ).json()) as ClaimProjectManagerJobResponse;
    expect(unavailableManagerClaim.job?.todo.workerKind).toBe("kimi");
    expect(unavailableManagerClaim.job?.availableWorkers).toEqual(["codex"]);

    const aiUnavailableReport = "Kimi 当前不可用，任务未执行。";
    const blockResponse = await request(
      app,
      `/api/runner/project-manager/${unavailableTodo.id}/block`,
      {
        method: "POST",
        token: exchange.runnerToken,
        body: {
          leaseToken: unavailableManagerClaim.job!.leaseToken,
          managerWorkerKind: "codex",
          report: aiUnavailableReport
        }
      }
    );
    expect(blockResponse.status).toBe(200);
    const unavailableBlocked = (await blockResponse.json()) as { todo: Todo; report: string | null };
    expect(unavailableBlocked.report).toBe(aiUnavailableReport);
    expect(unavailableBlocked.todo).toMatchObject({
      status: "blocked",
      workerKind: "kimi",
      resultSummary: aiUnavailableReport
    });
    const unavailableDetail = (await (
      await request(app, `/api/todos/${unavailableTodo.id}`, { token: ADMIN_TOKEN })
    ).json()) as TodoDetailResponse;
    expect(unavailableDetail.attempts).toHaveLength(0);

    const failingTodo = (await (
      await request(app, `/api/projects/${registration.project.id}/todos`, {
        method: "POST",
        token: ADMIN_TOKEN,
        body: {
          title: "Run Codex only",
          details: "Block immediately if the selected Worker fails.",
          workerKind: "codex"
        }
      })
    ).json()) as Todo;
    const failingManagerClaim = (await (
      await request(app, "/api/runner/project-manager/claim", {
        method: "POST",
        token: exchange.runnerToken
      })
    ).json()) as ClaimProjectManagerJobResponse;
    expect((await request(app, `/api/runner/project-manager/${failingTodo.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        leaseToken: failingManagerClaim.job!.leaseToken,
        managerWorkerKind: "codex",
        selectedWorkerKind: "codex",
        workflowId: null,
        workflowTitle: "Strict Worker execution",
        workflowSummary: "Run only the Worker selected on each Todo.",
        executionMode: "serial",
        dispatchBrief: "Execute this Todo with its specified Worker."
      }
    })).status).toBe(200);

    const executionClaim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    expect(executionClaim.job?.todo.id).toBe(failingTodo.id);
    expect(executionClaim.job?.managerWorkerKind).toBe("codex");
    expect((await request(app, `/api/runner/jobs/${failingTodo.id}/start`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: executionClaim.job!.leaseToken }
    })).status).toBe(200);

    const aiExecutionReport = "Codex 参数无效，任务未完成。";
    const failedCompletion = await request(app, `/api/runner/jobs/${failingTodo.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        leaseToken: executionClaim.job!.leaseToken,
        success: false,
        exitCode: 2,
        summary: aiExecutionReport,
        error: "unknown option --legacy-flag",
        failureDisposition: "blocked"
      }
    });
    expect(failedCompletion.status).toBe(200);
    const failedMutation = (await failedCompletion.json()) as { todo: Todo };
    expect(failedMutation.todo).toMatchObject({
      status: "blocked",
      workerKind: "codex",
      retryAfter: null,
      resultSummary: aiExecutionReport,
      lastError: "unknown option --legacy-flag"
    });
    const retryClaim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    expect(retryClaim.job).toBeNull();
  });

  it("persists token usage reported at completion and aggregates it per project × worker", async () => {
    const app = createTestApp();

    const pairing = (await (
      await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN })
    ).json()) as CreatePairingResponse;
    const exchange = (await (
      await request(app, "/api/pairings/exchange", {
        method: "POST",
        body: { code: pairing.code, runnerName: "Usage runner", hostname: "usage-host", platform: "linux/x64", version: "0.1.6" }
      })
    ).json()) as ExchangePairingResponse;

    const registration = (await (
      await request(app, "/api/runner/projects", {
        method: "POST",
        token: exchange.runnerToken,
        body: {
          externalKey: "git:usage-project-key",
          name: "Usage Project",
          repositoryUrl: null,
          defaultBranch: null,
          workspaceLabel: "usage-project",
          gitBranch: null,
          gitHead: null
        }
      })
    ).json()) as RegisterProjectResponse;

    const createdTodo = (await (
      await request(app, `/api/projects/${registration.project.id}/todos`, {
        method: "POST",
        token: ADMIN_TOKEN,
        body: { title: "Task with usage", details: "Reports token usage.", status: "todo", workerKind: "codex" }
      })
    ).json()) as Todo;

    const claim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    const job = claim.job!;
    await request(app, `/api/runner/jobs/${job.todo.id}/start`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: job.leaseToken }
    });

    const complete = await request(app, `/api/runner/jobs/${job.todo.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        leaseToken: job.leaseToken,
        success: true,
        exitCode: 0,
        summary: "Done with usage.",
        usage: { inputTokens: 72148, cachedInputTokens: 47360, outputTokens: 2765, reasoningOutputTokens: 1542 }
      }
    });
    expect(complete.status).toBe(200);
    const completed = (await complete.json()) as { attempt: { usage: { inputTokens: number } } };
    expect(completed.attempt.usage).toMatchObject({ inputTokens: 72148, outputTokens: 2765 });

    const dashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    const usageRow = dashboard.tokenUsage.find(
      (row) => row.projectId === registration.project.id && row.workerKind === "codex"
    );
    expect(usageRow).toMatchObject({
      inputTokens: 72148,
      cachedInputTokens: 47360,
      outputTokens: 2765,
      reasoningOutputTokens: 1542
    });
  });
});

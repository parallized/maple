import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ClaimJobResponse,
  ClaimProjectManagerJobResponse,
  ReconcileRunnerAttemptsResponse,
  TodoDetailResponse,
  UploadTodoArtifactResponse
} from "@maple/protocol";
import { createServerApp } from "../src/app";
import type { ServerConfig } from "../src/config";
import { createDatabase } from "../src/database/client";
import { hashSecret } from "../src/lib/crypto";
import { solidPngBytes } from "./image-fixture";

const WORKSPACE_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const RUNNER_ID = "20000000-0000-4000-8000-000000000003";
const PROJECT_ID = "20000000-0000-4000-8000-000000000004";
const RUNNER_TOKEN = "reconnection-runner-token";
const SESSION_TOKEN = "reconnection-session-token";
const CSRF_TOKEN = "reconnection-csrf-token";
const databases: Database[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function config(dataDir: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir,
    databasePath: ":memory:",
    webRoot: join(dataDir, "missing-dashboard"),
    allowedOrigins: ["http://maple.test"],
    leaseSeconds: 1,
    runnerOfflineSeconds: 30,
    pairingTtlSeconds: 600,
    runnerCommandTtlSeconds: 1
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "maple-reconnection-"));
  temporaryDirectories.push(root);
  const database = createDatabase(":memory:");
  databases.push(database);
  const now = "2026-07-28T00:00:00.000Z";
  database.run(
    `INSERT INTO users(id, email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, 'hash', 'Reconnect user', ?, ?)`,
    [USER_ID, "reconnect@example.com", now, now]
  );
  database.run(
    `INSERT INTO workspaces(id, name, owner_user_id, created_at, updated_at)
     VALUES (?, 'Reconnect workspace', ?, ?, ?)`,
    [WORKSPACE_ID, USER_ID, now, now]
  );
  database.run(
    `INSERT INTO workspace_members(workspace_id, user_id, role, created_at)
     VALUES (?, ?, 'owner', ?)`,
    [WORKSPACE_ID, USER_ID, now]
  );
  database.run(
    `INSERT INTO web_sessions(
       id, token_hash, user_id, active_workspace_id, csrf_token, csrf_token_hash, trust,
       ip_address, network_key, user_agent_hash, device_label,
       created_at, last_seen_at, expires_at
     ) VALUES ('session-reconnect', ?, ?, ?, ?, ?, 'trusted',
       '127.0.0.1', 'loopback', 'test-agent', 'Test browser', ?, ?, '2099-01-01T00:00:00.000Z')`,
    [hashSecret(SESSION_TOKEN), USER_ID, WORKSPACE_ID, CSRF_TOKEN, hashSecret(CSRF_TOKEN), now, now]
  );
  database.run(
    `INSERT INTO runners(
       id, workspace_id, token_hash, name, hostname, platform, version,
       supported_workers, capabilities, last_seen_at, created_at
     ) VALUES (?, ?, ?, 'Reconnect runner', 'reconnect-host', 'test/x64', '0.1.7', ?, ?, ?, ?)`,
    [RUNNER_ID, WORKSPACE_ID, hashSecret(RUNNER_TOKEN), '["codex"]', '["project_manager_v1"]', now, now]
  );
  database.run(
    `INSERT INTO projects(
       id, workspace_id, external_key, workspace_external_key, name, created_at, updated_at
     ) VALUES (?, ?, 'reconnect:project', 'reconnect:project', 'Reconnect project', ?, ?)`,
    [PROJECT_ID, WORKSPACE_ID, now, now]
  );
  database.run(
    `INSERT INTO project_bindings(
       id, project_id, runner_id, workspace_label, last_seen_at, created_at, updated_at
     ) VALUES ('binding-reconnect', ?, ?, 'reconnect-project', ?, ?, ?)`,
    [PROJECT_ID, RUNNER_ID, now, now, now]
  );
  return { database, app: createServerApp({ config: config(root), database }), root };
}

function insertTodo(database: Database, id: string): void {
  const now = "2026-07-28T00:00:00.000Z";
  database.run(
    `INSERT INTO todos(
       id, project_id, title, details, status, priority, worker_kind, created_at, updated_at
     ) VALUES (?, ?, ?, '', 'todo', 0, 'codex', ?, ?)`,
    [id, PROJECT_ID, id, now, now]
  );
}

function request(
  app: ReturnType<typeof createServerApp>,
  path: string,
  options: { method?: string; auth?: "runner" | "admin"; body?: unknown } = {}
): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (options.auth === "runner") headers.set("authorization", `Bearer ${RUNNER_TOKEN}`);
  if (options.auth === "admin") {
    headers.set("cookie", `maple_session=${SESSION_TOKEN}`);
    headers.set("x-maple-workspace", WORKSPACE_ID);
    if (options.method && options.method !== "GET") {
      headers.set("x-maple-csrf", CSRF_TOKEN);
      headers.set("origin", "http://maple.test");
    }
  }
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return app.handle(new Request(`http://maple.test${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }));
}

async function claimExecution(app: ReturnType<typeof createServerApp>): Promise<NonNullable<ClaimJobResponse["job"]>> {
  const response = await request(app, "/api/runner/jobs/claim", { method: "POST", auth: "runner" });
  expect(response.status).toBe(200);
  return ((await response.json()) as ClaimJobResponse).job!;
}

describe("Runner reconnection", () => {
  it("keeps an expired execution attempt and restores the same lease", async () => {
    const { database, app } = fixture();
    insertTodo(database, "todo-expired");
    const job = await claimExecution(app);
    database.run("UPDATE todos SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [job.todo.id]);

    const secondClaim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", auth: "runner" })
    ).json()) as ClaimJobResponse;
    expect(secondClaim.job).toBeNull();
    expect(database.query("SELECT state FROM todo_attempts WHERE id = ?").get(job.attempt.id))
      .toEqual({ state: "claimed" });
    const interrupted = (await (
      await request(app, `/api/todos/${job.todo.id}`, { auth: "admin" })
    ).json()) as TodoDetailResponse;
    expect(interrupted.todo.executionConnection).toBe("interrupted");

    const reconciled = (await (
      await request(app, "/api/runner/reconcile", {
        method: "POST",
        auth: "runner",
        body: { attempts: [{
          scope: "execution",
          todoId: job.todo.id,
          attemptId: job.attempt.id,
          leaseToken: job.leaseToken
        }] }
      })
    ).json()) as ReconcileRunnerAttemptsResponse;
    expect(reconciled.attempts).toEqual([{
      attemptId: job.attempt.id,
      state: "active",
      leaseSeconds: 1
    }]);
    const connected = (await (
      await request(app, `/api/todos/${job.todo.id}`, { auth: "admin" })
    ).json()) as TodoDetailResponse;
    expect(connected.todo.activeAttemptId).toBe(job.attempt.id);
    expect(connected.todo.executionConnection).toBe("connected");
  });

  it("returns superseded after an explicit user cancellation", async () => {
    const { app, database } = fixture();
    insertTodo(database, "todo-cancelled");
    const job = await claimExecution(app);
    const cancellation = await request(app, `/api/todos/${job.todo.id}`, {
      method: "PATCH",
      auth: "admin",
      body: { status: "cancelled" }
    });
    expect(cancellation.status).toBe(200);

    const reconciled = (await (
      await request(app, "/api/runner/reconcile", {
        method: "POST",
        auth: "runner",
        body: { attempts: [{
          scope: "execution",
          todoId: job.todo.id,
          attemptId: job.attempt.id,
          leaseToken: job.leaseToken
        }] }
      })
    ).json()) as ReconcileRunnerAttemptsResponse;
    expect(reconciled.attempts[0]?.state).toBe("superseded");
    expect(database.query("SELECT state FROM todo_attempts WHERE id = ?").get(job.attempt.id))
      .toEqual({ state: "abandoned" });
  });

  it("deduplicates batched logs and recognizes a completion whose response was lost", async () => {
    const { app, database } = fixture();
    insertTodo(database, "todo-logs");
    const job = await claimExecution(app);
    database.run("UPDATE todos SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [job.todo.id]);
    const logs = {
      leaseToken: job.leaseToken,
      logs: [{
        deliveryId: "log-delivery-1",
        stream: "stdout",
        content: "one durable log",
        sequence: 0,
        occurredAt: "2026-07-28T00:00:01.000Z",
        kind: "assistant",
        level: "info"
      }]
    };
    for (let index = 0; index < 2; index += 1) {
      const response = await request(app, `/api/runner/jobs/${job.todo.id}/logs/batch`, {
        method: "POST",
        auth: "runner",
        body: logs
      });
      expect(response.status).toBe(200);
    }
    expect(database.query("SELECT COUNT(*) AS count FROM todo_logs").get()).toEqual({ count: 1 });

    const completion = await request(app, `/api/runner/jobs/${job.todo.id}/complete`, {
      method: "POST",
      auth: "runner",
      body: { leaseToken: job.leaseToken, success: true, summary: "done" }
    });
    expect(completion.status).toBe(200);
    const reconciled = (await (
      await request(app, "/api/runner/reconcile", {
        method: "POST",
        auth: "runner",
        body: { attempts: [{
          scope: "execution",
          todoId: job.todo.id,
          attemptId: job.attempt.id,
          leaseToken: job.leaseToken
        }] }
      })
    ).json()) as ReconcileRunnerAttemptsResponse;
    expect(reconciled.attempts[0]?.state).toBe("completed");
  });

  it("accepts a successful completion without optional screenshots", async () => {
    const { app, database } = fixture();
    insertTodo(database, "todo-without-screenshot");
    const settings = await request(app, "/api/settings/acceptance", {
      method: "PATCH",
      auth: "admin",
      body: { backgroundPlaywrightScreenshot: true }
    });
    expect(settings.status).toBe(200);
    const job = await claimExecution(app);
    const start = await request(app, `/api/runner/jobs/${job.todo.id}/start`, {
      method: "POST",
      auth: "runner",
      body: { leaseToken: job.leaseToken }
    });
    expect(start.status).toBe(200);

    const completion = await request(app, `/api/runner/jobs/${job.todo.id}/complete`, {
      method: "POST",
      auth: "runner",
      body: { leaseToken: job.leaseToken, success: true, exitCode: 0, summary: "done" }
    });
    expect(completion.status).toBe(200);

    const detail = (await (
      await request(app, `/api/todos/${job.todo.id}`, { auth: "admin" })
    ).json()) as TodoDetailResponse;
    expect(detail.todo.status).toBe("review");
    expect(detail.attempts.find((attempt) => attempt.id === job.attempt.id)).toMatchObject({
      state: "succeeded",
      error: null,
      resultSummary: "done"
    });
    expect(detail.artifacts).toEqual([]);
  });

  it("deduplicates a screenshot before writing a second stored artifact", async () => {
    const { app, database } = fixture();
    insertTodo(database, "todo-artifact");
    const settings = await request(app, "/api/settings/acceptance", {
      method: "PATCH",
      auth: "admin",
      body: { backgroundPlaywrightScreenshot: true }
    });
    expect(settings.status).toBe(200);
    const job = await claimExecution(app);
    const png = await solidPngBytes(20, 20);
    const upload = async (): Promise<UploadTodoArtifactResponse> => {
      const form = new FormData();
      form.set("leaseToken", job.leaseToken);
      form.set("deliveryId", "artifact-delivery-stable");
      form.set("file", new File([png], "acceptance.png", { type: "image/png" }));
      const response = await app.handle(new Request(
        `http://maple.test/api/runner/jobs/${job.todo.id}/artifacts`,
        { method: "POST", headers: { authorization: `Bearer ${RUNNER_TOKEN}` }, body: form }
      ));
      expect(response.status).toBe(200);
      return response.json() as Promise<UploadTodoArtifactResponse>;
    };
    const first = await upload();
    const second = await upload();
    expect(second.artifact.id).toBe(first.artifact.id);
    expect(database.query("SELECT COUNT(*) AS count FROM todo_artifacts").get()).toEqual({ count: 1 });
  });

  it("keeps and reconciles the same expired project-manager attempt", async () => {
    const { app, database } = fixture();
    insertTodo(database, "todo-manager");
    const now = "2026-07-28T00:00:00.000Z";
    database.run(
      `INSERT INTO todo_routes(todo_id, source_status, state, created_at, updated_at)
       VALUES ('todo-manager', 'todo', 'pending', ?, ?)`,
      [now, now]
    );
    const claim = (await (
      await request(app, "/api/runner/project-manager/claim", { method: "POST", auth: "runner" })
    ).json()) as ClaimProjectManagerJobResponse;
    const job = claim.job!;
    expect(job.attemptId).toBeString();
    database.run(
      "UPDATE todo_routes SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE todo_id = ?",
      [job.todo.id]
    );

    const secondClaim = (await (
      await request(app, "/api/runner/project-manager/claim", { method: "POST", auth: "runner" })
    ).json()) as ClaimProjectManagerJobResponse;
    expect(secondClaim.job).toBeNull();
    const interrupted = (await (
      await request(app, `/api/todos/${job.todo.id}`, { auth: "admin" })
    ).json()) as TodoDetailResponse;
    expect(interrupted.todo.executionConnection).toBe("interrupted");

    const reconciled = (await (
      await request(app, "/api/runner/reconcile", {
        method: "POST",
        auth: "runner",
        body: { attempts: [{
          scope: "project_manager",
          todoId: job.todo.id,
          attemptId: job.attemptId,
          leaseToken: job.leaseToken
        }] }
      })
    ).json()) as ReconcileRunnerAttemptsResponse;
    expect(reconciled.attempts).toEqual([{
      attemptId: job.attemptId,
      state: "active",
      leaseSeconds: 1
    }]);

    const cancellation = await request(app, `/api/todos/${job.todo.id}`, {
      method: "PATCH",
      auth: "admin",
      body: { status: "cancelled" }
    });
    expect(cancellation.status).toBe(200);
    const superseded = (await (
      await request(app, "/api/runner/reconcile", {
        method: "POST",
        auth: "runner",
        body: { attempts: [{
          scope: "project_manager",
          todoId: job.todo.id,
          attemptId: job.attemptId,
          leaseToken: job.leaseToken
        }] }
      })
    ).json()) as ReconcileRunnerAttemptsResponse;
    expect(superseded.attempts[0]?.state).toBe("superseded");

    insertTodo(database, "todo-manager-next");
    database.run(
      `INSERT INTO todo_routes(todo_id, source_status, state, created_at, updated_at)
       VALUES ('todo-manager-next', 'todo', 'pending', ?, ?)`,
      [now, now]
    );
    const nextClaim = (await (
      await request(app, "/api/runner/project-manager/claim", { method: "POST", auth: "runner" })
    ).json()) as ClaimProjectManagerJobResponse;
    expect(nextClaim.job?.todo.id).toBe("todo-manager-next");
  });
});

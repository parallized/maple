import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import type {
  ClaimJobResponse,
  ClaimProjectManagerJobResponse,
  CreatePairingResponse,
  DashboardSnapshot,
  ExchangePairingResponse,
  RunnerCommand
} from "@maple/protocol";
import { createServerApp } from "../src/app";
import type { ServerConfig } from "../src/config";
import { createDatabase } from "../src/database/client";
import { hashSecret } from "../src/lib/crypto";

const ADMIN_TOKEN = "test-admin-token";
const TEST_WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const TEST_USER_ID = "10000000-0000-4000-8000-000000000002";
const TEST_SESSION_TOKEN = "test-web-session-token";
const TEST_CSRF_TOKEN = "test-web-csrf-token";
const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function testConfig(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir: ".",
    databasePath: ":memory:",
    webRoot: ".",
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
    `INSERT OR IGNORE INTO users(id, email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [TEST_USER_ID, "runner-models@example.com", "test-password-hash", "Runner Models", now, now]
  );
  database.run(
    `INSERT OR IGNORE INTO workspaces(id, name, owner_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [TEST_WORKSPACE_ID, "Runner Models Workspace", TEST_USER_ID, now, now]
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

async function pairRunner(
  app: ReturnType<typeof createServerApp>,
  name: string,
  extra: Record<string, unknown> = {}
): Promise<ExchangePairingResponse> {
  const pairingResponse = await request(app, "/api/pairings", { method: "POST", token: ADMIN_TOKEN });
  expect(pairingResponse.status).toBe(200);
  const pairing = (await pairingResponse.json()) as CreatePairingResponse;
  const exchangeResponse = await request(app, "/api/pairings/exchange", {
    method: "POST",
    body: {
      code: pairing.code,
      runnerName: name,
      hostname: `${name}-host`,
      platform: "test/x64",
      version: "0.1.7",
      ...extra
    }
  });
  expect(exchangeResponse.status).toBe(200);
  return (await exchangeResponse.json()) as ExchangePairingResponse;
}

describe("Runner model settings", () => {
  it("saves per-runner model overrides and exposes them in the dashboard snapshot", async () => {
    const app = createTestApp();
    const exchange = await pairRunner(app, "Models runner");

    const patch = await request(app, `/api/runners/${exchange.runner.id}/models`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { defaultWorker: "kimi", leaderWorker: "glm" }
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as { runner: { defaultWorker?: string; leaderWorker?: string } };
    expect(updated.runner.defaultWorker).toBe("kimi");
    expect(updated.runner.leaderWorker).toBe("glm");

    const dashboard = (await (
      await request(app, "/api/dashboard", { token: ADMIN_TOKEN })
    ).json()) as DashboardSnapshot;
    const runner = dashboard.runners.find((item) => item.id === exchange.runner.id);
    expect(runner?.defaultWorker).toBe("kimi");
    expect(runner?.leaderWorker).toBe("glm");

    const clear = await request(app, `/api/runners/${exchange.runner.id}/models`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { defaultWorker: null, leaderWorker: null }
    });
    expect(clear.status).toBe(200);
    const cleared = (await clear.json()) as { runner: { defaultWorker?: string; leaderWorker?: string } };
    expect(cleared.runner.defaultWorker ?? null).toBeNull();
    expect(cleared.runner.leaderWorker ?? null).toBeNull();
  });

  it("accepts refresh_worker_inventory commands and completes them without a directory result", async () => {
    const app = createTestApp();
    const exchange = await pairRunner(app, "Refresh runner");

    const create = await request(app, `/api/runners/${exchange.runner.id}/commands`, {
      method: "POST",
      token: ADMIN_TOKEN,
      body: { type: "refresh_worker_inventory" }
    });
    expect(create.status).toBe(200);
    const command = (await create.json()) as RunnerCommand;
    expect(command.status).toBe("pending");

    const claim = (await (
      await request(app, "/api/runner/commands/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as { command: RunnerCommand; leaseToken: string | null };
    expect(claim.command?.id).toBe(command.id);
    expect(claim.command?.status).toBe("claimed");
    expect(claim.leaseToken).toBeTruthy();

    const complete = await request(app, `/api/runner/commands/${command.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: { leaseToken: claim.leaseToken, outcome: "succeeded" }
    });
    expect(complete.status).toBe(200);

    const detail = (await (
      await request(app, `/api/runner-commands/${command.id}`, { token: ADMIN_TOKEN })
    ).json()) as RunnerCommand;
    expect(detail.status).toBe("succeeded");
  });

  it("applies per-runner model overrides to dispatched execution and leader jobs", async () => {
    const app = createTestApp();
    const exchange = await pairRunner(app, "Dispatch runner", {
      supportedWorkers: ["codex", "deepseek", "kimi"],
      capabilities: ["project_manager_v1"]
    });
    const runnerId = exchange.runner.id;

    // 工作区默认：执行工具 claude，领导模型 claude；执行端单独覆盖为 kimi / deepseek。
    await request(app, "/api/settings/execution", {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { defaultWorker: "claude", leaderWorker: "claude" }
    });
    const patch = await request(app, `/api/runners/${runnerId}/models`, {
      method: "PATCH",
      token: ADMIN_TOKEN,
      body: { defaultWorker: "kimi", leaderWorker: "deepseek" }
    });
    expect(patch.status).toBe(200);

    const registration = (await (
      await request(app, "/api/runner/projects", {
        method: "POST",
        token: exchange.runnerToken,
        body: {
          externalKey: "git:runner-model-dispatch",
          name: "Runner Model Dispatch",
          workspaceLabel: "runner-model-dispatch"
        }
      })
    ).json()) as { project: { id: string } };

    const created = (await (
      await request(app, `/api/projects/${registration.project.id}/todos`, {
        method: "POST",
        token: ADMIN_TOKEN,
        body: { title: "按执行端模型执行", workerKind: "codex" }
      })
    ).json()) as { id: string };

    // 项目经理任务：携带执行端覆盖后的 leaderWorker。
    const managerClaim = (await (
      await request(app, "/api/runner/project-manager/claim", {
        method: "POST",
        token: exchange.runnerToken
      })
    ).json()) as ClaimProjectManagerJobResponse;
    expect(managerClaim.job?.todo.id).toBe(created.id);
    expect(managerClaim.job?.executionSettings?.leaderWorker).toBe("deepseek");
    expect(managerClaim.job?.executionSettings?.defaultWorker).toBe("kimi");
    expect(managerClaim.job?.availableWorkers).toEqual(["codex", "deepseek", "kimi"]);

    // 完成派单（沿用任务原 workerKind codex，不触发改派校验），让任务进入可执行队列。
    const dispatch = await request(app, `/api/runner/project-manager/${created.id}/complete`, {
      method: "POST",
      token: exchange.runnerToken,
      body: {
        leaseToken: managerClaim.job!.leaseToken,
        managerWorkerKind: "deepseek",
        selectedWorkerKind: "codex",
        workflowId: null,
        workflowTitle: "按执行端模型执行",
        workflowSummary: "验证执行端模型覆盖。",
        dispatchBrief: "使用执行端默认工具执行。"
      }
    });
    expect(dispatch.status).toBe(200);

    // 执行任务：默认执行工具回退到工作区默认（任务自身指定 codex，不会因覆盖改变）。
    const executionClaim = (await (
      await request(app, "/api/runner/jobs/claim", { method: "POST", token: exchange.runnerToken })
    ).json()) as ClaimJobResponse;
    expect(executionClaim.job?.todo.id).toBe(created.id);
    expect(executionClaim.job?.executionSettings?.leaderWorker).toBe("deepseek");
    expect(executionClaim.job?.executionSettings?.defaultWorker).toBe("kimi");
    expect(executionClaim.job?.todo.workerKind).toBe("codex");
  });
});

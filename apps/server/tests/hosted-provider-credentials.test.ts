import { afterEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ClaimJobResponse,
  ClaimProjectManagerJobResponse,
  RunnerHeartbeatResponse
} from "@maple/protocol";
import { createServerApp } from "../src/app";
import type { ServerConfig } from "../src/config";
import { createDatabase } from "../src/database/client";
import { hashSecret } from "../src/lib/crypto";
import { createHostedProviderCredentialService } from "../src/services/hosted-provider-credential-service";

const databases: Database[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close(false);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function setup(overrides: Partial<ServerConfig> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "maple-hosted-provider-"));
  directories.push(dataDir);
  const database = createDatabase(":memory:");
  databases.push(database);
  const config: ServerConfig = {
    deploymentMode: "hosted",
    host: "127.0.0.1",
    port: 45_820,
    dataDir,
    databasePath: ":memory:",
    webRoot: dataDir,
    allowedOrigins: ["http://localhost"],
    leaseSeconds: 45,
    runnerOfflineSeconds: 30,
    pairingTtlSeconds: 600,
    runnerCommandTtlSeconds: 900,
    publicUrl: "https://maple.test",
    ...overrides
  };
  const now = new Date().toISOString();
  for (const workspaceId of ["workspace-provider-a", "workspace-provider-b"]) {
    database.run(
      "INSERT INTO workspaces(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [workspaceId, workspaceId, now, now]
    );
  }
  return { database, config };
}

function request(
  app: ReturnType<typeof createServerApp>,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    sessionToken?: string;
    csrfToken?: string;
    workspaceId?: string;
    runnerToken?: string;
  } = {}
): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.sessionToken) headers.set("cookie", `maple_session=${options.sessionToken}`);
  if (options.csrfToken) headers.set("x-maple-csrf", options.csrfToken);
  if (options.workspaceId) headers.set("x-maple-workspace", options.workspaceId);
  if (options.runnerToken) headers.set("authorization", `Bearer ${options.runnerToken}`);
  if (options.method && options.method !== "GET") headers.set("origin", "https://maple.test");
  headers.set("user-agent", "Maple Provider Test");
  return app.handle(new Request(`https://maple.test${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }));
}

describe("Hosted DeepSeek Provider credentials", () => {
  it("validates and encrypts each workspace secret without exposing it in status", async () => {
    const { database, config } = setup();
    const encryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const apiKey = "sk-hosted-deepseek-secret";
    let authorization = "";
    const service = createHostedProviderCredentialService(database, config, {
      encryptionKey,
      fetcher: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response("{}", { status: 200 });
      }
    });
    const first = { workspaceId: "workspace-provider-a" };
    const second = { workspaceId: "workspace-provider-b" };

    expect(await service.deepSeekStatus(first)).toMatchObject({
      configured: false,
      source: "server_encrypted"
    });
    const connected = await service.connectDeepSeek(first, apiKey);
    expect(authorization).toBe(`Bearer ${apiKey}`);
    expect(connected).toMatchObject({ configured: true, source: "server_encrypted" });
    expect(JSON.stringify(connected)).not.toContain(apiKey);
    expect(await service.readDeepSeekApiKey(first)).toBe(apiKey);
    expect(await service.readDeepSeekApiKey(second)).toBeNull();

    const row = database.query(
      "SELECT workspace_id, encrypted_secret FROM provider_credentials WHERE provider = 'deepseek'"
    ).get() as { workspace_id: string; encrypted_secret: string };
    expect(row.workspace_id).toBe(first.workspaceId);
    expect(row.encrypted_secret).toStartWith("v1.");
    expect(row.encrypted_secret).not.toContain(apiKey);

    const wrongKeyService = createHostedProviderCredentialService(database, config, {
      encryptionKey: Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
    });
    await expect(wrongKeyService.readDeepSeekApiKey(first)).rejects.toMatchObject({
      code: "credential_decryption_failed"
    });

    expect((await service.disconnectDeepSeek(first)).configured).toBe(false);
    expect(database.query("SELECT COUNT(*) AS count FROM provider_credentials").get())
      .toEqual({ count: 0 });
  });

  it("uses a deployment-managed key without writing it to SQLite", async () => {
    const apiKey = "sk-hosted-environment-secret";
    const { database, config } = setup({ deepSeekApiKey: apiKey });
    const service = createHostedProviderCredentialService(database, config);
    const scope = { workspaceId: "workspace-provider-a" };

    expect(await service.deepSeekStatus(scope)).toMatchObject({
      configured: true,
      source: "environment"
    });
    expect(await service.readDeepSeekApiKey(scope)).toBe(apiKey);
    await expect(service.connectDeepSeek(scope, "sk-replacement-key")).rejects.toMatchObject({
      status: 409,
      code: "deepseek_environment_managed"
    });
    expect(database.query("SELECT COUNT(*) AS count FROM provider_credentials").get())
      .toEqual({ count: 0 });
  });

  it("creates one persistent Server encryption key when deployment configuration omits it", async () => {
    const { database, config } = setup();
    const scope = { workspaceId: "workspace-provider-a" };
    const apiKey = "sk-persistent-server-secret";
    const fetcher = async () => new Response("{}", { status: 200 });
    const firstService = createHostedProviderCredentialService(database, config, { fetcher });

    await firstService.connectDeepSeek(scope, apiKey);
    const keyPath = join(config.dataDir, "secrets", "provider-credentials.key");
    expect(existsSync(keyPath)).toBe(true);
    expect(Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64url")).toHaveLength(32);

    const restartedService = createHostedProviderCredentialService(database, config, { fetcher });
    expect(await restartedService.readDeepSeekApiKey(scope)).toBe(apiKey);
  });

  it("serves cloud status to the browser and releases the key only with authenticated DeepSeek claims", async () => {
    const { database, config } = setup();
    const workspaceId = "workspace-provider-a";
    const sessionToken = "hosted-provider-session-token";
    const csrfToken = "hosted-provider-csrf-token";
    const runnerToken = "hosted-provider-runner-token";
    const apiKey = "sk-cloud-runtime-deepseek";
    const now = new Date().toISOString();
    database.run(
      `INSERT INTO users(id, email, password_hash, name, created_at, updated_at)
       VALUES ('provider-user', 'provider@example.com', 'hash', 'Provider', ?, ?)`,
      [now, now]
    );
    database.run(
      "UPDATE workspaces SET owner_user_id = 'provider-user' WHERE id = ?",
      [workspaceId]
    );
    database.run(
      `INSERT INTO workspace_members(workspace_id, user_id, role, created_at)
       VALUES (?, 'provider-user', 'owner', ?)`,
      [workspaceId, now]
    );
    database.run(
      `INSERT INTO web_sessions(
         id, token_hash, user_id, active_workspace_id, csrf_token, csrf_token_hash, trust,
         ip_address, network_key, user_agent_hash, device_label, created_at, last_seen_at, expires_at
       ) VALUES ('provider-session', ?, 'provider-user', ?, ?, ?, 'trusted',
                 '127.0.0.1', 'loopback', 'agent', 'Provider browser', ?, ?, '2099-01-01T00:00:00.000Z')`,
      [hashSecret(sessionToken), workspaceId, csrfToken, hashSecret(csrfToken), now, now]
    );
    database.run(
      `INSERT INTO runners(
         id, workspace_id, token_hash, name, hostname, platform, version,
         supported_workers, worker_inventory, capabilities, last_seen_at, created_at
       ) VALUES ('provider-runner', ?, ?, 'Cloud runner', 'runner.local', 'win32/x64', '0.1.7',
                 '[]', NULL, '[]', ?, ?)`,
      [workspaceId, hashSecret(runnerToken), now, now]
    );
    database.run(
      `INSERT INTO projects(id, workspace_id, external_key, name, created_at, updated_at)
       VALUES ('provider-project', ?, 'provider:project', 'Provider project', ?, ?)`,
      [workspaceId, now, now]
    );
    database.run(
      `INSERT INTO project_bindings(
         id, project_id, runner_id, workspace_label, last_seen_at, created_at, updated_at
       ) VALUES ('provider-binding', 'provider-project', 'provider-runner', 'provider-project', ?, ?, ?)`,
      [now, now, now]
    );

    const providerCredentials = createHostedProviderCredentialService(database, config, {
      encryptionKey: Uint8Array.from({ length: 32 }, (_, index) => index + 11),
      fetcher: async () => new Response("{}", { status: 200 })
    });
    const app = createServerApp({ config, database, providerCredentials });
    const web = { sessionToken, csrfToken, workspaceId };

    const connectedResponse = await request(app, "/api/provider-connections/deepseek/connect", {
      ...web,
      method: "POST",
      body: { apiKey }
    });
    expect(connectedResponse.status).toBe(200);
    const connectedJson = await connectedResponse.json();
    expect(connectedJson).toMatchObject({ configured: true, source: "server_encrypted" });
    expect(JSON.stringify(connectedJson)).not.toContain(apiKey);

    const heartbeatResponse = await request(app, "/api/runner/heartbeat", {
      method: "POST",
      runnerToken,
      body: {
        version: "0.1.7",
        supportedWorkers: ["codex", "deepseek"],
        capabilities: ["project_manager_v1", "provider_credentials_v1"]
      }
    });
    expect(heartbeatResponse.status).toBe(200);
    expect((await heartbeatResponse.json() as RunnerHeartbeatResponse).providerConnections)
      .toEqual({ deepseek: { configured: true } });

    const settingsResponse = await request(app, "/api/settings/execution", {
      ...web,
      method: "PATCH",
      body: { leaderWorker: "deepseek" }
    });
    expect(settingsResponse.status).toBe(200);
    const todoResponse = await request(app, "/api/projects/provider-project/todos", {
      ...web,
      method: "POST",
      body: { title: "Cloud DeepSeek manager", workerKind: "deepseek", status: "todo" }
    });
    expect(todoResponse.status).toBe(200);

    const managerClaimResponse = await request(app, "/api/runner/project-manager/claim", {
      method: "POST",
      runnerToken
    });
    const managerClaim = await managerClaimResponse.json() as ClaimProjectManagerJobResponse;
    expect(managerClaim.job?.runtimeProviderCredentials?.deepseekApiKey).toBe(apiKey);

    database.run(
      `INSERT INTO todos(
         id, project_id, title, details, status, priority, worker_kind, created_at, updated_at
       ) VALUES ('provider-direct-todo', 'provider-project', 'Cloud DeepSeek worker', '', 'todo', 10, 'deepseek', ?, ?)`,
      [now, now]
    );
    const workerClaimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      runnerToken
    });
    const workerClaim = await workerClaimResponse.json() as ClaimJobResponse;
    expect(workerClaim.job?.todo.id).toBe("provider-direct-todo");
    expect(workerClaim.job?.runtimeProviderCredentials?.deepseekApiKey).toBe(apiKey);

    const legacyRunnerToken = "legacy-provider-runner-token";
    database.run(
      `INSERT INTO runners(
         id, workspace_id, token_hash, name, hostname, platform, version,
         supported_workers, worker_inventory, capabilities, last_seen_at, created_at
       ) VALUES ('legacy-provider-runner', ?, ?, 'Legacy runner', 'legacy.local', 'win32/x64', '0.1.6',
                 '["deepseek"]', NULL, '[]', ?, ?)`,
      [workspaceId, hashSecret(legacyRunnerToken), now, now]
    );
    database.run(
      `INSERT INTO projects(id, workspace_id, external_key, name, created_at, updated_at)
       VALUES ('legacy-provider-project', ?, 'provider:legacy', 'Legacy provider project', ?, ?)`,
      [workspaceId, now, now]
    );
    database.run(
      `INSERT INTO project_bindings(
         id, project_id, runner_id, workspace_label, last_seen_at, created_at, updated_at
       ) VALUES ('legacy-provider-binding', 'legacy-provider-project', 'legacy-provider-runner',
                 'legacy-provider-project', ?, ?, ?)`,
      [now, now, now]
    );
    database.run(
      `INSERT INTO todos(
         id, project_id, title, details, status, priority, worker_kind, created_at, updated_at
       ) VALUES ('legacy-provider-todo', 'legacy-provider-project', 'Legacy DeepSeek worker', '',
                 'todo', 10, 'deepseek', ?, ?)`,
      [now, now]
    );
    const legacyClaimResponse = await request(app, "/api/runner/jobs/claim", {
      method: "POST",
      runnerToken: legacyRunnerToken
    });
    const legacyClaim = await legacyClaimResponse.json() as ClaimJobResponse;
    expect(legacyClaim.job?.todo.id).toBe("legacy-provider-todo");
    expect(legacyClaim.job?.runtimeProviderCredentials).toBeUndefined();

    const browserStatus = await request(app, "/api/provider-connections/deepseek", web);
    expect(JSON.stringify(await browserStatus.json())).not.toContain(apiKey);
  });
});

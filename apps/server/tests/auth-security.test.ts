import { afterEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthSessionResponse, DeviceAuthorizationStartResponse, DeviceAuthorizationTokenResponse } from "@maple/protocol";
import { createServerApp } from "../src/app";
import type { ServerConfig } from "../src/config";
import { createDatabase } from "../src/database/client";

const databases: Database[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close(false);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function createApp() {
  const dataDir = mkdtempSync(join(tmpdir(), "maple-auth-test-"));
  directories.push(dataDir);
  const database = createDatabase(":memory:");
  databases.push(database);
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 45820,
    dataDir,
    databasePath: ":memory:",
    webRoot: dataDir,
    allowedOrigins: ["http://localhost"],
    leaseSeconds: 45,
    runnerOfflineSeconds: 30,
    pairingTtlSeconds: 600,
    runnerCommandTtlSeconds: 900,
    publicUrl: "http://localhost",
    secureCookies: false,
    registrationEnabled: true
  };
  return { database, app: createServerApp({ config, database }) };
}

async function request(
  app: ReturnType<typeof createServerApp>,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    cookie?: string;
    csrf?: string;
    token?: string;
    userAgent?: string;
    workspaceId?: string;
  } = {}
): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrf) headers.set("x-maple-csrf", options.csrf);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.workspaceId) headers.set("x-maple-workspace", options.workspaceId);
  if (options.method && options.method !== "GET") headers.set("origin", "http://localhost");
  headers.set("user-agent", options.userAgent || "Chrome/140 Windows");
  return app.handle(new Request(`http://localhost${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }));
}

function cookie(response: Response): string {
  return response.headers.get("set-cookie")!.split(";", 1)[0]!;
}

async function register(app: ReturnType<typeof createServerApp>, email: string, name: string) {
  const response = await request(app, "/api/auth/register", {
    method: "POST",
    body: { email, name, password: "a-strong-password-123" }
  });
  expect(response.status).toBe(200);
  const session = await response.json() as AuthSessionResponse;
  expect(session.workspace.name).toBe(`${name}的工作区`);
  return { cookie: cookie(response), session };
}

describe("Maple hosted authentication", () => {
  it("isolates dashboard data by workspace and rejects mutations without CSRF", async () => {
    const { app, database } = createApp();
    const first = await register(app, "first@example.com", "First");
    const second = await register(app, "second@example.com", "Second");
    const now = new Date().toISOString();
    database.run(
      `INSERT INTO projects(id, workspace_id, external_key, workspace_external_key, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["project-first", first.session.workspace.id, "internal:first", "git:first", "First project", now, now]
    );
    database.run(
      `INSERT INTO projects(id, workspace_id, external_key, workspace_external_key, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["project-second", second.session.workspace.id, "internal:second", "git:second", "Second project", now, now]
    );

    const firstDashboard = await request(app, "/api/dashboard", { cookie: first.cookie });
    expect(firstDashboard.status).toBe(200);
    expect(((await firstDashboard.json()) as { projects: Array<{ id: string }> }).projects.map((item) => item.id)).toEqual(["project-first"]);

    const crossTenantTodo = await request(app, "/api/projects/project-second/todos", {
      method: "POST",
      cookie: first.cookie,
      csrf: first.session.csrfToken,
      body: { title: "Cross tenant", workerKind: "codex", status: "todo" }
    });
    expect(crossTenantTodo.status).toBe(404);

    const missingCsrf = await request(app, "/api/projects/project-first/todos", {
      method: "POST",
      cookie: first.cookie,
      body: { title: "No CSRF", workerKind: "codex", status: "todo" }
    });
    expect(missingCsrf.status).toBe(403);
    expect((await missingCsrf.json()).error.code).toBe("csrf_invalid");
  });

  it("holds a new browser session for review until a trusted device approves it", async () => {
    const { app } = createApp();
    const trusted = await register(app, "review@example.com", "Review");
    const login = await request(app, "/api/auth/login", {
      method: "POST",
      userAgent: "Firefox/142 Linux",
      body: { email: "review@example.com", password: "a-strong-password-123" }
    });
    const reviewCookie = cookie(login);
    const reviewSession = await login.json() as AuthSessionResponse;
    expect(reviewSession.session.trust).toBe("review");
    expect((await request(app, "/api/dashboard", { cookie: reviewCookie })).status).toBe(403);

    const approved = await request(app, `/api/account/sessions/${reviewSession.session.id}/approve`, {
      method: "POST",
      cookie: trusted.cookie,
      csrf: trusted.session.csrfToken
    });
    expect(approved.status).toBe(200);
    expect((await approved.json()).trust).toBe("trusted");

    const refreshed = await request(app, "/api/auth/session", { cookie: reviewCookie, userAgent: "Firefox/142 Linux" });
    expect((await refreshed.json() as AuthSessionResponse).session.trust).toBe("trusted");
    expect((await request(app, "/api/dashboard", { cookie: reviewCookie, userAgent: "Firefox/142 Linux" })).status).toBe(200);
  });

  it("authorizes a CLI into the active workspace with PKCE and one-time exchange", async () => {
    const { app } = createApp();
    const account = await register(app, "runner@example.com", "Runner");
    const verifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
    const startedResponse = await request(app, "/api/device-authorizations", {
      method: "POST",
      body: {
        runnerName: "host",
        hostname: "host",
        platform: "linux/x64",
        version: "0.1.7",
        codeChallenge,
        supportedWorkers: ["codex"],
        capabilities: ["project_manager_v1"]
      }
    });
    expect(startedResponse.status).toBe(200);
    const started = await startedResponse.json() as DeviceAuthorizationStartResponse;
    expect(started.verificationUriComplete).toContain(encodeURIComponent(started.userCode));

    const invalidName = await request(app, "/api/device-authorizations/approve", {
      method: "POST",
      cookie: account.cookie,
      csrf: account.session.csrfToken,
      body: { userCode: started.userCode, runnerName: "   " }
    });
    expect(invalidName.status).toBe(422);

    const approved = await request(app, "/api/device-authorizations/approve", {
      method: "POST",
      cookie: account.cookie,
      csrf: account.session.csrfToken,
      body: { userCode: started.userCode, runnerName: "  Studio workstation  " }
    });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({
      approved: true,
      workspaceId: account.session.workspace.id,
      runnerName: "Studio workstation"
    });

    const exchanged = await request(app, "/api/device-authorizations/token", {
      method: "POST",
      body: { deviceCode: started.deviceCode, codeVerifier: verifier }
    });
    const token = await exchanged.json() as DeviceAuthorizationTokenResponse;
    expect(token.status).toBe("authorized");
    if (token.status !== "authorized") throw new Error("authorization failed");
    expect(token.workspace.id).toBe(account.session.workspace.id);
    expect(token.runner.workspaceId).toBe(account.session.workspace.id);
    expect(token.runner.name).toBe("Studio workstation");
    expect(token.runnerToken.length).toBeGreaterThan(30);

    const replay = await request(app, "/api/device-authorizations/token", {
      method: "POST",
      body: { deviceCode: started.deviceCode, codeVerifier: verifier }
    });
    expect((await replay.json() as DeviceAuthorizationTokenResponse).status).toBe("expired");

    const registeredProject = await request(app, "/api/runner/projects", {
      method: "POST",
      token: token.runnerToken,
      body: {
        externalKey: "git:runner-project",
        name: "Runner project",
        workspaceLabel: "/workspace/runner-project"
      }
    });
    expect(registeredProject.status).toBe(200);

    const disconnected = await request(app, "/api/runner/connection", {
      method: "DELETE",
      token: token.runnerToken
    });
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toEqual({ revoked: true });

    const revokedHeartbeat = await request(app, "/api/runner/heartbeat", {
      method: "POST",
      token: token.runnerToken,
      body: { version: "0.1.7" }
    });
    expect(revokedHeartbeat.status).toBe(401);

    const dashboard = await request(app, "/api/dashboard", { cookie: account.cookie });
    const snapshot = await dashboard.json() as {
      projects: Array<{ name: string }>;
      runners: Array<{ id: string }>;
      bindings: Array<{ runnerId: string }>;
    };
    expect(snapshot.projects.some((project) => project.name === "Runner project")).toBe(true);
    expect(snapshot.runners.some((runner) => runner.id === token.runner.id)).toBe(false);
    expect(snapshot.bindings.some((binding) => binding.runnerId === token.runner.id)).toBe(false);
  });

  it("keeps the CLI hostname when approval does not override the device name", async () => {
    const { app } = createApp();
    const account = await register(app, "compatible-runner@example.com", "Compatible runner");
    const verifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
    const startedResponse = await request(app, "/api/device-authorizations", {
      method: "POST",
      body: {
        runnerName: "holybread",
        hostname: "holybread",
        platform: "win32/x64",
        version: "0.1.7",
        codeChallenge
      }
    });
    const started = await startedResponse.json() as DeviceAuthorizationStartResponse;

    const approved = await request(app, "/api/device-authorizations/approve", {
      method: "POST",
      cookie: account.cookie,
      csrf: account.session.csrfToken,
      body: { userCode: started.userCode }
    });
    expect(await approved.json()).toEqual({
      approved: true,
      workspaceId: account.session.workspace.id,
      runnerName: "holybread"
    });

    const exchanged = await request(app, "/api/device-authorizations/token", {
      method: "POST",
      body: { deviceCode: started.deviceCode, codeVerifier: verifier }
    });
    const token = await exchanged.json() as DeviceAuthorizationTokenResponse;
    expect(token.status).toBe("authorized");
    if (token.status === "authorized") expect(token.runner.name).toBe("holybread");
  });

  it("keeps CSRF stable and isolates the selected workspace per browser tab", async () => {
    const { app, database } = createApp();
    const account = await register(app, "tabs@example.com", "Tabs");
    const firstWorkspaceId = account.session.workspace.id;

    const createdResponse = await request(app, "/api/workspaces", {
      method: "POST",
      cookie: account.cookie,
      csrf: account.session.csrfToken,
      workspaceId: firstWorkspaceId,
      body: { name: "Second workspace" }
    });
    expect(createdResponse.status).toBe(200);
    const secondSession = await createdResponse.json() as AuthSessionResponse;
    const secondWorkspaceId = secondSession.workspace.id;
    expect(secondSession.csrfToken).toBe(account.session.csrfToken);

    const firstTabSession = await request(app, "/api/auth/session", {
      cookie: account.cookie,
      workspaceId: firstWorkspaceId
    });
    const secondTabSession = await request(app, "/api/auth/session", {
      cookie: account.cookie,
      workspaceId: secondWorkspaceId
    });
    expect((await firstTabSession.json() as AuthSessionResponse).workspace.id).toBe(firstWorkspaceId);
    expect((await secondTabSession.json() as AuthSessionResponse).workspace.id).toBe(secondWorkspaceId);
    expect((await request(app, "/api/auth/session", {
      cookie: account.cookie,
      workspaceId: firstWorkspaceId
    }).then((response) => response.json()) as AuthSessionResponse).csrfToken).toBe(account.session.csrfToken);

    const now = new Date().toISOString();
    for (const [id, workspaceId] of [["project-tab-a", firstWorkspaceId], ["project-tab-b", secondWorkspaceId]]) {
      database.run(
        `INSERT INTO projects(id, workspace_id, external_key, workspace_external_key, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, workspaceId, `internal:${id}`, `git:${id}`, id, now, now]
      );
    }
    const firstDashboard = await request(app, "/api/dashboard", {
      cookie: account.cookie,
      workspaceId: firstWorkspaceId
    });
    const secondDashboard = await request(app, "/api/dashboard", {
      cookie: account.cookie,
      workspaceId: secondWorkspaceId
    });
    expect((await firstDashboard.json()).projects.map((project: { id: string }) => project.id)).toEqual(["project-tab-a"]);
    expect((await secondDashboard.json()).projects.map((project: { id: string }) => project.id)).toEqual(["project-tab-b"]);

    const firstSettings = await request(app, "/api/settings/acceptance", {
      method: "PATCH",
      cookie: account.cookie,
      csrf: account.session.csrfToken,
      workspaceId: firstWorkspaceId,
      body: { backgroundPlaywrightScreenshot: true }
    });
    expect(firstSettings.status).toBe(200);
    expect((await request(app, "/api/settings/acceptance", {
      cookie: account.cookie,
      workspaceId: secondWorkspaceId
    }).then((response) => response.json())).backgroundPlaywrightScreenshot).toBe(false);
  });

  it("stores user preferences per account and rejects the removed Admin Token path", async () => {
    const { app } = createApp();
    const first = await register(app, "preferences-a@example.com", "Preference A");
    const second = await register(app, "preferences-b@example.com", "Preference B");

    const updated = await request(app, "/api/account/preferences", {
      method: "PATCH",
      cookie: first.cookie,
      csrf: first.session.csrfToken,
      workspaceId: first.session.workspace.id,
      body: { theme: "dark", uiFont: "chill-round", uiLanguage: "en" }
    });
    expect(await updated.json()).toEqual({ theme: "dark", uiFont: "chill-round", uiLanguage: "en" });
    const untouched = await request(app, "/api/account/preferences", {
      cookie: second.cookie,
      workspaceId: second.session.workspace.id
    });
    expect(await untouched.json()).toEqual({ theme: "system", uiFont: "default", uiLanguage: "zh" });

    const removedAdmin = await request(app, "/api/dashboard", { token: "obsolete-admin-token" });
    expect(removedAdmin.status).toBe(401);
  });
});

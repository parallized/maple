import { afterEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthSessionResponse } from "@maple/protocol";
import { createServerApp } from "../src/app";
import { createDatabase } from "../src/database/client";
import { createStandaloneServerConfig } from "../src/standalone/config";
import { ensureStandaloneIdentity } from "../src/standalone/identity";

const directories: string[] = [];
const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "maple-standalone-test-"));
  directories.push(directory);
  const webRoot = join(directory, "web");
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Maple Local</title>");
  const config = createStandaloneServerConfig({ dataDir: join(directory, "data"), webRoot });
  const database = createDatabase(":memory:");
  databases.push(database);
  const identity = await ensureStandaloneIdentity(database);
  const app = createServerApp({ config, database, standaloneIdentity: identity });
  return { app, config, database, identity };
}

function cookie(response: Response): string {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

describe("Maple Local authentication", () => {
  it("creates one persistent local identity and signs the browser in without credentials", async () => {
    const { app, config, database, identity } = await setup();
    const response = await app.handle(new Request("http://localhost/api/auth/session", {
      headers: { "user-agent": "Chrome Local" }
    }));
    expect(response.status).toBe(200);
    expect(cookie(response).startsWith("maple_standalone_session=")).toBe(true);
    expect(cookie(response).startsWith("maple_session=")).toBe(false);
    const session = await response.json() as AuthSessionResponse;
    expect(session.authenticated).toBe(true);
    expect(session.deploymentMode).toBe("standalone");
    expect(session.session.trust).toBe("trusted");
    expect(session.user.id).toBe(identity.userId);
    expect(session.workspace.id).toBe(identity.workspaceId);
    expect(session.workspace.name).toBe(hostname());
    expect(config.host).toBe("127.0.0.1");
    expect(database.query("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 1 });
    expect(database.query("SELECT COUNT(*) AS count FROM workspaces").get()).toEqual({ count: 1 });

    database.run("UPDATE users SET name = '自定义名称' WHERE id = ?", [identity.userId]);
    database.run("UPDATE workspaces SET name = '本地研发' WHERE id = ?", [identity.workspaceId]);
    const refreshed = await ensureStandaloneIdentity(database);
    expect(refreshed.userId).toBe(identity.userId);
    expect(refreshed.workspaceId).toBe(identity.workspaceId);
    expect(refreshed.workspaceName).toBe("本地研发");
    expect(database.query("SELECT name FROM users WHERE id = ?").get(identity.userId)).toEqual({ name: "自定义名称" });
    expect(database.query("SELECT name FROM workspaces WHERE id = ?").get(identity.workspaceId)).toEqual({ name: "本地研发" });
  });

  it("keeps local sessions trusted while disabling hosted login, password, workspace and pairing flows", async () => {
    const { app } = await setup();
    const first = await app.handle(new Request("http://localhost/api/auth/session", {
      headers: { "user-agent": "Chrome Local" }
    }));
    const session = await first.clone().json() as AuthSessionResponse;
    const localCookie = cookie(first);

    const second = await app.handle(new Request("http://localhost/api/auth/session", {
      headers: { "user-agent": "Firefox Local" }
    }));
    expect((await second.json() as AuthSessionResponse).session.trust).toBe("trusted");

    const cases: Array<{ path: string; body: unknown; authenticated?: boolean }> = [
      { path: "/api/auth/register", body: { email: "user@example.com", password: "1234567890", name: "User" } },
      { path: "/api/auth/login", body: { email: "user@example.com", password: "1234567890" } },
      { path: "/api/account/password", body: { currentPassword: "1234567890", newPassword: "abcdefghij" }, authenticated: true },
      { path: "/api/workspaces", body: { name: "Another workspace" }, authenticated: true },
      {
        path: "/api/device-authorizations",
        body: {
          runnerName: "external",
          hostname: "external",
          platform: "test/x64",
          version: "1.0.0",
          codeChallenge: "a".repeat(43)
        }
      },
      {
        path: "/api/pairings/exchange",
        body: {
          code: "ABCD-EFGH",
          runnerName: "external",
          hostname: "external",
          platform: "test/x64",
          version: "1.0.0"
        }
      }
    ];

    for (const item of cases) {
      const headers = new Headers({
        "content-type": "application/json",
        origin: "http://localhost"
      });
      if (item.authenticated) {
        headers.set("cookie", localCookie);
        headers.set("x-maple-csrf", session.csrfToken);
        headers.set("x-maple-workspace", session.workspace.id);
      }
      const response = await app.handle(new Request(`http://localhost${item.path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(item.body)
      }));
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("hosted_feature_unavailable");
    }
  });
});

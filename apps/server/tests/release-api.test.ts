import { afterEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import type {
  HealthResponse,
  HomeStatsResponse,
  RecordInstallShDownloadResponse,
  VersionHistoryResponse
} from "@maple/protocol";
import { createServerApp } from "../src/app";
import type { ServerConfig } from "../src/config";
import { createDatabase } from "../src/database/client";

const databases: Database[] = [];

function createApp() {
  const database = createDatabase(":memory:");
  databases.push(database);
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    dataDir: ".",
    databasePath: ":memory:",
    webRoot: ".",
    allowedOrigins: ["http://maple.test"],
    leaseSeconds: 45,
    runnerOfflineSeconds: 30,
    pairingTtlSeconds: 600,
    runnerCommandTtlSeconds: 900
  };
  return createServerApp({ config, database });
}

function request(
  app: ReturnType<typeof createServerApp>,
  path: string,
  options: { method?: string; installId?: string } = {}
): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (options.installId) headers.set("x-maple-install-id", options.installId);
  return app.handle(new Request(`http://maple.test${path}`, {
    method: options.method ?? "GET",
    headers
  }));
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("Release and homepage statistics API", () => {
  it("exposes one version source and persists successful install.sh events", async () => {
    const app = createApp();
    const health = await (await request(app, "/health")).json() as HealthResponse;
    const initial = await (await request(app, "/api/home-stats")).json() as HomeStatsResponse;
    const history = await (await request(app, "/api/version-history")).json() as VersionHistoryResponse;

    expect(initial).toEqual({ version: health.version, installShDownloads: 0 });
    expect(history.currentVersion).toBe(health.version);
    expect(history.releases[0]?.version).toBe(health.version);
    expect(history.releases[0]?.installShDownloads).toBe(0);
    expect(history.releases.every((release) => release.changes.length > 0)).toBe(true);

    const recordedResponse = await request(app, "/api/downloads/install-sh", {
      method: "POST",
      installId: "0123456789abcdef0123456789abcdef"
    });
    expect(recordedResponse.status).toBe(200);
    expect(await recordedResponse.json() as RecordInstallShDownloadResponse).toEqual({
      version: health.version,
      installShDownloads: 1,
      counted: true
    });

    const duplicateResponse = await request(app, "/api/downloads/install-sh", {
      method: "POST",
      installId: "0123456789abcdef0123456789abcdef"
    });
    expect(await duplicateResponse.json() as RecordInstallShDownloadResponse).toEqual({
      version: health.version,
      installShDownloads: 1,
      counted: false
    });

    const updatedHistory = await (await request(app, "/api/version-history")).json() as VersionHistoryResponse;
    expect(updatedHistory.releases[0]?.installShDownloads).toBe(1);
  });

  it("rejects malformed events and limits unique events from one network", async () => {
    const app = createApp();
    const malformed = await request(app, "/api/downloads/install-sh", { method: "POST" });
    expect(malformed.status).toBe(422);
    expect((await malformed.json()).error.code).toBe("install_event_invalid");

    for (let index = 0; index < 20; index += 1) {
      const response = await request(app, "/api/downloads/install-sh", {
        method: "POST",
        installId: `install-event-${String(index).padStart(20, "0")}`
      });
      expect(response.status).toBe(200);
    }
    const limited = await request(app, "/api/downloads/install-sh", {
      method: "POST",
      installId: "install-event-rate-limit-000000000000"
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");
    expect((await limited.json()).error.code).toBe("download_rate_limited");
  });
});


import { afterEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { createServerApp } from "../src/app";
import { createDatabase } from "../src/database/client";
import type { ServerConfig } from "../src/config";
import { ModelPricingRepository } from "../src/repositories/model-pricing-repository";
import { parseWindowsProxyServer, resolveFetchProxyUrl } from "../src/network/system-proxy";
import { ModelPricingSyncService } from "../src/services/model-pricing-sync-service";
import { ensureStandaloneIdentity } from "../src/standalone/identity";

const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dataDir: ".",
    databasePath: ":memory:",
    webRoot: ".",
    allowedOrigins: [],
    leaseSeconds: 45,
    runnerOfflineSeconds: 30,
    pairingTtlSeconds: 600,
    runnerCommandTtlSeconds: 900,
    modelPricingSyncEnabled: true,
    modelPricingFetchTimeoutMs: 5_000,
    ...overrides
  };
}

function payload() {
  return {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-test": {
          id: "gpt-test",
          name: "GPT Test",
          last_updated: "2026-07-30",
          cost: {
            input: 1.25,
            reasoning: 2.5,
            output: 10,
            cache_read: 0.125,
            tiers: [{ input: 2, output: 12, tier: { type: "context", size: 272_000 } }]
          }
        },
        "free-test": {
          id: "free-test",
          name: "Free Test"
        }
      }
    }
  };
}

function setup() {
  const database = createDatabase(":memory:");
  databases.push(database);
  const repository = new ModelPricingRepository(database);
  return { database, repository };
}

describe("models.dev model pricing synchronization", () => {
  it("uses the Windows system proxy when Bun proxy environment variables are absent", () => {
    const registry = new Map([
      ["ProxyEnable", "0x1"],
      ["ProxyServer", "http=127.0.0.1:8080;https=127.0.0.1:8443"]
    ]);
    expect(resolveFetchProxyUrl("https://models.dev/api.json", {
      platform: "win32",
      env: {},
      readWindowsRegistryValue: (name) => registry.get(name) ?? null
    })).toBe("http://127.0.0.1:8443/");
    expect(resolveFetchProxyUrl("https://models.dev/api.json", {
      platform: "win32",
      env: { HTTPS_PROXY: "http://environment-proxy:8080" },
      readWindowsRegistryValue: (name) => registry.get(name) ?? null
    })).toBeNull();
    expect(parseWindowsProxyServer("127.0.0.1:7890", "https:"))
      .toBe("http://127.0.0.1:7890/");
  });

  it("passes an explicitly resolved proxy to the models.dev request", async () => {
    const { repository } = setup();
    let requestProxy: string | undefined;
    const service = new ModelPricingSyncService(repository, config(), {
      proxyUrl: "http://127.0.0.1:7890",
      fetcher: async (_input, init) => {
        requestProxy = init?.proxy as string | undefined;
        return new Response(JSON.stringify(payload()), { status: 200 });
      }
    });

    await expect(service.syncNow()).resolves.toMatchObject({ outcome: "updated" });
    expect(requestProxy).toBe("http://127.0.0.1:7890");
  });

  it("retries a failed initial refresh before returning to the daily interval", async () => {
    const { repository } = setup();
    let calls = 0;
    const service = new ModelPricingSyncService(repository, config({ modelPricingSyncIntervalHours: 24 }), {
      retryIntervalMs: 5,
      fetcher: async () => {
        calls += 1;
        return calls === 1
          ? new Response("upstream unavailable", { status: 503 })
          : new Response(JSON.stringify(payload()), { status: 200 });
      },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined }
    });

    service.start();
    const deadline = Date.now() + 1_000;
    while (calls < 2 && Date.now() < deadline) await Bun.sleep(5);
    service.stop();

    expect(calls).toBe(2);
    expect(repository.status()).toMatchObject({ modelCount: 2, pricedModelCount: 1, lastError: null });
  });

  it("stores a normalized snapshot and preserves nested pricing tiers", async () => {
    const { repository } = setup();
    const service = new ModelPricingSyncService(repository, config(), {
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      fetcher: async () => new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { etag: '"catalog-v1"' }
      })
    });

    await expect(service.syncNow()).resolves.toMatchObject({
      outcome: "updated",
      modelCount: 2,
      pricedModelCount: 1
    });
    const result = repository.list({ limit: 10, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.items[0]).toMatchObject({
      providerId: "openai",
      modelId: "free-test",
      inputUsdPerMillion: null,
      outputUsdPerMillion: null
    });
    const priced = result.items.find((item) => item.modelId === "gpt-test")!;
    expect(priced.inputUsdPerMillion).toBe(1.25);
    expect(priced.reasoningUsdPerMillion).toBe(2.5);
    expect(priced.cost.tiers).toEqual([
      { input: 2, output: 12, tier: { type: "context", size: 272_000 } }
    ]);
    expect(repository.status()).toMatchObject({
      etag: '"catalog-v1"',
      providerCount: 1,
      modelCount: 2,
      pricedModelCount: 1,
      lastError: null
    });
  });

  it("uses ETag revalidation and keeps the existing matrix on 304", async () => {
    const { repository } = setup();
    const requestState: { ifNoneMatch: string | null } = { ifNoneMatch: null };
    let call = 0;
    const service = new ModelPricingSyncService(repository, config(), {
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      fetcher: async (_input, init) => {
        requestState.ifNoneMatch = new Headers(init?.headers).get("if-none-match");
        call += 1;
        return call === 1
          ? new Response(JSON.stringify(payload()), { status: 200, headers: { etag: '"catalog-v1"' } })
          : new Response(null, { status: 304, headers: { etag: '"catalog-v1"' } });
      }
    });

    await service.syncNow();
    const second = await service.syncNow();
    expect(second.outcome).toBe("not_modified");
    expect(requestState.ifNoneMatch).toBe('"catalog-v1"');
    expect(repository.list({ limit: 10, offset: 0 }).total).toBe(2);
    expect(repository.status().lastError).toBeNull();
  });

  it("retains the last successful snapshot when the source fails", async () => {
    const { repository } = setup();
    let fail = false;
    const service = new ModelPricingSyncService(repository, config(), {
      fetcher: async () => fail
        ? new Response("upstream unavailable", { status: 503 })
        : new Response(JSON.stringify(payload()), { status: 200 })
    });

    await service.syncNow();
    fail = true;
    const failed = await service.syncNow();
    expect(failed).toMatchObject({ outcome: "failed" });
    expect(repository.list({ limit: 10, offset: 0 }).total).toBe(2);
    expect(repository.status().lastError).toContain("HTTP 503");
  });

  it("serves the cached matrix and sync status through the authenticated API", async () => {
    const { database, repository } = setup();
    const identity = await ensureStandaloneIdentity(database);
    const service = new ModelPricingSyncService(repository, config({ deploymentMode: "standalone" }), {
      fetcher: async () => new Response(JSON.stringify(payload()), { status: 200 })
    });
    await service.syncNow();
    const app = createServerApp({
      config: config({ deploymentMode: "standalone" }),
      database,
      standaloneIdentity: identity,
      modelPricingSync: service
    });

    const sessionResponse = await app.handle(new Request("http://localhost/api/auth/session"));
    const session = await sessionResponse.clone().json() as { workspace: { id: string } };
    const sessionCookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const headers = {
      cookie: sessionCookie,
      "x-maple-workspace": session.workspace.id
    };
    const matrixResponse = await app.handle(new Request(
      "http://localhost/api/model-pricing?provider=openai&limit=1&offset=0",
      { headers }
    ));
    expect(matrixResponse.status).toBe(200);
    const matrix = await matrixResponse.json();
    expect(matrix.total).toBe(2);
    expect(matrix.items).toHaveLength(1);
    expect(matrix.items[0].providerId).toBe("openai");

    const statusResponse = await app.handle(new Request("http://localhost/api/model-pricing/status", { headers }));
    expect(await statusResponse.json()).toMatchObject({ enabled: true, modelCount: 2 });
  });
});

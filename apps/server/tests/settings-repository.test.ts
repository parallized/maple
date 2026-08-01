import { afterEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { createDatabase } from "../src/database/client";
import { SettingsRepository } from "../src/repositories/settings-repository";

const databases: Database[] = [];
const WORKSPACE_ID = "10000000-0000-4000-8000-000000000010";

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function setup(): { database: Database; settings: SettingsRepository } {
  const database = createDatabase(":memory:");
  databases.push(database);
  const now = "2026-07-29T00:00:00.000Z";
  database.run(
    "INSERT INTO workspaces(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [WORKSPACE_ID, "Settings test", now, now]
  );
  return { database, settings: new SettingsRepository(database) };
}

describe("Workspace execution settings", () => {
  it("defaults concurrency to 4 and persists values across the full 1-16 range", () => {
    const { database, settings } = setup();
    settings.seedDefaults(WORKSPACE_ID);

    expect(settings.getExecution(WORKSPACE_ID).concurrency).toBe(4);
    expect(settings.updateExecution({ concurrency: 1 }, WORKSPACE_ID).concurrency).toBe(1);
    expect(settings.updateExecution({ concurrency: 16 }, WORKSPACE_ID).concurrency).toBe(16);
    expect(database.query(
      "SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = 'execution.concurrency'"
    ).get(WORKSPACE_ID)).toEqual({ value: "16" });
  });

  it("migrates the legacy base Worker into both independent settings", () => {
    const { database, settings } = setup();
    database.run(
      "INSERT INTO workspace_settings(workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?)",
      [WORKSPACE_ID, "execution.base_worker", "kimi", "2026-07-29T00:00:00.000Z"]
    );

    settings.seedDefaults(WORKSPACE_ID);

    expect(settings.getExecution(WORKSPACE_ID)).toMatchObject({
      defaultWorker: "kimi",
      leaderWorker: "kimi",
      baseWorker: "kimi"
    });
    expect(database.query(
      `SELECT key, value FROM workspace_settings
       WHERE workspace_id = ? AND key IN ('execution.default_worker', 'execution.leader_worker')
       ORDER BY key`
    ).all(WORKSPACE_ID)).toEqual([
      { key: "execution.default_worker", value: "kimi" },
      { key: "execution.leader_worker", value: "kimi" }
    ]);
  });

  it("updates the default Worker and Leader PM Worker independently", () => {
    const { settings } = setup();
    settings.seedDefaults(WORKSPACE_ID);

    expect(settings.updateExecution({ defaultWorker: "kimi" }, WORKSPACE_ID)).toMatchObject({
      defaultWorker: "kimi",
      leaderWorker: "claude",
      baseWorker: "kimi"
    });
    expect(settings.updateExecution({ leaderWorker: "glm" }, WORKSPACE_ID)).toMatchObject({
      defaultWorker: "kimi",
      leaderWorker: "glm",
      baseWorker: "kimi"
    });
  });

  it("keeps legacy clients compatible by applying baseWorker to both settings", () => {
    const { settings } = setup();
    settings.seedDefaults(WORKSPACE_ID);

    expect(settings.updateExecution({ baseWorker: "opencode" }, WORKSPACE_ID)).toMatchObject({
      defaultWorker: "opencode",
      leaderWorker: "opencode",
      baseWorker: "opencode"
    });
  });
});

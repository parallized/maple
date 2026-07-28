import type { Database } from "bun:sqlite";
import {
  AI_OUTPUT_LANGUAGES,
  DEFAULT_SCREENSHOT_COMPRESSION_PRESET,
  DEFAULT_WORKSPACE_EXECUTION_SETTINGS,
  WORKER_KINDS,
  isScreenshotCompressionPreset,
  type AcceptanceSettings,
  type MapleSettings,
  type ScreenshotCompressionPreset,
  type UpdateAcceptanceSettingsRequest,
  type UpdateWorkspaceExecutionSettingsRequest,
  type WorkspaceExecutionSettings
} from "@maple/protocol";
import { touchRevision } from "../database/revision";
import { nowIso } from "../lib/time";

const BACKGROUND_SCREENSHOT_KEY = "acceptance.background_playwright_screenshot";
const SCREENSHOT_COMPRESSION_PRESET_KEY = "acceptance.screenshot_compression_preset";
const BASE_WORKER_KEY = "execution.base_worker";
const AI_OUTPUT_LANGUAGE_KEY = "execution.ai_output_language";
const CONSTITUTION_KEY = "execution.constitution";
const RETRY_INTERVAL_SECONDS_KEY = "execution.retry_interval_seconds";
const RETRY_MAX_ATTEMPTS_KEY = "execution.retry_max_attempts";

const DEFAULT_VALUES: ReadonlyArray<readonly [string, string]> = [
  [BACKGROUND_SCREENSHOT_KEY, "false"],
  [SCREENSHOT_COMPRESSION_PRESET_KEY, DEFAULT_SCREENSHOT_COMPRESSION_PRESET],
  [BASE_WORKER_KEY, DEFAULT_WORKSPACE_EXECUTION_SETTINGS.baseWorker],
  [AI_OUTPUT_LANGUAGE_KEY, DEFAULT_WORKSPACE_EXECUTION_SETTINGS.aiOutputLanguage],
  [CONSTITUTION_KEY, DEFAULT_WORKSPACE_EXECUTION_SETTINGS.constitution],
  [RETRY_INTERVAL_SECONDS_KEY, String(DEFAULT_WORKSPACE_EXECUTION_SETTINGS.retryIntervalSeconds)],
  [RETRY_MAX_ATTEMPTS_KEY, String(DEFAULT_WORKSPACE_EXECUTION_SETTINGS.retryMaxAttempts)]
];

function parseCompressionPreset(value: string | undefined): ScreenshotCompressionPreset {
  return isScreenshotCompressionPreset(value) ? value : DEFAULT_SCREENSHOT_COMPRESSION_PRESET;
}

function parseBoundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export class SettingsRepository {
  constructor(private readonly database: Database) {}

  get(workspaceId: string): MapleSettings {
    return {
      acceptance: this.getAcceptance(workspaceId),
      execution: this.getExecution(workspaceId)
    };
  }

  getAcceptance(workspaceId: string): AcceptanceSettings {
    const values = this.readValues(workspaceId, [BACKGROUND_SCREENSHOT_KEY, SCREENSHOT_COMPRESSION_PRESET_KEY]);
    return {
      backgroundPlaywrightScreenshot: values.get(BACKGROUND_SCREENSHOT_KEY) === "true",
      screenshotCompressionPreset: parseCompressionPreset(values.get(SCREENSHOT_COMPRESSION_PRESET_KEY))
    };
  }

  getExecution(workspaceId: string): WorkspaceExecutionSettings {
    const values = this.readValues(workspaceId, [
      BASE_WORKER_KEY,
      AI_OUTPUT_LANGUAGE_KEY,
      CONSTITUTION_KEY,
      RETRY_INTERVAL_SECONDS_KEY,
      RETRY_MAX_ATTEMPTS_KEY
    ]);
    const baseWorker = values.get(BASE_WORKER_KEY);
    const aiOutputLanguage = values.get(AI_OUTPUT_LANGUAGE_KEY);
    return {
      baseWorker: baseWorker && (WORKER_KINDS as readonly string[]).includes(baseWorker)
        ? baseWorker as WorkspaceExecutionSettings["baseWorker"]
        : DEFAULT_WORKSPACE_EXECUTION_SETTINGS.baseWorker,
      aiOutputLanguage: aiOutputLanguage && (AI_OUTPUT_LANGUAGES as readonly string[]).includes(aiOutputLanguage)
        ? aiOutputLanguage as WorkspaceExecutionSettings["aiOutputLanguage"]
        : DEFAULT_WORKSPACE_EXECUTION_SETTINGS.aiOutputLanguage,
      constitution: values.get(CONSTITUTION_KEY) ?? DEFAULT_WORKSPACE_EXECUTION_SETTINGS.constitution,
      retryIntervalSeconds: parseBoundedInteger(
        values.get(RETRY_INTERVAL_SECONDS_KEY),
        DEFAULT_WORKSPACE_EXECUTION_SETTINGS.retryIntervalSeconds,
        1,
        600
      ),
      retryMaxAttempts: parseBoundedInteger(
        values.get(RETRY_MAX_ATTEMPTS_KEY),
        DEFAULT_WORKSPACE_EXECUTION_SETTINGS.retryMaxAttempts,
        1,
        20
      )
    };
  }

  seedDefaults(workspaceId: string): void {
    const updatedAt = nowIso();
    const insert = this.database.query(
      "INSERT OR IGNORE INTO workspace_settings(workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?)"
    );
    let changed = 0;
    for (const [key, value] of DEFAULT_VALUES) {
      changed += insert.run(workspaceId, key, value, updatedAt).changes;
    }
    if (changed > 0) touchRevision(this.database);
  }

  copyMissing(sourceWorkspaceId: string, targetWorkspaceId: string): number {
    const result = this.database.run(
      `INSERT OR IGNORE INTO workspace_settings(workspace_id, key, value, updated_at)
       SELECT ?, key, value, updated_at FROM workspace_settings WHERE workspace_id = ?`,
      [targetWorkspaceId, sourceWorkspaceId]
    );
    if (result.changes > 0) touchRevision(this.database);
    return result.changes;
  }

  updateAcceptance(input: UpdateAcceptanceSettingsRequest, workspaceId: string): AcceptanceSettings {
    return this.database.transaction(() => {
      const current = this.getAcceptance(workspaceId);
      const next: Required<AcceptanceSettings> = {
        backgroundPlaywrightScreenshot:
          input.backgroundPlaywrightScreenshot ?? current.backgroundPlaywrightScreenshot,
        screenshotCompressionPreset:
          input.screenshotCompressionPreset
          ?? current.screenshotCompressionPreset
          ?? DEFAULT_SCREENSHOT_COMPRESSION_PRESET
      };
      const writes: Array<readonly [string, string]> = [];
      if (current.backgroundPlaywrightScreenshot !== next.backgroundPlaywrightScreenshot) {
        writes.push([BACKGROUND_SCREENSHOT_KEY, next.backgroundPlaywrightScreenshot ? "true" : "false"]);
      }
      if (current.screenshotCompressionPreset !== next.screenshotCompressionPreset) {
        writes.push([SCREENSHOT_COMPRESSION_PRESET_KEY, next.screenshotCompressionPreset]);
      }
      this.writeValues(workspaceId, writes);
      return next;
    }).immediate();
  }

  updateExecution(
    input: UpdateWorkspaceExecutionSettingsRequest,
    workspaceId: string
  ): WorkspaceExecutionSettings {
    return this.database.transaction(() => {
      const current = this.getExecution(workspaceId);
      const next: WorkspaceExecutionSettings = {
        baseWorker: input.baseWorker ?? current.baseWorker,
        aiOutputLanguage: input.aiOutputLanguage ?? current.aiOutputLanguage,
        constitution: input.constitution === undefined
          ? current.constitution
          : input.constitution.replace(/\r\n/g, "\n").slice(0, 100_000),
        retryIntervalSeconds: input.retryIntervalSeconds === undefined
          ? current.retryIntervalSeconds
          : clampInteger(input.retryIntervalSeconds, 1, 600),
        retryMaxAttempts: input.retryMaxAttempts === undefined
          ? current.retryMaxAttempts
          : clampInteger(input.retryMaxAttempts, 1, 20)
      };
      const writes: Array<readonly [string, string]> = [];
      if (current.baseWorker !== next.baseWorker) writes.push([BASE_WORKER_KEY, next.baseWorker]);
      if (current.aiOutputLanguage !== next.aiOutputLanguage) {
        writes.push([AI_OUTPUT_LANGUAGE_KEY, next.aiOutputLanguage]);
      }
      if (current.constitution !== next.constitution) writes.push([CONSTITUTION_KEY, next.constitution]);
      if (current.retryIntervalSeconds !== next.retryIntervalSeconds) {
        writes.push([RETRY_INTERVAL_SECONDS_KEY, String(next.retryIntervalSeconds)]);
      }
      if (current.retryMaxAttempts !== next.retryMaxAttempts) {
        writes.push([RETRY_MAX_ATTEMPTS_KEY, String(next.retryMaxAttempts)]);
      }
      this.writeValues(workspaceId, writes);
      return next;
    }).immediate();
  }

  private readValues(workspaceId: string, keys: string[]): Map<string, string> {
    if (keys.length === 0) return new Map();
    const placeholders = keys.map(() => "?").join(", ");
    const rows = this.database
      .query(`SELECT key, value FROM workspace_settings WHERE workspace_id = ? AND key IN (${placeholders})`)
      .all(workspaceId, ...keys) as Array<{ key: string; value: string }>;
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  private writeValues(workspaceId: string, values: ReadonlyArray<readonly [string, string]>): void {
    if (values.length === 0) return;
    const updatedAt = nowIso();
    const write = this.database.query(
      `INSERT INTO workspace_settings(workspace_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    for (const [key, value] of values) write.run(workspaceId, key, value, updatedAt);
    touchRevision(this.database);
  }
}

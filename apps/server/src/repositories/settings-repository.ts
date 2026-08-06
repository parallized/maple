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
  type WorkerKind,
  type WorkspaceExecutionSettings
} from "@maple/protocol";
import { touchRevision } from "../database/revision";
import { nowIso } from "../lib/time";

const BACKGROUND_SCREENSHOT_KEY = "acceptance.background_playwright_screenshot";
const SCREENSHOT_COMPRESSION_PRESET_KEY = "acceptance.screenshot_compression_preset";
const DEFAULT_WORKER_KEY = "execution.default_worker";
const LEADER_WORKER_KEY = "execution.leader_worker";
const BASE_WORKER_KEY = "execution.base_worker";
const AI_OUTPUT_LANGUAGE_KEY = "execution.ai_output_language";
const CONSTITUTION_KEY = "execution.constitution";
const LEADER_CONSTITUTION_KEY = "execution.leader_constitution";
const CONCURRENCY_KEY = "execution.concurrency";
const RETRY_INTERVAL_SECONDS_KEY = "execution.retry_interval_seconds";
const RETRY_MAX_ATTEMPTS_KEY = "execution.retry_max_attempts";
const REMINDER_AUDIO_NAME_KEY = "reminder.audio_name";
const REMINDER_AUDIO_MIME_KEY = "reminder.audio_mime";
const REMINDER_PLAY_CLI_KEY = "reminder.play_cli";
const REMINDER_PLAY_MAPLE_KEY = "reminder.play_maple";

const DEFAULT_VALUES: ReadonlyArray<readonly [string, string]> = [
  [BACKGROUND_SCREENSHOT_KEY, "false"],
  [SCREENSHOT_COMPRESSION_PRESET_KEY, DEFAULT_SCREENSHOT_COMPRESSION_PRESET],
  [BASE_WORKER_KEY, DEFAULT_WORKSPACE_EXECUTION_SETTINGS.baseWorker],
  [AI_OUTPUT_LANGUAGE_KEY, DEFAULT_WORKSPACE_EXECUTION_SETTINGS.aiOutputLanguage],
  [CONSTITUTION_KEY, DEFAULT_WORKSPACE_EXECUTION_SETTINGS.constitution],
  [LEADER_CONSTITUTION_KEY, DEFAULT_WORKSPACE_EXECUTION_SETTINGS.leaderConstitution],
  [CONCURRENCY_KEY, String(DEFAULT_WORKSPACE_EXECUTION_SETTINGS.concurrency)],
  [RETRY_INTERVAL_SECONDS_KEY, String(DEFAULT_WORKSPACE_EXECUTION_SETTINGS.retryIntervalSeconds)],
  [RETRY_MAX_ATTEMPTS_KEY, String(DEFAULT_WORKSPACE_EXECUTION_SETTINGS.retryMaxAttempts)]
];

function parseCompressionPreset(value: string | undefined): ScreenshotCompressionPreset {
  return isScreenshotCompressionPreset(value) ? value : DEFAULT_SCREENSHOT_COMPRESSION_PRESET;
}

function parseWorker(
  value: string | undefined,
  fallback: WorkspaceExecutionSettings["defaultWorker"]
): WorkspaceExecutionSettings["defaultWorker"] {
  return value && (WORKER_KINDS as readonly string[]).includes(value)
    ? value as WorkspaceExecutionSettings["defaultWorker"]
    : fallback;
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
      DEFAULT_WORKER_KEY,
      LEADER_WORKER_KEY,
      BASE_WORKER_KEY,
      AI_OUTPUT_LANGUAGE_KEY,
      CONSTITUTION_KEY,
      LEADER_CONSTITUTION_KEY,
      CONCURRENCY_KEY,
      RETRY_INTERVAL_SECONDS_KEY,
      RETRY_MAX_ATTEMPTS_KEY,
      REMINDER_AUDIO_NAME_KEY,
      REMINDER_AUDIO_MIME_KEY,
      REMINDER_PLAY_CLI_KEY,
      REMINDER_PLAY_MAPLE_KEY
    ]);
    const legacyWorker = parseWorker(
      values.get(BASE_WORKER_KEY),
      DEFAULT_WORKSPACE_EXECUTION_SETTINGS.defaultWorker
    );
    const defaultWorker = parseWorker(values.get(DEFAULT_WORKER_KEY), legacyWorker);
    const leaderWorker = parseWorker(values.get(LEADER_WORKER_KEY), legacyWorker);
    const aiOutputLanguage = values.get(AI_OUTPUT_LANGUAGE_KEY);
    return {
      defaultWorker,
      leaderWorker,
      baseWorker: defaultWorker,
      aiOutputLanguage: aiOutputLanguage && (AI_OUTPUT_LANGUAGES as readonly string[]).includes(aiOutputLanguage)
        ? aiOutputLanguage as WorkspaceExecutionSettings["aiOutputLanguage"]
        : DEFAULT_WORKSPACE_EXECUTION_SETTINGS.aiOutputLanguage,
      constitution: values.get(CONSTITUTION_KEY) ?? DEFAULT_WORKSPACE_EXECUTION_SETTINGS.constitution,
      leaderConstitution: values.get(LEADER_CONSTITUTION_KEY) ?? DEFAULT_WORKSPACE_EXECUTION_SETTINGS.leaderConstitution,
      concurrency: parseBoundedInteger(
        values.get(CONCURRENCY_KEY),
        DEFAULT_WORKSPACE_EXECUTION_SETTINGS.concurrency,
        1,
        16
      ),
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
      ),
      reminderAudioName: values.get(REMINDER_AUDIO_NAME_KEY) || null,
      reminderAudioMime: values.get(REMINDER_AUDIO_MIME_KEY) || null,
      reminderPlayCli: values.get(REMINDER_PLAY_CLI_KEY) === "true",
      reminderPlayMaple: values.get(REMINDER_PLAY_MAPLE_KEY) === "true"
    };
  }

  /**
   * 工作区执行设置在单个执行端上的生效版本：执行端若配置了模型覆盖，
   * 则用覆盖值替换 defaultWorker / leaderWorker，其余设置沿用工作区默认。
   */
  getExecutionForRunner(
    workspaceId: string,
    overrides: { defaultWorker: WorkerKind | null; leaderWorker: WorkerKind | null }
  ): WorkspaceExecutionSettings {
    const base = this.getExecution(workspaceId);
    const defaultWorker = overrides.defaultWorker ?? base.defaultWorker;
    const leaderWorker = overrides.leaderWorker ?? base.leaderWorker;
    return {
      ...base,
      defaultWorker,
      baseWorker: defaultWorker,
      leaderWorker
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
    const legacyWorker = parseWorker(
      (this.database
        .query("SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?")
        .get(workspaceId, BASE_WORKER_KEY) as { value: string } | null)?.value,
      DEFAULT_WORKSPACE_EXECUTION_SETTINGS.defaultWorker
    );
    changed += insert.run(workspaceId, DEFAULT_WORKER_KEY, legacyWorker, updatedAt).changes;
    changed += insert.run(workspaceId, LEADER_WORKER_KEY, legacyWorker, updatedAt).changes;
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
      const hasExplicitWorkerFields = input.defaultWorker !== undefined || input.leaderWorker !== undefined;
      const defaultWorker = input.defaultWorker ?? input.baseWorker ?? current.defaultWorker;
      const leaderWorker = input.leaderWorker
        ?? (!hasExplicitWorkerFields ? input.baseWorker : undefined)
        ?? current.leaderWorker;
      const next: WorkspaceExecutionSettings = {
        defaultWorker,
        leaderWorker,
        baseWorker: defaultWorker,
        aiOutputLanguage: input.aiOutputLanguage ?? current.aiOutputLanguage,
        constitution: input.constitution === undefined
          ? current.constitution
          : input.constitution.replace(/\r\n/g, "\n").slice(0, 100_000),
        leaderConstitution: input.leaderConstitution === undefined
          ? current.leaderConstitution
          : input.leaderConstitution.replace(/\r\n/g, "\n").slice(0, 100_000),
        concurrency: input.concurrency === undefined
          ? current.concurrency
          : clampInteger(input.concurrency, 1, 16),
        retryIntervalSeconds: input.retryIntervalSeconds === undefined
          ? current.retryIntervalSeconds
          : clampInteger(input.retryIntervalSeconds, 1, 600),
        retryMaxAttempts: input.retryMaxAttempts === undefined
          ? current.retryMaxAttempts
          : clampInteger(input.retryMaxAttempts, 1, 20),
        reminderAudioName: input.reminderAudioName === undefined
          ? current.reminderAudioName
          : input.reminderAudioName,
        reminderAudioMime: input.reminderAudioMime === undefined
          ? current.reminderAudioMime
          : input.reminderAudioMime,
        reminderPlayCli: input.reminderPlayCli ?? current.reminderPlayCli,
        reminderPlayMaple: input.reminderPlayMaple ?? current.reminderPlayMaple
      };
      const writes: Array<readonly [string, string]> = [];
      if (input.defaultWorker !== undefined || input.leaderWorker !== undefined || input.baseWorker !== undefined) {
        writes.push(
          [DEFAULT_WORKER_KEY, next.defaultWorker],
          [LEADER_WORKER_KEY, next.leaderWorker],
          [BASE_WORKER_KEY, next.defaultWorker]
        );
      }
      if (current.aiOutputLanguage !== next.aiOutputLanguage) {
        writes.push([AI_OUTPUT_LANGUAGE_KEY, next.aiOutputLanguage]);
      }
      if (current.constitution !== next.constitution) writes.push([CONSTITUTION_KEY, next.constitution]);
      if (current.leaderConstitution !== next.leaderConstitution) writes.push([LEADER_CONSTITUTION_KEY, next.leaderConstitution]);
      if (current.concurrency !== next.concurrency) {
        writes.push([CONCURRENCY_KEY, String(next.concurrency)]);
      }
      if (current.retryIntervalSeconds !== next.retryIntervalSeconds) {
        writes.push([RETRY_INTERVAL_SECONDS_KEY, String(next.retryIntervalSeconds)]);
      }
      if (current.retryMaxAttempts !== next.retryMaxAttempts) {
        writes.push([RETRY_MAX_ATTEMPTS_KEY, String(next.retryMaxAttempts)]);
      }
      if (current.reminderAudioName !== next.reminderAudioName) {
        writes.push([REMINDER_AUDIO_NAME_KEY, next.reminderAudioName ?? ""]);
      }
      if (current.reminderAudioMime !== next.reminderAudioMime) {
        writes.push([REMINDER_AUDIO_MIME_KEY, next.reminderAudioMime ?? ""]);
      }
      if (current.reminderPlayCli !== next.reminderPlayCli) {
        writes.push([REMINDER_PLAY_CLI_KEY, String(next.reminderPlayCli)]);
      }
      if (current.reminderPlayMaple !== next.reminderPlayMaple) {
        writes.push([REMINDER_PLAY_MAPLE_KEY, String(next.reminderPlayMaple)]);
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

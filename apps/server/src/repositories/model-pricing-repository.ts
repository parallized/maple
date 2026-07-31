import type { Database } from "bun:sqlite";
import type {
  ModelPricingEntry,
  ModelPricingResponse,
  ModelPricingSyncStatus
} from "@maple/protocol";
import { touchRevision } from "../database/revision";

export const DEFAULT_MODEL_PRICING_SOURCE_URL = "https://models.dev/api.json";

export interface ParsedModelPricingEntry {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  inputUsdPerMillion: number | null;
  reasoningUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  inputAudioUsdPerMillion: number | null;
  outputAudioUsdPerMillion: number | null;
  cost: Record<string, unknown>;
  lastUpdated: string | null;
}

export interface ModelPricingSnapshot {
  entries: ParsedModelPricingEntry[];
  providerCount: number;
  modelCount: number;
  pricedModelCount: number;
  fetchedAt: string;
  etag: string | null;
  lastModified: string | null;
}

export interface ModelPricingListOptions {
  providerId?: string;
  modelId?: string;
  limit: number;
  offset: number;
  enabled?: boolean;
}

interface SyncRow {
  source_url: string;
  etag: string | null;
  last_modified: string | null;
  last_attempt_at: string | null;
  last_success_at: string | null;
  fetched_at: string | null;
  last_error: string | null;
  provider_count: number;
  model_count: number;
  priced_model_count: number;
}

interface PricingRow {
  provider_id: string;
  provider_name: string;
  model_id: string;
  model_name: string;
  input_usd_per_million: number | null;
  reasoning_usd_per_million: number | null;
  output_usd_per_million: number | null;
  cache_read_usd_per_million: number | null;
  cache_write_usd_per_million: number | null;
  input_audio_usd_per_million: number | null;
  output_audio_usd_per_million: number | null;
  cost_json: string;
  last_updated: string | null;
  fetched_at: string;
}

/** SQLite access for the server-wide models.dev pricing snapshot. */
export class ModelPricingRepository {
  constructor(private readonly database: Database) {}

  configureSource(sourceUrl: string): void {
    const current = this.database
      .query("SELECT source_url FROM model_pricing_sync WHERE id = 1")
      .get() as { source_url: string } | null;
    if (!current) {
      this.database.run("INSERT OR IGNORE INTO model_pricing_sync(id, source_url) VALUES (1, ?)", [sourceUrl]);
      return;
    }
    if (current.source_url === sourceUrl) {
      this.database.run("UPDATE model_pricing_sync SET source_url = ? WHERE id = 1", [sourceUrl]);
      return;
    }
    // Validators and freshness metadata belong to the source URL. Never send an
    // ETag from one catalog to another, and do not expose the old catalog as if it
    // came from the newly configured source.
    this.database.transaction(() => {
      this.database.run("DELETE FROM model_pricing");
      this.database.run(
        `UPDATE model_pricing_sync
         SET source_url = ?, etag = NULL, last_modified = NULL,
             last_attempt_at = NULL, last_success_at = NULL, fetched_at = NULL,
             last_error = NULL, provider_count = 0, model_count = 0,
             priced_model_count = 0, lock_until = NULL
         WHERE id = 1`,
        [sourceUrl]
      );
      touchRevision(this.database);
    }).immediate();
  }

  status(enabled = false): ModelPricingSyncStatus {
    const row = this.readSyncRow();
    return {
      sourceUrl: row.source_url,
      etag: row.etag,
      lastModified: row.last_modified,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      fetchedAt: row.fetched_at,
      lastError: row.last_error,
      providerCount: row.provider_count,
      modelCount: row.model_count,
      pricedModelCount: row.priced_model_count,
      enabled
    };
  }

  list(options: ModelPricingListOptions): ModelPricingResponse {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (options.providerId) {
      conditions.push("provider_id = ?");
      parameters.push(options.providerId);
    }
    if (options.modelId) {
      conditions.push("model_id = ?");
      parameters.push(options.modelId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = this.database
      .query(`SELECT COUNT(*) AS count FROM model_pricing ${where}`)
      .get(...parameters) as { count: number };
    const rows = this.database
      .query(
        `SELECT provider_id, provider_name, model_id, model_name,
                input_usd_per_million, reasoning_usd_per_million, output_usd_per_million,
                cache_read_usd_per_million, cache_write_usd_per_million,
                input_audio_usd_per_million, output_audio_usd_per_million,
                cost_json, last_updated, fetched_at
         FROM model_pricing
         ${where}
         ORDER BY provider_id, model_id
         LIMIT ? OFFSET ?`
      )
      .all(...parameters, options.limit, options.offset) as PricingRow[];
    return {
      items: rows.map(toEntry),
      total: Number(totalRow?.count ?? 0),
      limit: options.limit,
      offset: options.offset,
      status: this.status(options.enabled ?? false)
    };
  }

  /** Acquire a short database lease so multiple Server processes do not fetch concurrently. */
  tryAcquireSyncLease(sourceUrl: string, now: string, leaseSeconds: number): boolean {
    const leaseUntil = new Date(Date.parse(now) + leaseSeconds * 1_000).toISOString();
    this.database.run("UPDATE model_pricing_sync SET source_url = ? WHERE id = 1", [sourceUrl]);
    const result = this.database.run(
      `UPDATE model_pricing_sync
       SET lock_until = ?, last_attempt_at = ?, last_error = NULL
       WHERE id = 1 AND (lock_until IS NULL OR lock_until <= ?)`,
      [leaseUntil, now, now]
    );
    return result.changes > 0;
  }

  replaceSnapshot(snapshot: ModelPricingSnapshot): void {
    this.database.transaction(() => {
      this.database.run("DELETE FROM model_pricing");
      const insert = this.database.query(
        `INSERT INTO model_pricing(
           provider_id, provider_name, model_id, model_name,
           input_usd_per_million, reasoning_usd_per_million, output_usd_per_million,
           cache_read_usd_per_million, cache_write_usd_per_million,
           input_audio_usd_per_million, output_audio_usd_per_million,
           cost_json, last_updated, fetched_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const entry of snapshot.entries) {
        insert.run(
          entry.providerId,
          entry.providerName,
          entry.modelId,
          entry.modelName,
          entry.inputUsdPerMillion,
          entry.reasoningUsdPerMillion,
          entry.outputUsdPerMillion,
          entry.cacheReadUsdPerMillion,
          entry.cacheWriteUsdPerMillion,
          entry.inputAudioUsdPerMillion,
          entry.outputAudioUsdPerMillion,
          JSON.stringify(entry.cost),
          entry.lastUpdated,
          snapshot.fetchedAt
        );
      }
      this.database.run(
        `UPDATE model_pricing_sync
         SET etag = ?, last_modified = ?, fetched_at = ?, last_success_at = ?,
             last_error = NULL, provider_count = ?, model_count = ?, priced_model_count = ?,
             lock_until = NULL
         WHERE id = 1`,
        [
          snapshot.etag,
          snapshot.lastModified,
          snapshot.fetchedAt,
          snapshot.fetchedAt,
          snapshot.providerCount,
          snapshot.modelCount,
          snapshot.pricedModelCount
        ]
      );
      touchRevision(this.database);
    }).immediate();
  }

  markNotModified(fetchedAt: string, etag: string | null, lastModified: string | null): void {
    this.database.run(
      `UPDATE model_pricing_sync
       SET etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified),
           fetched_at = ?, last_success_at = ?, last_error = NULL, lock_until = NULL
       WHERE id = 1`,
      [etag, lastModified, fetchedAt, fetchedAt]
    );
  }

  markFailure(message: string): void {
    this.database.run(
      "UPDATE model_pricing_sync SET last_error = ?, lock_until = NULL WHERE id = 1",
      [message.slice(0, 500)]
    );
  }

  private readSyncRow(): SyncRow {
    const row = this.database.query(
      `SELECT source_url, etag, last_modified, last_attempt_at, last_success_at,
              fetched_at, last_error, provider_count, model_count, priced_model_count
       FROM model_pricing_sync WHERE id = 1`
    ).get() as SyncRow | null;
    if (row) return row;
    // The schema seeds this row; keeping this fallback makes the repository safe on hand-created legacy DBs.
    this.database.run(
      "INSERT OR IGNORE INTO model_pricing_sync(id, source_url) VALUES (1, ?)",
      [DEFAULT_MODEL_PRICING_SOURCE_URL]
    );
    return this.database.query(
      `SELECT source_url, etag, last_modified, last_attempt_at, last_success_at,
              fetched_at, last_error, provider_count, model_count, priced_model_count
       FROM model_pricing_sync WHERE id = 1`
    ).get() as SyncRow;
  }
}

function toEntry(row: PricingRow): ModelPricingEntry {
  let cost: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.cost_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      cost = parsed as Record<string, unknown>;
    }
  } catch {
    // A malformed local row should not make the entire price endpoint fail.
  }
  return {
    providerId: row.provider_id,
    providerName: row.provider_name,
    modelId: row.model_id,
    modelName: row.model_name,
    inputUsdPerMillion: row.input_usd_per_million,
    reasoningUsdPerMillion: row.reasoning_usd_per_million,
    outputUsdPerMillion: row.output_usd_per_million,
    cacheReadUsdPerMillion: row.cache_read_usd_per_million,
    cacheWriteUsdPerMillion: row.cache_write_usd_per_million,
    inputAudioUsdPerMillion: row.input_audio_usd_per_million,
    outputAudioUsdPerMillion: row.output_audio_usd_per_million,
    cost,
    lastUpdated: row.last_updated,
    fetchedAt: row.fetched_at
  };
}

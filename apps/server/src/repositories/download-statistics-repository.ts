import type { Database } from "bun:sqlite";
import { hashSecret } from "../lib/crypto";
import { nowIso } from "../lib/time";

const EVENT_RETENTION_DAYS = 7;
const NETWORK_WINDOW_SECONDS = 60 * 60;
const NETWORK_EVENT_LIMIT = 20;

export const INSTALL_SH_SOURCE = "install-sh";

export class DownloadRateLimitError extends Error {
  constructor() {
    super("Too many installer events from this network.");
    this.name = "DownloadRateLimitError";
  }
}

interface DownloadCountRow {
  version: string;
  count: number;
}

export interface RecordDownloadResult {
  counted: boolean;
  count: number;
}

/** Persists aggregate counters while retaining short-lived event IDs for idempotency and abuse control. */
export class DownloadStatisticsRepository {
  constructor(private readonly database: Database) {}

  countsByVersion(source = INSTALL_SH_SOURCE): Map<string, number> {
    const rows = this.database
      .query("SELECT version, count FROM release_download_counts WHERE source = ?")
      .all(source) as DownloadCountRow[];
    return new Map(rows.map((row) => [row.version, row.count]));
  }

  total(source = INSTALL_SH_SOURCE): number {
    const row = this.database
      .query("SELECT COALESCE(SUM(count), 0) AS count FROM release_download_counts WHERE source = ?")
      .get(source) as { count: number };
    return row.count;
  }

  record(version: string, eventId: string, networkIdentity: string, source = INSTALL_SH_SOURCE): RecordDownloadResult {
    const eventHash = hashSecret(`${source}:${eventId}`);
    const networkHash = hashSecret(`download-network:${networkIdentity}`);
    const now = nowIso();
    const windowStart = new Date(Date.now() - NETWORK_WINDOW_SECONDS * 1_000).toISOString();
    const retentionStart = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();

    return this.database.transaction(() => {
      const duplicate = this.database
        .query("SELECT 1 AS present FROM release_download_events WHERE event_hash = ?")
        .get(eventHash) as { present: number } | null;
      if (duplicate) return { counted: false, count: this.total(source) };

      const recent = this.database
        .query(
          `SELECT COUNT(*) AS count
           FROM release_download_events
           WHERE source = ? AND network_hash = ? AND created_at >= ?`
        )
        .get(source, networkHash, windowStart) as { count: number };
      if (recent.count >= NETWORK_EVENT_LIMIT) throw new DownloadRateLimitError();

      this.database.run(
        `INSERT INTO release_download_events(event_hash, source, network_hash, created_at)
         VALUES (?, ?, ?, ?)`,
        [eventHash, source, networkHash, now]
      );
      this.database.run(
        `INSERT INTO release_download_counts(version, source, count, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(version, source) DO UPDATE SET
           count = count + 1,
           updated_at = excluded.updated_at`,
        [version, source, now]
      );
      this.database.run("DELETE FROM release_download_events WHERE created_at < ?", [retentionStart]);
      return { counted: true, count: this.total(source) };
    }).immediate();
  }
}


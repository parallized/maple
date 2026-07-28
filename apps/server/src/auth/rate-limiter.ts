import type { Database } from "bun:sqlite";
import { hashSecret } from "../lib/crypto";
import { nowIso } from "../lib/time";
import { HttpError } from "../http/responses";

interface AttemptRow {
  count: number;
  oldest: string | null;
}

export class PersistentRateLimiter {
  constructor(private readonly database: Database) {}

  assertAllowed(scope: string, key: string, limit: number, windowSeconds: number): void {
    const now = Date.now();
    const since = new Date(now - windowSeconds * 1_000).toISOString();
    const keyHash = hashSecret(`${scope}:${key}`);
    const row = this.database
      .query(
        `SELECT COUNT(*) AS count, MIN(created_at) AS oldest
         FROM auth_attempts
         WHERE scope = ? AND key_hash = ? AND succeeded = 0 AND created_at >= ?`
      )
      .get(scope, keyHash, since) as AttemptRow;
    if (row.count < limit) return;
    const oldest = row.oldest ? Date.parse(row.oldest) : now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowSeconds * 1_000 - now) / 1_000));
    throw new HttpError(429, "rate_limited", "尝试次数过多，请稍后再试。", {
      "retry-after": String(retryAfter)
    });
  }

  reserve(scope: string, key: string, limit: number, windowSeconds: number): number {
    return this.database.transaction(() => {
      this.assertAllowed(scope, key, limit, windowSeconds);
      const result = this.database.run(
        "INSERT INTO auth_attempts(scope, key_hash, succeeded, created_at) VALUES (?, ?, 0, ?)",
        [scope, hashSecret(`${scope}:${key}`), nowIso()]
      );
      return Number(result.lastInsertRowid);
    }).immediate();
  }

  settle(attemptId: number, succeeded: boolean): void {
    if (!succeeded) return;
    this.database.run("UPDATE auth_attempts SET succeeded = 1 WHERE id = ?", [attemptId]);
  }

  record(scope: string, key: string, succeeded: boolean): void {
    this.database.run(
      "INSERT INTO auth_attempts(scope, key_hash, succeeded, created_at) VALUES (?, ?, ?, ?)",
      [scope, hashSecret(`${scope}:${key}`), succeeded ? 1 : 0, nowIso()]
    );
    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
      this.database.run("DELETE FROM auth_attempts WHERE created_at < ?", [cutoff]);
    }
  }
}

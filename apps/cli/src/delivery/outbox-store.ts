import { Database } from "bun:sqlite";
import type { RunnerAttemptReference, RunnerAttemptScope } from "@maple/protocol";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type OutboxMessageKind =
  | "start"
  | "log"
  | "artifact"
  | "completion"
  | "manager_complete"
  | "manager_block";

export type OutboxAttemptState = "active" | "completed" | "superseded";

export interface StoredOutboxAttempt {
  attempt_id: string;
  scope: RunnerAttemptScope;
  todo_id: string;
  lease_token: string;
  lease_seconds: number;
  state: OutboxAttemptState;
}

export interface StoredOutboxMessage {
  id: string;
  attempt_id: string;
  position: number;
  kind: OutboxMessageKind;
  payload_json: string;
  file_path: string | null;
  retry_count: number;
  available_at: number;
}

export interface StoredOutboxAttemptInput extends RunnerAttemptReference {
  leaseSeconds: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox_attempts (
  attempt_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('execution', 'project_manager')),
  todo_id TEXT NOT NULL,
  lease_token TEXT NOT NULL,
  lease_seconds INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'completed', 'superseded')),
  next_position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox_messages (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES outbox_attempts(attempt_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'start', 'log', 'artifact', 'completion', 'manager_complete', 'manager_block'
  )),
  payload_json TEXT NOT NULL,
  file_path TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(attempt_id, position)
);

CREATE INDEX IF NOT EXISTS idx_outbox_messages_lane
  ON outbox_messages(attempt_id, position);
`;

export class OutboxStore {
  private readonly database: Database;

  constructor(path: string) {
    const resolvedPath = resolve(path);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.database = new Database(resolvedPath, { create: true, strict: true });
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA busy_timeout = 5000;");
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.database.exec(SCHEMA);
    const columns = this.database.query("PRAGMA table_info(outbox_attempts)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "state")) {
      this.database.exec("ALTER TABLE outbox_attempts ADD COLUMN state TEXT NOT NULL DEFAULT 'active'");
    }
    try {
      chmodSync(resolvedPath, 0o600);
    } catch {
      // Windows keeps this database inside the current user's Maple home.
    }
  }

  close(): void {
    this.database.close();
  }

  registerAttempt(input: StoredOutboxAttemptInput, now: number): void {
    const existing = this.attempt(input.attemptId);
    if (existing) {
      if (
        existing.scope !== input.scope
        || existing.todo_id !== input.todoId
        || existing.lease_token !== input.leaseToken
      ) {
        throw new Error(`本地回传队列的任务标识冲突：${input.attemptId}`);
      }
      this.database.run(
        "UPDATE outbox_attempts SET lease_seconds = ?, updated_at = ? WHERE attempt_id = ?",
        [input.leaseSeconds, now, input.attemptId]
      );
      return;
    }
    this.database.run(
      `INSERT INTO outbox_attempts(
         attempt_id, scope, todo_id, lease_token, lease_seconds, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.attemptId, input.scope, input.todoId, input.leaseToken, input.leaseSeconds, now, now]
    );
  }

  enqueue(
    attemptId: string,
    id: string,
    kind: OutboxMessageKind,
    payloadJson: string,
    filePath: string | null,
    now: number
  ): void {
    const enqueue = this.database.transaction(() => {
      if (!this.attempt(attemptId)) throw new Error(`本地回传队列中不存在该任务：${attemptId}`);
      const position = (this.database
        .query("SELECT next_position FROM outbox_attempts WHERE attempt_id = ?")
        .get(attemptId) as { next_position: number }).next_position;
      this.database.run(
        `INSERT INTO outbox_messages(
           id, attempt_id, position, kind, payload_json, file_path, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, attemptId, position, kind, payloadJson, filePath, now]
      );
      this.database.run(
        "UPDATE outbox_attempts SET next_position = ?, updated_at = ? WHERE attempt_id = ?",
        [position + 1, now, attemptId]
      );
    });
    enqueue.immediate();
  }

  references(): RunnerAttemptReference[] {
    return (this.database
      .query("SELECT * FROM outbox_attempts ORDER BY created_at, attempt_id")
      .all() as StoredOutboxAttempt[]).map((row) => ({
      scope: row.scope,
      todoId: row.todo_id,
      attemptId: row.attempt_id,
      leaseToken: row.lease_token
    }));
  }

  attempt(attemptId: string): StoredOutboxAttempt | null {
    return this.database
      .query("SELECT * FROM outbox_attempts WHERE attempt_id = ?")
      .get(attemptId) as StoredOutboxAttempt | null;
  }

  hasTerminalMessage(attemptId: string): boolean {
    return Boolean(this.database
      .query(
        `SELECT 1 FROM outbox_messages
         WHERE attempt_id = ? AND kind IN ('completion', 'manager_complete', 'manager_block')
         LIMIT 1`
      )
      .get(attemptId));
  }

  pendingMessageCount(attemptId?: string): number {
    const row = attemptId
      ? this.database.query("SELECT COUNT(*) AS count FROM outbox_messages WHERE attempt_id = ?").get(attemptId)
      : this.database.query("SELECT COUNT(*) AS count FROM outbox_messages").get();
    return (row as { count: number }).count;
  }

  markActive(attemptId: string, leaseSeconds: number, now: number): void {
    this.database.run(
      `UPDATE outbox_attempts
       SET lease_seconds = ?, state = 'active', updated_at = ?
       WHERE attempt_id = ?`,
      [leaseSeconds, now, attemptId]
    );
    this.database.run("UPDATE outbox_messages SET available_at = 0 WHERE attempt_id = ?", [attemptId]);
  }

  markTerminal(attemptId: string, state: Exclude<OutboxAttemptState, "active">, now: number): void {
    this.database.run("UPDATE outbox_attempts SET state = ?, updated_at = ? WHERE attempt_id = ?", [
      state,
      now,
      attemptId
    ]);
  }

  artifactPaths(attemptId: string): string[] {
    return (this.database
      .query("SELECT file_path FROM outbox_messages WHERE attempt_id = ? AND file_path IS NOT NULL")
      .all(attemptId) as Array<{ file_path: string }>).map((row) => row.file_path);
  }

  deleteAttempt(attemptId: string): void {
    this.database.run("DELETE FROM outbox_attempts WHERE attempt_id = ?", [attemptId]);
  }

  laneIds(): string[] {
    return (this.database
      .query("SELECT DISTINCT attempt_id FROM outbox_messages ORDER BY attempt_id")
      .all() as Array<{ attempt_id: string }>).map((row) => row.attempt_id);
  }

  head(attemptId: string): StoredOutboxMessage | null {
    return this.database
      .query("SELECT * FROM outbox_messages WHERE attempt_id = ? ORDER BY position LIMIT 1")
      .get(attemptId) as StoredOutboxMessage | null;
  }

  contiguousLogs(attemptId: string): StoredOutboxMessage[] {
    const candidates = this.database
      .query("SELECT * FROM outbox_messages WHERE attempt_id = ? ORDER BY position LIMIT 100")
      .all(attemptId) as StoredOutboxMessage[];
    const logs: StoredOutboxMessage[] = [];
    for (const candidate of candidates) {
      if (candidate.kind !== "log") break;
      logs.push(candidate);
    }
    return logs;
  }

  acknowledge(attemptId: string, messages: StoredOutboxMessage[], terminal: boolean): void {
    const acknowledge = this.database.transaction(() => {
      for (const message of messages) this.database.run("DELETE FROM outbox_messages WHERE id = ?", [message.id]);
      if (terminal) this.database.run("DELETE FROM outbox_attempts WHERE attempt_id = ?", [attemptId]);
    });
    acknowledge.immediate();
  }

  defer(messages: StoredOutboxMessage[], availableAt: number, error: string): void {
    const defer = this.database.transaction(() => {
      for (const message of messages) {
        this.database.run(
          `UPDATE outbox_messages
           SET retry_count = retry_count + 1, available_at = ?, last_error = ?
           WHERE id = ?`,
          [availableAt, error.slice(0, 4_000), message.id]
        );
      }
    });
    defer.immediate();
  }
}

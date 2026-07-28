import type { Database } from "bun:sqlite";
import type {
  ClaimRunnerCommandResponse,
  CompleteRunnerCommandRequest,
  CreateRunnerCommandRequest,
  RunnerCommand
} from "@maple/protocol";
import { touchRevision } from "../database/revision";
import type { RunnerCommandRow } from "../database/rows";
import { toRunnerCommand } from "../database/rows";
import { createSecret, hashSecret } from "../lib/crypto";
import { addSeconds, nowIso } from "../lib/time";

const COMMAND_COLUMNS = `
  id, runner_id, type, status, result_project_id, result_binding_id,
  error, created_at, updated_at, expires_at, claimed_at, completed_at
`;

export class RunnerCommandRepository {
  constructor(private readonly database: Database) {}

  create(runnerId: string, input: CreateRunnerCommandRequest, ttlSeconds: number): RunnerCommand {
    const create = this.database.transaction(() => {
      const now = nowIso();
      const expired = this.expire(now);
      const active = this.database
        .query(
          `SELECT ${COMMAND_COLUMNS} FROM runner_commands
           WHERE runner_id = ? AND type = ? AND status IN ('pending', 'claimed')
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(runnerId, input.type) as RunnerCommandRow | null;
      if (active) {
        if (expired > 0) touchRevision(this.database);
        return toRunnerCommand(active);
      }

      const id = crypto.randomUUID();
      this.database.run(
        `INSERT INTO runner_commands(
           id, runner_id, type, status, created_at, updated_at, expires_at
         ) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        [id, runnerId, input.type, now, now, addSeconds(now, ttlSeconds)]
      );
      touchRevision(this.database);
      const command = this.read(id);
      if (!command) throw new Error("执行端命令创建失败");
      return command;
    });
    return create.immediate();
  }

  get(commandId: string): RunnerCommand | null {
    this.expireAndTouch();
    return this.read(commandId);
  }

  listByRunner(runnerId: string, limit = 20): RunnerCommand[] {
    this.expireAndTouch();
    const rows = this.database
      .query(
        `SELECT ${COMMAND_COLUMNS} FROM runner_commands
         WHERE runner_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(runnerId, limit) as RunnerCommandRow[];
    return rows.map(toRunnerCommand);
  }

  claim(runnerId: string): ClaimRunnerCommandResponse {
    const claim = this.database.transaction((): ClaimRunnerCommandResponse => {
      const now = nowIso();
      const expired = this.expire(now);
      const candidate = this.database
        .query(
          `SELECT ${COMMAND_COLUMNS} FROM runner_commands
           WHERE runner_id = ? AND status = 'pending' AND expires_at > ?
           ORDER BY created_at ASC LIMIT 1`
        )
        .get(runnerId, now) as RunnerCommandRow | null;
      if (!candidate) {
        if (expired > 0) touchRevision(this.database);
        return { command: null, leaseToken: null, retryAfterMs: 1_500 };
      }

      const leaseToken = createSecret();
      const updated = this.database.run(
        `UPDATE runner_commands
         SET status = 'claimed', lease_token_hash = ?, lease_expires_at = expires_at,
             claimed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
        [hashSecret(leaseToken), now, now, candidate.id]
      );
      if (updated.changes !== 1) return { command: null, leaseToken: null, retryAfterMs: 250 };
      touchRevision(this.database);
      const command = this.read(candidate.id);
      if (!command) throw new Error("执行端命令领取失败");
      return { command, leaseToken, retryAfterMs: 0 };
    });
    return claim.immediate();
  }

  complete(runnerId: string, commandId: string, input: CompleteRunnerCommandRequest): RunnerCommand | null {
    const complete = this.database.transaction(() => {
      const now = nowIso();
      const expired = this.expire(now);
      const claimed = this.database
        .query(
          `SELECT id FROM runner_commands
           WHERE id = ? AND runner_id = ? AND status = 'claimed'
             AND lease_token_hash = ? AND lease_expires_at > ?`
        )
        .get(commandId, runnerId, hashSecret(input.leaseToken), now) as { id: string } | null;
      if (!claimed) {
        if (expired > 0) touchRevision(this.database);
        return null;
      }

      let projectId: string | null = null;
      let bindingId: string | null = null;
      let error: string | null = null;
      if (input.outcome === "succeeded") {
        if (!input.projectId || !input.bindingId) return null;
        const binding = this.database
          .query(
            `SELECT id FROM project_bindings
             WHERE id = ? AND project_id = ? AND runner_id = ?`
          )
          .get(input.bindingId, input.projectId, runnerId) as { id: string } | null;
        if (!binding) return null;
        projectId = input.projectId;
        bindingId = input.bindingId;
      } else if (input.outcome === "failed") {
        error = input.error?.trim().slice(0, 1_000) || "执行端未能完成目录选择。";
      }

      const status = input.outcome;
      this.database.run(
        `UPDATE runner_commands
         SET status = ?, result_project_id = ?, result_binding_id = ?, error = ?,
             lease_token_hash = NULL, lease_expires_at = NULL,
             completed_at = ?, updated_at = ?
         WHERE id = ?`,
        [status, projectId, bindingId, error, now, now, commandId]
      );
      touchRevision(this.database);
      return this.read(commandId);
    });
    return complete.immediate();
  }

  private read(commandId: string): RunnerCommand | null {
    const row = this.database
      .query(`SELECT ${COMMAND_COLUMNS} FROM runner_commands WHERE id = ?`)
      .get(commandId) as RunnerCommandRow | null;
    return row ? toRunnerCommand(row) : null;
  }

  private expireAndTouch(): void {
    if (this.expire(nowIso()) > 0) touchRevision(this.database);
  }

  private expire(now: string): number {
    return this.database.run(
      `UPDATE runner_commands
       SET status = 'expired', lease_token_hash = NULL, lease_expires_at = NULL,
           completed_at = ?, updated_at = ?
       WHERE status IN ('pending', 'claimed') AND expires_at <= ?`,
      [now, now, now]
    ).changes;
  }
}

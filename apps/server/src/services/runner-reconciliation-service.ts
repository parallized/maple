import type { Database } from "bun:sqlite";
import type {
  RunnerAttemptReconcileResult,
  RunnerAttemptReference
} from "@maple/protocol";
import { touchRevision } from "../database/revision";
import { hashSecret } from "../lib/crypto";
import { addSeconds, nowIso } from "../lib/time";

interface ExecutionAttemptRow {
  todo_id: string;
  runner_id: string;
  state: string;
  active_attempt_id: string | null;
  claimed_by_runner_id: string | null;
  lease_token_hash: string | null;
  lease_expires_at: string | null;
  todo_status: string;
}

interface ManagerAttemptRow {
  todo_id: string;
  attempt_id: string | null;
  state: string;
  manager_runner_id: string | null;
  lease_token_hash: string | null;
  lease_expires_at: string | null;
  completed_at: string | null;
  todo_status: string;
  active_attempt_id: string | null;
}

export class RunnerReconciliationService {
  constructor(
    private readonly database: Database,
    private readonly executionLeaseSeconds: number,
    private readonly managerLeaseSeconds: number
  ) {}

  reconcile(runnerId: string, attempts: RunnerAttemptReference[]): RunnerAttemptReconcileResult[] {
    const now = nowIso();
    let restoredConnection = false;
    const reconcile = this.database.transaction(() => attempts.map((attempt) => {
      const result = attempt.scope === "execution"
        ? this.reconcileExecution(runnerId, attempt, now)
        : this.reconcileManager(runnerId, attempt, now);
      restoredConnection ||= result.restoredConnection;
      return result.value;
    }));
    const results = reconcile.immediate();
    if (restoredConnection) touchRevision(this.database);
    return results;
  }

  private reconcileExecution(
    runnerId: string,
    attempt: RunnerAttemptReference,
    now: string
  ): { value: RunnerAttemptReconcileResult; restoredConnection: boolean } {
    const row = this.database
      .query(
        `SELECT a.todo_id, a.runner_id, a.state,
                t.active_attempt_id, t.claimed_by_runner_id, t.lease_token_hash,
                t.lease_expires_at, t.status AS todo_status
         FROM todo_attempts a
         JOIN todos t ON t.id = a.todo_id
         WHERE a.id = ?`
      )
      .get(attempt.attemptId) as ExecutionAttemptRow | null;
    const value = (state: RunnerAttemptReconcileResult["state"]): RunnerAttemptReconcileResult => ({
      attemptId: attempt.attemptId,
      state,
      leaseSeconds: this.executionLeaseSeconds
    });
    if (!row || row.todo_id !== attempt.todoId || row.runner_id !== runnerId) {
      return { value: value("superseded"), restoredConnection: false };
    }
    if (row.state === "succeeded" || row.state === "failed") {
      return { value: value("completed"), restoredConnection: false };
    }
    if (
      row.active_attempt_id !== attempt.attemptId
      || row.claimed_by_runner_id !== runnerId
      || row.lease_token_hash !== hashSecret(attempt.leaseToken)
      || !["queued", "running"].includes(row.todo_status)
    ) {
      return { value: value("superseded"), restoredConnection: false };
    }
    const restoredConnection = row.lease_expires_at === null || row.lease_expires_at <= now;
    this.database.run("UPDATE todos SET lease_expires_at = ? WHERE id = ?", [
      addSeconds(now, this.executionLeaseSeconds),
      row.todo_id
    ]);
    return { value: value("active"), restoredConnection };
  }

  private reconcileManager(
    runnerId: string,
    attempt: RunnerAttemptReference,
    now: string
  ): { value: RunnerAttemptReconcileResult; restoredConnection: boolean } {
    const row = this.database
      .query(
        `SELECT tr.todo_id, tr.attempt_id, tr.state, tr.manager_runner_id,
                tr.lease_token_hash, tr.lease_expires_at, tr.completed_at,
                t.status AS todo_status, t.active_attempt_id
         FROM todo_routes tr
         JOIN todos t ON t.id = tr.todo_id
         WHERE tr.attempt_id = ?`
      )
      .get(attempt.attemptId) as ManagerAttemptRow | null;
    const value = (state: RunnerAttemptReconcileResult["state"]): RunnerAttemptReconcileResult => ({
      attemptId: attempt.attemptId,
      state,
      leaseSeconds: this.managerLeaseSeconds
    });
    if (
      !row
      || row.todo_id !== attempt.todoId
      || row.manager_runner_id !== runnerId
      || row.attempt_id !== attempt.attemptId
    ) {
      return { value: value("superseded"), restoredConnection: false };
    }
    if (row.state === "routed" && row.completed_at !== null) {
      return { value: value("completed"), restoredConnection: false };
    }
    if (
      row.state !== "claimed"
      || row.lease_token_hash !== hashSecret(attempt.leaseToken)
      || row.todo_status !== "queued"
      || row.active_attempt_id !== null
    ) {
      return { value: value("superseded"), restoredConnection: false };
    }
    const restoredConnection = row.lease_expires_at === null || row.lease_expires_at <= now;
    this.database.run("UPDATE todo_routes SET lease_expires_at = ?, updated_at = ? WHERE todo_id = ?", [
      addSeconds(now, this.managerLeaseSeconds),
      now,
      row.todo_id
    ]);
    return { value: value("active"), restoredConnection };
  }
}

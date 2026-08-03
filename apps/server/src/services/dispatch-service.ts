import type { Database } from "bun:sqlite";
import {
  DEFAULT_SCREENSHOT_COMPRESSION_PRESET,
  isScreenshotCompressionPreset
} from "@maple/protocol";
import type {
  AppendJobLogRequest,
  AppendJobLogsRequest,
  CompleteJobRequest,
  ExecutionJob,
  HeartbeatJobRequest,
  JobMutationResponse,
  ScreenshotCompressionPreset,
  StartJobRequest
} from "@maple/protocol";
import { touchRevision } from "../database/revision";
import { hashSecret, createSecret } from "../lib/crypto";
import { addSeconds, nowIso } from "../lib/time";
import { ProjectRepository } from "../repositories/project-repository";
import { SettingsRepository } from "../repositories/settings-repository";
import { TodoRepository } from "../repositories/todo-repository";
import { ProjectManagerService } from "./project-manager-service";

interface ClaimCandidateRow {
  todo_id: string;
  binding_id: string;
  worker_kind: string;
}

interface LeaseRow {
  active_attempt_id: string;
  lease_expires_at: string;
  background_playwright_screenshot: number;
  screenshot_compression_preset: string;
  retry_interval_seconds: number;
  retry_max_attempts: number;
}

interface ClaimedIdentifiers {
  todoId: string;
  bindingId: string;
  attemptId: string;
  leaseToken: string;
}

export class DispatchService {
  constructor(
    private readonly database: Database,
    private readonly projects: ProjectRepository,
    private readonly todos: TodoRepository,
    private readonly projectManager: ProjectManagerService,
    private readonly settings: SettingsRepository,
    private readonly leaseSeconds: number
  ) {}

  claim(runnerId: string): ExecutionJob | null {
    const runnerWorkspace = this.database
      .query("SELECT workspace_id FROM runners WHERE id = ? AND revoked_at IS NULL")
      .get(runnerId) as { workspace_id: string } | null;
    if (!runnerWorkspace) return null;
    const acceptanceSettings = this.settings.getAcceptance(runnerWorkspace.workspace_id);
    const executionSettings = this.settings.getExecution(runnerWorkspace.workspace_id);
    const claimTransaction = this.database.transaction((): ClaimedIdentifiers | null => {
      const now = nowIso();
      const candidate = this.database
        .query(
          `SELECT t.id AS todo_id, b.id AS binding_id,
                  t.worker_kind AS worker_kind
           FROM todos t
           JOIN project_bindings b ON b.project_id = t.project_id
           LEFT JOIN todo_routes route ON route.todo_id = t.id
           WHERE b.runner_id = ?
             AND (t.retry_after IS NULL OR t.retry_after <= ?)
             AND (
               (route.todo_id IS NULL AND t.status IN ('todo', 'rework'))
               OR (
                 route.state = 'routed'
                 AND route.manager_runner_id = ?
                 AND t.status IN ('todo', 'rework', 'queued')
                 AND t.active_attempt_id IS NULL
               )
             )
             AND (
               route.todo_id IS NULL
               OR route.workflow_id IS NULL
               OR NOT EXISTS (
                 SELECT 1
                 FROM todo_routes sibling_route
                 JOIN todos sibling_todo ON sibling_todo.id = sibling_route.todo_id
                 WHERE sibling_route.workflow_id = route.workflow_id
                   AND sibling_route.todo_id <> route.todo_id
                   AND sibling_todo.status IN ('queued', 'running')
                   AND sibling_todo.active_attempt_id IS NOT NULL
               )
             )
             AND (
               route.todo_id IS NULL
               OR route.workflow_id IS NULL
               OR NOT EXISTS (
                 SELECT 1
                 FROM todo_routes earlier_route
                 JOIN todos earlier_todo ON earlier_todo.id = earlier_route.todo_id
                 WHERE earlier_route.workflow_id = route.workflow_id
                   AND earlier_route.todo_id <> route.todo_id
                   AND earlier_route.state = 'routed'
                   AND earlier_todo.status IN ('todo', 'rework', 'queued')
                   AND earlier_todo.active_attempt_id IS NULL
                   AND (
                     earlier_todo.created_at < t.created_at
                     OR (
                       earlier_todo.created_at = t.created_at
                       AND earlier_todo.rowid < t.rowid
                     )
                   )
               )
             )
           ORDER BY t.priority DESC, t.created_at ASC
           LIMIT 1`
        )
        .get(runnerId, now, runnerId) as ClaimCandidateRow | null;

      if (!candidate) {
        return null;
      }

      const leaseToken = createSecret();
      const attemptId = crypto.randomUUID();
      const leaseExpiresAt = addSeconds(now, this.leaseSeconds);
      const updated = this.database.run(
        `UPDATE todos
         SET status = 'queued', claimed_by_runner_id = ?, active_attempt_id = ?,
             lease_token_hash = ?, lease_expires_at = ?, retry_after = NULL,
             updated_at = ?, last_error = NULL
         WHERE id = ?
           AND (
             status IN ('todo', 'rework')
             OR (status = 'queued' AND active_attempt_id IS NULL)
           )`,
        [runnerId, attemptId, hashSecret(leaseToken), leaseExpiresAt, now, candidate.todo_id]
      );
      if (updated.changes !== 1) return null;

      this.database.run(
        `INSERT INTO todo_attempts(
           id, todo_id, runner_id, worker_kind, state, background_playwright_screenshot,
           screenshot_compression_preset, retry_interval_seconds, retry_max_attempts, created_at
         ) VALUES (?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?)`,
        [
          attemptId,
          candidate.todo_id,
          runnerId,
          candidate.worker_kind,
          acceptanceSettings.backgroundPlaywrightScreenshot ? 1 : 0,
          acceptanceSettings.screenshotCompressionPreset ?? DEFAULT_SCREENSHOT_COMPRESSION_PRESET,
          executionSettings.retryIntervalSeconds,
          executionSettings.retryMaxAttempts,
          now
        ]
      );
      // 执行父任务时，顺带把它底下的子任务全部置为待办，随执行队列一起被领取。
      this.todos.setDescendantsStatus(candidate.todo_id, "todo");
      touchRevision(this.database);
      return {
        todoId: candidate.todo_id,
        bindingId: candidate.binding_id,
        attemptId,
        leaseToken
      };
    });

    const claimed = claimTransaction.immediate();
    if (!claimed) return null;
    const todo = this.todos.get(claimed.todoId);
    const attempt = this.todos.getAttempt(claimed.attemptId);
    const binding = this.projects.getBinding(claimed.bindingId);
    const project = todo ? this.projects.getById(todo.projectId) : null;
    if (!todo || !attempt || !binding || !project) throw new Error("已领取任务的数据不完整");
    const context = this.projectManager.executionContext(claimed.todoId);
    return {
      todo,
      attempt,
      binding,
      project,
      leaseToken: claimed.leaseToken,
      leaseSeconds: this.leaseSeconds,
      acceptanceSettings: attempt.acceptanceSettings ?? acceptanceSettings,
      executionSettings,
      workflow: context.workflow,
      dispatchBrief: context.dispatchBrief,
      managerWorkerKind: context.managerWorkerKind
    };
  }

  start(runnerId: string, todoId: string, input: StartJobRequest): JobMutationResponse | null {
    const mutate = this.database.transaction(() => {
      const lease = this.findLease(runnerId, todoId, input.leaseToken);
      if (!lease) return null;
      const now = nowIso();
      const expiresAt = addSeconds(now, this.leaseSeconds);
      this.database.run(
        `UPDATE todos
         SET status = 'running', lease_expires_at = ?, started_at = COALESCE(started_at, ?), updated_at = ?
         WHERE id = ?`,
        [expiresAt, now, now, todoId]
      );
      this.database.run(
        `UPDATE todo_attempts
         SET state = 'running', started_at = COALESCE(started_at, ?)
         WHERE id = ?`,
        [now, lease.active_attempt_id]
      );
      touchRevision(this.database);
      return this.readMutation(todoId, lease.active_attempt_id);
    });
    return mutate.immediate();
  }

  heartbeat(runnerId: string, todoId: string, input: HeartbeatJobRequest): boolean {
    const lease = this.findLease(runnerId, todoId, input.leaseToken);
    if (!lease) return false;
    const now = nowIso();
    const restoredConnection = lease.lease_expires_at <= now;
    this.database.run("UPDATE todos SET lease_expires_at = ? WHERE id = ?", [
      addSeconds(now, this.leaseSeconds),
      todoId
    ]);
    if (restoredConnection) touchRevision(this.database);
    return true;
  }

  appendLog(runnerId: string, todoId: string, input: AppendJobLogRequest): boolean {
    const lease = this.findLease(runnerId, todoId, input.leaseToken);
    if (!lease) return false;
    this.insertLog(lease.active_attempt_id, input);
    return true;
  }

  appendLogs(runnerId: string, todoId: string, input: AppendJobLogsRequest): number | null {
    const append = this.database.transaction(() => {
      const lease = this.findLease(runnerId, todoId, input.leaseToken);
      if (!lease) return null;
      let accepted = 0;
      for (const log of input.logs) accepted += this.insertLog(lease.active_attempt_id, log);
      return accepted;
    });
    return append.immediate();
  }

  artifactUploadContext(
    runnerId: string,
    todoId: string,
    leaseToken: string
  ): {
    attemptId: string;
    backgroundPlaywrightScreenshot: boolean;
    screenshotCompressionPreset: ScreenshotCompressionPreset;
  } | null {
    const lease = this.findLease(runnerId, todoId, leaseToken);
    if (!lease) return null;
    return {
      attemptId: lease.active_attempt_id,
      backgroundPlaywrightScreenshot: lease.background_playwright_screenshot === 1,
      screenshotCompressionPreset: isScreenshotCompressionPreset(lease.screenshot_compression_preset)
        ? lease.screenshot_compression_preset
        : DEFAULT_SCREENSHOT_COMPRESSION_PRESET
    };
  }

  complete(runnerId: string, todoId: string, input: CompleteJobRequest): JobMutationResponse | null {
    const completeTransaction = this.database.transaction(() => {
      const lease = this.findLease(runnerId, todoId, input.leaseToken);
      if (!lease) return null;
      const now = nowIso();
      const succeeded = input.success;
      const attempts = (this.database
        .query("SELECT COUNT(*) AS count FROM todo_attempts WHERE todo_id = ?")
        .get(todoId) as { count: number }).count;
      const shouldRetry = !succeeded
        && input.failureDisposition !== "blocked"
        && attempts < lease.retry_max_attempts;
      const todoStatus = succeeded ? "review" : shouldRetry ? "todo" : "blocked";
      const attemptState = succeeded ? "succeeded" : "failed";
      const summary = input.summary?.trim() || null;
      const error = input.error?.trim() || null;
      const retryAfter = shouldRetry ? addSeconds(now, lease.retry_interval_seconds) : null;
      this.database.run(
        `UPDATE todo_attempts
         SET state = ?, exit_code = ?, result_summary = ?, error = ?,
             usage_input_tokens = ?, usage_cached_input_tokens = ?,
             usage_output_tokens = ?, usage_reasoning_output_tokens = ?,
             session_id = ?,
             completed_at = ?
         WHERE id = ?`,
        [
          attemptState,
          input.exitCode ?? null,
          summary,
          error,
          input.usage?.inputTokens ?? 0,
          input.usage?.cachedInputTokens ?? 0,
          input.usage?.outputTokens ?? 0,
          input.usage?.reasoningOutputTokens ?? 0,
          input.sessionId?.trim() || null,
          now,
          lease.active_attempt_id
        ]
      );
      this.database.run(
        `UPDATE todos
         SET status = ?, claimed_by_runner_id = NULL, active_attempt_id = NULL,
             lease_token_hash = NULL, lease_expires_at = NULL,
             retry_after = ?, result_summary = ?, last_error = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
        [todoStatus, retryAfter, summary, error, shouldRetry ? null : now, now, todoId]
      );
      if (input.leaderUsage) {
        this.database.run(
          `UPDATE todo_routes
           SET manager_usage_input_tokens = manager_usage_input_tokens + ?,
               manager_usage_cached_input_tokens = manager_usage_cached_input_tokens + ?,
               manager_usage_output_tokens = manager_usage_output_tokens + ?,
               manager_usage_reasoning_output_tokens = manager_usage_reasoning_output_tokens + ?
           WHERE todo_id = ? AND manager_worker_kind IS NOT NULL`,
          [
            input.leaderUsage.inputTokens,
            input.leaderUsage.cachedInputTokens,
            input.leaderUsage.outputTokens,
            input.leaderUsage.reasoningOutputTokens,
            todoId
          ]
        );
      }
      touchRevision(this.database);
      return this.readMutation(todoId, lease.active_attempt_id);
    });
    return completeTransaction.immediate();
  }

  private findLease(runnerId: string, todoId: string, leaseToken: string): LeaseRow | null {
    return this.database
      .query(
        `SELECT t.active_attempt_id, t.lease_expires_at, a.background_playwright_screenshot,
                a.screenshot_compression_preset, a.retry_interval_seconds, a.retry_max_attempts
         FROM todos t
         JOIN todo_attempts a ON a.id = t.active_attempt_id
         WHERE t.id = ? AND t.claimed_by_runner_id = ? AND t.lease_token_hash = ?
           AND t.active_attempt_id IS NOT NULL
           AND t.status IN ('queued', 'running')`
      )
      .get(todoId, runnerId, hashSecret(leaseToken)) as LeaseRow | null;
  }

  private insertLog(
    attemptId: string,
    input: Omit<AppendJobLogRequest, "leaseToken">
  ): number {
    const createdAt = nowIso();
    const occurredAt = input.occurredAt && Number.isFinite(Date.parse(input.occurredAt))
      ? input.occurredAt
      : createdAt;
    return this.database.run(
      `INSERT OR IGNORE INTO todo_logs(
         attempt_id, sequence, occurred_at, stream, kind, level, status, title, content, group_id,
         delivery_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attemptId,
        input.sequence ?? 0,
        occurredAt,
        input.stream,
        input.kind ?? "raw",
        input.level ?? (input.stream === "stderr" ? "error" : "info"),
        input.status ?? null,
        input.title ?? null,
        input.content,
        input.groupId ?? null,
        input.deliveryId ?? null,
        createdAt
      ]
    ).changes;
  }

  private readMutation(todoId: string, attemptId: string): JobMutationResponse {
    const todo = this.todos.get(todoId);
    const attempt = this.todos.getAttempt(attemptId);
    if (!todo || !attempt) throw new Error("任务执行状态读取失败");
    return { todo, attempt };
  }
}

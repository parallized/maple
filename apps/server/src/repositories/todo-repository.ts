import type { Database } from "bun:sqlite";
import type {
  CreateTodoRequest,
  Todo,
  TodoAttempt,
  TodoDetailResponse,
  TodoLog,
  TokenUsageBreakdown,
  UpdateTodoRequest,
  WorkerKind
} from "@maple/protocol";
import { ACTIVE_TODO_STATUSES } from "@maple/protocol";
import { touchRevision } from "../database/revision";
import type { AttemptRow, LogRow, TodoRow } from "../database/rows";
import { toAttempt, toLog, toTodo } from "../database/rows";
import { nowIso } from "../lib/time";

export class TodoRepository {
  constructor(private readonly database: Database) {}

  list(workspaceId?: string): Todo[] {
    const rows = this.database
      .query(
        `SELECT t.*, route.state AS route_state,
                CASE WHEN route.state = 'claimed' THEN route.attempt_id END AS manager_attempt_id,
                CASE WHEN route.state = 'claimed' THEN route.lease_expires_at END AS manager_lease_expires_at
         FROM todos t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN todo_routes route ON route.todo_id = t.id
         ${workspaceId ? "WHERE p.workspace_id = ?" : ""}
         ORDER BY t.priority DESC, t.created_at ASC`
      )
      .all(...(workspaceId ? [workspaceId] : [])) as TodoRow[];
    return rows.map(toTodo);
  }

  listByProject(projectId: string, workspaceId?: string): Todo[] {
    const rows = this.database
      .query(
        `SELECT t.*, route.state AS route_state,
                CASE WHEN route.state = 'claimed' THEN route.attempt_id END AS manager_attempt_id,
                CASE WHEN route.state = 'claimed' THEN route.lease_expires_at END AS manager_lease_expires_at
         FROM todos t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN todo_routes route ON route.todo_id = t.id
         WHERE t.project_id = ?${workspaceId ? " AND p.workspace_id = ?" : ""}
         ORDER BY t.priority DESC, t.created_at ASC`
      )
      .all(...(workspaceId ? [projectId, workspaceId] : [projectId])) as TodoRow[];
    return rows.map(toTodo);
  }

  get(todoId: string, workspaceId?: string): Todo | null {
    const row = this.database
      .query(
        `SELECT t.*, route.state AS route_state,
                CASE WHEN route.state = 'claimed' THEN route.attempt_id END AS manager_attempt_id,
                CASE WHEN route.state = 'claimed' THEN route.lease_expires_at END AS manager_lease_expires_at
         FROM todos t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN todo_routes route ON route.todo_id = t.id
         WHERE t.id = ?${workspaceId ? " AND p.workspace_id = ?" : ""}`
      )
      .get(...(workspaceId ? [todoId, workspaceId] : [todoId])) as TodoRow | null;
    return row ? toTodo(row) : null;
  }

  getAttempt(attemptId: string, workspaceId?: string): TodoAttempt | null {
    const row = this.database
      .query(
        `SELECT a.* FROM todo_attempts a
         JOIN todos t ON t.id = a.todo_id
         JOIN projects p ON p.id = t.project_id
         WHERE a.id = ?${workspaceId ? " AND p.workspace_id = ?" : ""}`
      )
      .get(...(workspaceId ? [attemptId, workspaceId] : [attemptId])) as AttemptRow | null;
    return row ? toAttempt(row) : null;
  }

  detail(todoId: string, workspaceId?: string): Omit<TodoDetailResponse, "artifacts"> | null {
    const todo = this.get(todoId, workspaceId);
    if (!todo) return null;
    const attemptRows = this.database
      .query("SELECT * FROM todo_attempts WHERE todo_id = ? ORDER BY created_at DESC")
      .all(todoId) as AttemptRow[];
    const logRows = this.database
      .query(
        `SELECT l.* FROM todo_logs l
         JOIN todo_attempts a ON a.id = l.attempt_id
         WHERE a.todo_id = ?
         ORDER BY l.id ASC
         LIMIT 5000`
      )
      .all(todoId) as LogRow[];
    return {
      todo,
      attempts: attemptRows.map(toAttempt),
      logs: logRows.map(toLog)
    };
  }

  create(projectId: string, input: CreateTodoRequest, workspaceId?: string): Todo {
    const now = nowIso();
    const id = input.id ?? crypto.randomUUID();
    if (input.id) {
      const existing = this.get(id, workspaceId);
      if (existing) return existing;
      if (workspaceId && this.get(id)) throw new Error("Todo ID 已被其他工作区占用");
    }
    this.database.run(
      `INSERT INTO todos(
         id, project_id, title, details, status, priority, worker_kind, tags_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        projectId,
        input.title.trim(),
        input.details?.trim() ?? "",
        input.status ?? "todo",
        input.priority ?? 0,
        input.workerKind,
        input.tags ? JSON.stringify(input.tags) : null,
        now,
        now
      ]
    );
    touchRevision(this.database);
    const todo = this.get(id);
    if (!todo) throw new Error("Todo 创建失败");
    return todo;
  }

  update(todoId: string, input: UpdateTodoRequest, workspaceId?: string): Todo | null {
    const update = this.database.transaction(() => {
      const current = this.get(todoId, workspaceId);
      if (!current) return null;
      const now = nowIso();

      if (input.status && input.status !== current.status && current.activeAttemptId) {
        this.database.run(
          `UPDATE todo_attempts
           SET state = 'abandoned', error = ?, completed_at = ?
           WHERE id = ? AND state IN ('claimed', 'running')`,
          ["任务状态由看板更新，当前执行租约已撤销。", now, current.activeAttemptId]
        );
      }
      if (input.status && input.status !== current.status) {
        this.database.run(
          `UPDATE todo_routes
           SET state = 'routed', attempt_id = NULL, lease_token_hash = NULL,
               lease_expires_at = NULL, completed_at = ?, updated_at = ?
           WHERE todo_id = ? AND state = 'claimed'`,
          [now, now, todoId]
        );
      }

      const fields: string[] = ["updated_at = ?"];
      const values: Array<string | number | null> = [now];
      if (input.title !== undefined || input.details !== undefined || input.status !== undefined) {
        fields.push("retry_after = NULL");
      }
      if (input.title !== undefined) {
        fields.push("title = ?");
        values.push(input.title.trim());
      }
      if (input.details !== undefined) {
        fields.push("details = ?");
        values.push(input.details.trim());
      }
      if (input.priority !== undefined) {
        fields.push("priority = ?");
        values.push(input.priority);
      }
      if (input.workerKind !== undefined) {
        fields.push("worker_kind = ?");
        values.push(input.workerKind);
      }
      if (input.tags !== undefined) {
        fields.push("tags_json = ?");
        values.push(JSON.stringify(input.tags));
      }
      if (input.detailsDoc !== undefined) {
        fields.push("details_doc = ?");
        values.push(input.detailsDoc);
      }
      if (input.status !== undefined && input.status !== current.status) {
        fields.push("status = ?");
        values.push(input.status);
        fields.push("claimed_by_runner_id = NULL", "active_attempt_id = NULL", "lease_token_hash = NULL", "lease_expires_at = NULL");
        if (["todo", "rework", "draft"].includes(input.status)) {
          fields.push("started_at = NULL", "completed_at = NULL", "last_error = NULL");
          if (input.status !== "draft") fields.push("result_summary = NULL");
        } else if (["review", "done", "blocked", "cancelled"].includes(input.status)) {
          fields.push("completed_at = ?");
          values.push(now);
        }
      }
      values.push(todoId);
      this.database.run(`UPDATE todos SET ${fields.join(", ")} WHERE id = ?`, values);
      touchRevision(this.database);
      return this.get(todoId, workspaceId);
    });

    return update.immediate();
  }

  delete(todoId: string, workspaceId?: string): "deleted" | "active" | "missing" {
    const todo = this.get(todoId, workspaceId);
    if (!todo) return "missing";
    if (ACTIVE_TODO_STATUSES.includes(todo.status as (typeof ACTIVE_TODO_STATUSES)[number])) return "active";
    this.database.run("DELETE FROM todos WHERE id = ?", [todoId]);
    touchRevision(this.database);
    return "deleted";
  }

  /** 按项目 × Worker 类型聚合所有执行尝试的 token 用量，供概览柱状图使用。 */
  sumTokenUsage(workspaceId?: string): TokenUsageBreakdown[] {
    const rows = this.database
      .query(
        `SELECT t.project_id AS projectId, a.worker_kind AS workerKind,
                SUM(a.usage_input_tokens) AS inputTokens,
                SUM(a.usage_cached_input_tokens) AS cachedInputTokens,
                SUM(a.usage_output_tokens) AS outputTokens,
                SUM(a.usage_reasoning_output_tokens) AS reasoningOutputTokens
         FROM todo_attempts a
         JOIN todos t ON t.id = a.todo_id
         JOIN projects p ON p.id = t.project_id
         WHERE a.usage_input_tokens + a.usage_cached_input_tokens
             + a.usage_output_tokens + a.usage_reasoning_output_tokens > 0
           ${workspaceId ? "AND p.workspace_id = ?" : ""}
         GROUP BY t.project_id, a.worker_kind
         ORDER BY t.project_id, a.worker_kind`
      )
      .all(...(workspaceId ? [workspaceId] : [])) as Array<{
        projectId: string;
        workerKind: string;
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      }>;
    return rows.map((row) => ({
      projectId: row.projectId,
      workerKind: row.workerKind as WorkerKind,
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
      reasoningOutputTokens: row.reasoningOutputTokens
    }));
  }
}

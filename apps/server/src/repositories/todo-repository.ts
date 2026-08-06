import type { Database } from "bun:sqlite";
import type {
  CreateTodoRequest,
  Todo,
  TodoAttempt,
  TodoDetailResponse,
  TodoLog,
  TodoReport,
  TodoStatus,
  TokenUsageBreakdown,
  UpdateTodoRequest,
  WorkerKind
} from "@maple/protocol";
import { ACTIVE_TODO_STATUSES } from "@maple/protocol";
import { MAX_TODO_TAGS, normalizeTodoTags } from "@maple/protocol";
import { touchRevision } from "../database/revision";
import type { AttemptRow, LogRow, TodoRow } from "../database/rows";
import { toAttempt, toLog, toTodo } from "../database/rows";
import { nowIso } from "../lib/time";
import { registerTagCatalog } from "../services/tag-catalog-service";

/** 终态：任务已完成一轮执行，退回草稿/待办/待返工视为「返工」。*/
const TERMINAL_TODO_STATUSES = ["review", "done", "blocked", "cancelled"] as const;
/** 返工目标态：从终态退回这些状态时会累计 rework_count。*/
const REWORK_TARGET_STATUSES = ["draft", "todo", "rework"] as const;

function isTerminalTodoStatus(status: TodoStatus): boolean {
  return TERMINAL_TODO_STATUSES.includes(status as (typeof TERMINAL_TODO_STATUSES)[number]);
}

function isReworkTargetStatus(status: TodoStatus): boolean {
  return REWORK_TARGET_STATUSES.includes(status as (typeof REWORK_TARGET_STATUSES)[number]);
}

export class TodoRepository {
  constructor(private readonly database: Database) {}

  list(workspaceId?: string): Todo[] {
    const rows = this.database
      .query(
        `SELECT t.*, route.state AS route_state,
                route.dispatch_brief AS route_dispatch_brief,
                CASE WHEN route.state = 'claimed' THEN route.attempt_id END AS manager_attempt_id,
                CASE WHEN route.state = 'claimed' THEN route.lease_expires_at END AS manager_lease_expires_at,
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM todo_routes sibling_route
                  JOIN todos sibling_todo ON sibling_todo.id = sibling_route.todo_id
                  WHERE sibling_route.workflow_id = route.workflow_id
                    AND sibling_route.todo_id <> t.id
                    AND sibling_todo.status IN ('queued', 'running')
                    AND t.status <> 'running'
                ) THEN 1 ELSE 0 END AS serial_blocked,
                (SELECT a.usage_input_tokens FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.completed_at IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS usage_input_tokens,
                (SELECT a.usage_cached_input_tokens FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.completed_at IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS usage_cached_input_tokens,
                (SELECT a.usage_output_tokens FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.completed_at IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS usage_output_tokens,
                (SELECT a.usage_reasoning_output_tokens FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.completed_at IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS usage_reasoning_output_tokens,
                (SELECT a.session_id FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.session_id IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS session_id
         FROM todos t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN todo_routes route ON route.todo_id = t.id
         ${workspaceId ? "WHERE p.workspace_id = ?" : ""}
         ORDER BY t.priority DESC, t.created_at ASC`
      )
      .all(...(workspaceId ? [workspaceId] : [])) as TodoRow[];
    const todos = rows.map(toTodo);
    this.attachReports(todos);
    return todos;
  }

  listByProject(projectId: string, workspaceId?: string): Todo[] {
    const rows = this.database
      .query(
        `SELECT t.*, route.state AS route_state,
                route.dispatch_brief AS route_dispatch_brief,
                CASE WHEN route.state = 'claimed' THEN route.attempt_id END AS manager_attempt_id,
                CASE WHEN route.state = 'claimed' THEN route.lease_expires_at END AS manager_lease_expires_at,
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM todo_routes sibling_route
                  JOIN todos sibling_todo ON sibling_todo.id = sibling_route.todo_id
                  WHERE sibling_route.workflow_id = route.workflow_id
                    AND sibling_route.todo_id <> t.id
                    AND sibling_todo.status IN ('queued', 'running')
                    AND t.status <> 'running'
                ) THEN 1 ELSE 0 END AS serial_blocked,
                (SELECT a.usage_input_tokens FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.completed_at IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS usage_input_tokens,
                (SELECT a.usage_cached_input_tokens FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.completed_at IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS usage_cached_input_tokens,
                (SELECT a.usage_output_tokens FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.completed_at IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS usage_output_tokens,
                (SELECT a.usage_reasoning_output_tokens FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.completed_at IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS usage_reasoning_output_tokens,
                (SELECT a.session_id FROM todo_attempts a
                   WHERE a.todo_id = t.id AND a.session_id IS NOT NULL
                   ORDER BY a.completed_at DESC LIMIT 1) AS session_id
         FROM todos t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN todo_routes route ON route.todo_id = t.id
         WHERE t.project_id = ?${workspaceId ? " AND p.workspace_id = ?" : ""}
         ORDER BY t.priority DESC, t.created_at ASC`
      )
      .all(...(workspaceId ? [projectId, workspaceId] : [projectId])) as TodoRow[];
    const todos = rows.map(toTodo);
    this.attachReports(todos);
    return todos;
  }

  get(todoId: string, workspaceId?: string): Todo | null {
    const row = this.database
      .query(
        `SELECT t.*, route.state AS route_state,
                route.dispatch_brief AS route_dispatch_brief,
                CASE WHEN route.state = 'claimed' THEN route.attempt_id END AS manager_attempt_id,
                CASE WHEN route.state = 'claimed' THEN route.lease_expires_at END AS manager_lease_expires_at,
                CASE WHEN EXISTS (
                  SELECT 1
                  FROM todo_routes sibling_route
                  JOIN todos sibling_todo ON sibling_todo.id = sibling_route.todo_id
                  WHERE sibling_route.workflow_id = route.workflow_id
                    AND sibling_route.todo_id <> t.id
                    AND sibling_todo.status IN ('queued', 'running')
                    AND t.status <> 'running'
                ) THEN 1 ELSE 0 END AS serial_blocked
         FROM todos t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN todo_routes route ON route.todo_id = t.id
         WHERE t.id = ?${workspaceId ? " AND p.workspace_id = ?" : ""}`
      )
      .get(...(workspaceId ? [todoId, workspaceId] : [todoId])) as TodoRow | null;
    if (!row) return null;
    const todo = toTodo(row);
    this.attachReports([todo]);
    return todo;
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
      todo: this.withReports(todo),
      attempts: attemptRows.map(toAttempt),
      logs: logRows.map(toLog)
    };
  }

  /** 给列表里的每个 Todo 附上历史执行报告（最新在前），数据来自每次 attempt 的总结。 */
  private attachReports(todos: Todo[]): void {
    if (todos.length === 0) return;
    const byId = new Map(todos.map((todo) => [todo.id, todo]));
    const ids = [...byId.keys()];
    const reportsByTodo = new Map<string, TodoReport[]>();
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      const rows = this.database
        .query(
          `SELECT todo_id, id, worker_kind, result_summary, completed_at, created_at
           FROM todo_attempts
           WHERE todo_id IN (${chunk.map(() => "?").join(",")})
             AND result_summary IS NOT NULL
             AND trim(result_summary) <> ''
           ORDER BY completed_at DESC, created_at DESC`
        )
        .all(...chunk) as Array<{
          todo_id: string;
          id: string;
          worker_kind: string;
          result_summary: string;
          completed_at: string | null;
          created_at: string;
        }>;
      for (const row of rows) {
        const report: TodoReport = {
          id: row.id,
          author: row.worker_kind,
          content: row.result_summary,
          createdAt: row.completed_at ?? row.created_at
        };
        const list = reportsByTodo.get(row.todo_id);
        if (list) list.push(report);
        else reportsByTodo.set(row.todo_id, [report]);
      }
    }
    for (const [todoId, todo] of byId) {
      todo.reports = reportsByTodo.get(todoId);
    }
  }

  /** 单个 Todo 附带历史报告（与列表口径一致）。 */
  private withReports(todo: Todo): Todo {
    this.attachReports([todo]);
    return todo;
  }

  create(projectId: string, input: CreateTodoRequest, workspaceId?: string): Todo {
    const now = nowIso();
    const id = input.id ?? crypto.randomUUID();
    if (input.id) {
      const existing = this.get(id, workspaceId);
      if (existing) return existing;
      if (workspaceId && this.get(id)) throw new Error("Todo ID 已被其他工作区占用");
    }
    let parentId: string | null = null;
    if (input.parentId) {
      const parent = this.get(input.parentId, workspaceId);
      if (!parent) throw new Error("父任务不存在");
      if (parent.projectId !== projectId) throw new Error("父任务必须属于同一项目");
      parentId = parent.id;
    }
    this.database.run(
      `INSERT INTO todos(
         id, project_id, title, details, status, parent_id, priority, worker_kind, tags_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        projectId,
        input.title.trim(),
        input.details?.trim() ?? "",
        input.status ?? "todo",
        parentId,
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

      if (input.parentId !== undefined && (input.parentId ?? null) !== (current.parentId ?? null)) {
        const nextParentId = input.parentId ?? null;
        if (nextParentId) {
          const parent = this.get(nextParentId, workspaceId);
          if (!parent) throw new Error("父任务不存在");
          if (parent.projectId !== current.projectId) throw new Error("父任务必须属于同一项目");
          if (nextParentId === current.id) throw new Error("任务不能成为自己的子任务");
          if (this.isDescendantOf(current.id, nextParentId)) {
            throw new Error("不能把任务移动到自己的子任务下");
          }
        }
      }

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
           SET state = 'pending', attempt_id = NULL, lease_token_hash = NULL,
               lease_expires_at = NULL, manager_runner_id = NULL, manager_worker_kind = NULL,
               selected_worker_kind = NULL, dispatch_brief = NULL,
               completed_at = NULL, updated_at = ?
           WHERE todo_id = ? AND state = 'claimed'`,
          [now, todoId]
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
        const nextTags = normalizeTodoTags(input.tags, { max: MAX_TODO_TAGS });
        fields.push("tags_json = ?");
        values.push(JSON.stringify(nextTags));
        // 手动创建/变更的标签同样自动注册进项目标签目录（固定莫兰迪配色 + mingcute 图标）。
        const catalogRow = this.database
          .query("SELECT tag_catalog_json FROM projects WHERE id = ?")
          .get(current.projectId) as { tag_catalog_json: string | null } | null;
        const registered = registerTagCatalog(catalogRow?.tag_catalog_json ?? null, nextTags);
        if (registered.added.length > 0) {
          this.database.run(
            "UPDATE projects SET tag_catalog_json = ?, updated_at = ? WHERE id = ?",
            [registered.json, now, current.projectId]
          );
        }
      }
      if (input.parentId !== undefined && (input.parentId ?? null) !== (current.parentId ?? null)) {
        fields.push("parent_id = ?");
        values.push(input.parentId ?? null);
      }
      if (input.detailsDoc !== undefined) {
        fields.push("details_doc = ?");
        values.push(input.detailsDoc);
      }
      if (input.status !== undefined && input.status !== current.status) {
        fields.push("status = ?");
        values.push(input.status);
        fields.push("claimed_by_runner_id = NULL", "active_attempt_id = NULL", "lease_token_hash = NULL", "lease_expires_at = NULL");
        if (isReworkTargetStatus(input.status)) {
          fields.push("started_at = NULL", "completed_at = NULL", "last_error = NULL");
          if (isTerminalTodoStatus(current.status)) {
            fields.push("rework_count = rework_count + 1");
          }
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

  /** todoId 是否位于 ancestorId 的子任务链上（向上逐级查找父任务，用于环校验）。 */
  isDescendantOf(ancestorId: string, todoId: string): boolean {
    let currentId: string | null = todoId;
    for (let depth = 0; depth < 100; depth++) {
      const row = this.database
        .query("SELECT parent_id FROM todos WHERE id = ?")
        .get(currentId) as { parent_id: string | null } | null;
      if (!row) return false;
      if (row.parent_id === ancestorId) return true;
      if (!row.parent_id) return false;
      currentId = row.parent_id;
    }
    return false;
  }

  /** 直接子任务数量（表格行用于展开箭头与状态调整标注）。 */
  subtaskCount(todoId: string): number {
    const row = this.database
      .query("SELECT COUNT(*) AS count FROM todos WHERE parent_id = ?")
      .get(todoId) as { count: number };
    return row.count;
  }

  private descendantIds(todoId: string, workspaceId?: string): string[] {
    const rows = this.database
      .query(
        `WITH RECURSIVE subtree(id) AS (
           SELECT id FROM todos WHERE parent_id = ?
           UNION ALL
           SELECT t.id FROM todos t JOIN subtree s ON t.parent_id = s.id
         )
         SELECT s.id FROM subtree s
         JOIN todos t ON t.id = s.id
         JOIN projects p ON p.id = t.project_id
         ${workspaceId ? "WHERE p.workspace_id = ?" : ""}`
      )
      .all(...(workspaceId ? [todoId, workspaceId] : [todoId])) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * 把 todo 的所有子孙任务状态整体调整：
   * 执行父任务时置待办；父任务状态变更时让子任务跟随（含放弃进行中的执行租约）。
   */
  setDescendantsStatus(todoId: string, status: TodoStatus, workspaceId?: string): number {
    const descendants = this.descendantIds(todoId, workspaceId);
    if (descendants.length === 0) return 0;
    const now = nowIso();
    const terminal = ["review", "done", "blocked", "cancelled"].includes(status);
    this.database.transaction(() => {
      for (const descendantId of descendants) {
        const current = this.get(descendantId, workspaceId);
        if (!current) continue;
        if (current.activeAttemptId) {
          this.database.run(
            `UPDATE todo_attempts
             SET state = 'abandoned', error = ?, completed_at = ?
             WHERE id = ? AND state IN ('claimed', 'running')`,
            ["父任务状态调整，子任务执行租约已撤销。", now, current.activeAttemptId]
          );
        }
        // 子任务从终态跟随父任务退回草稿/待办/待返工，同样累计一次返工。
        const rework = !terminal && isReworkTargetStatus(status) && isTerminalTodoStatus(current.status);
        this.database.run(
          `UPDATE todos
           SET status = ?, updated_at = ?,
               claimed_by_runner_id = NULL, active_attempt_id = NULL,
               lease_token_hash = NULL, lease_expires_at = NULL,
               started_at = NULL, last_error = NULL, retry_after = NULL,
               completed_at = ?${rework ? ", rework_count = rework_count + 1" : ""}
           WHERE id = ?`,
          [status, now, terminal ? now : null, descendantId]
        );
      }
    }).immediate();
    touchRevision(this.database);
    return descendants.length;
  }

  delete(todoId: string, workspaceId?: string): "deleted" | "active" | "missing" {
    const todo = this.get(todoId, workspaceId);
    if (!todo) return "missing";
    if (ACTIVE_TODO_STATUSES.includes(todo.status as (typeof ACTIVE_TODO_STATUSES)[number])) return "active";
    this.database.run("DELETE FROM todos WHERE id = ?", [todoId]);
    touchRevision(this.database);
    return "deleted";
  }

  /** 按项目、模型与 Maple 角色分别聚合 token 用量。 */
  sumTokenUsage(workspaceId?: string): TokenUsageBreakdown[] {
    const rows = this.database
      .query(
        `SELECT usage.projectId, usage.workerKind, usage.agentRole,
                SUM(usage.inputTokens) AS inputTokens,
                SUM(usage.cachedInputTokens) AS cachedInputTokens,
                SUM(usage.outputTokens) AS outputTokens,
                SUM(usage.reasoningOutputTokens) AS reasoningOutputTokens
         FROM (
           SELECT t.project_id AS projectId, a.worker_kind AS workerKind, 'worker' AS agentRole,
                  a.usage_input_tokens AS inputTokens,
                  a.usage_cached_input_tokens AS cachedInputTokens,
                  a.usage_output_tokens AS outputTokens,
                  a.usage_reasoning_output_tokens AS reasoningOutputTokens
           FROM todo_attempts a
           JOIN todos t ON t.id = a.todo_id

           UNION ALL

           SELECT t.project_id AS projectId, route.manager_worker_kind AS workerKind, 'leader' AS agentRole,
                  route.manager_usage_input_tokens AS inputTokens,
                  route.manager_usage_cached_input_tokens AS cachedInputTokens,
                  route.manager_usage_output_tokens AS outputTokens,
                  route.manager_usage_reasoning_output_tokens AS reasoningOutputTokens
           FROM todo_routes route
           JOIN todos t ON t.id = route.todo_id
           WHERE route.manager_worker_kind IS NOT NULL
         ) usage
         JOIN projects p ON p.id = usage.projectId
         WHERE usage.inputTokens + usage.cachedInputTokens
             + usage.outputTokens + usage.reasoningOutputTokens > 0
           ${workspaceId ? "AND p.workspace_id = ?" : ""}
         GROUP BY usage.projectId, usage.workerKind, usage.agentRole
         ORDER BY usage.projectId, usage.workerKind, usage.agentRole`
      )
      .all(...(workspaceId ? [workspaceId] : [])) as Array<{
        projectId: string;
        workerKind: string;
        agentRole: string;
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        reasoningOutputTokens: number;
      }>;
    return rows.map((row) => ({
      projectId: row.projectId,
      workerKind: row.workerKind as WorkerKind,
      agentRole: row.agentRole === "leader" ? "leader" : "worker",
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
      reasoningOutputTokens: row.reasoningOutputTokens
    }));
  }
}

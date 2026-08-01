import type { Database } from "bun:sqlite";
import {
  CLAIMABLE_TODO_STATUSES,
  type BlockProjectManagerJobRequest,
  type BlockProjectManagerJobResponse,
  type ClaimProjectManagerJobResponse,
  type CompleteProjectManagerJobRequest,
  type CompleteProjectManagerJobResponse,
  type ProjectManagerHistoryItem,
  type ProjectWorkflow,
  type TodoStatus,
  type WorkerKind
} from "@maple/protocol";
import { touchRevision } from "../database/revision";
import { createSecret, hashSecret } from "../lib/crypto";
import { addSeconds, nowIso, subtractSeconds } from "../lib/time";
import { ProjectRepository } from "../repositories/project-repository";
import { RunnerRepository } from "../repositories/runner-repository";
import { TodoRepository } from "../repositories/todo-repository";
import { SettingsRepository } from "../repositories/settings-repository";

interface ManagerCandidateRow {
  todo_id: string;
  project_id: string;
  binding_id: string;
}

interface ClaimedManagerJob extends ManagerCandidateRow {
  attemptId: string;
  leaseToken: string;
}

interface WorkflowRow {
  id: string;
  project_id: string;
  worker_kind: string;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
}

interface ManagerHistoryRow {
  todo_id: string;
  title: string;
  details: string;
  status: string;
  worker_kind: string;
  workflow_id: string | null;
  result_summary: string | null;
  dispatch_brief: string | null;
  updated_at: string;
}

export interface TodoExecutionContext {
  workflow: ProjectWorkflow | null;
  dispatchBrief: string | null;
  managerWorkerKind: WorkerKind | null;
}

function toWorkflow(row: WorkflowRow): ProjectWorkflow {
  return {
    id: row.id,
    projectId: row.project_id,
    workerKind: row.worker_kind as WorkerKind,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ProjectManagerService {
  constructor(
    private readonly database: Database,
    private readonly projects: ProjectRepository,
    private readonly todos: TodoRepository,
    private readonly runners: RunnerRepository,
    private readonly settings: SettingsRepository,
    private readonly leaseSeconds: number,
    private readonly runnerOfflineSeconds: number
  ) {}

  /** 新版 CLI 可用时把 Todo 放入项目经理队列；旧版 CLI 保持原有直接领取行为。 */
  enqueue(todoId: string, force = false): boolean {
    const todo = this.todos.get(todoId);
    if (!todo || !CLAIMABLE_TODO_STATUSES.includes(todo.status as (typeof CLAIMABLE_TODO_STATUSES)[number])) {
      return false;
    }
    const capableBinding = this.database
      .query(
        `SELECT 1
         FROM project_bindings b
         JOIN runners r ON r.id = b.runner_id
         WHERE b.project_id = ?
           AND r.supported_workers IS NOT NULL
           AND r.supported_workers NOT IN ('', '[]')
           AND instr(r.capabilities, '"project_manager_v1"') > 0
         LIMIT 1`
      )
      .get(todo.projectId);
    if (!capableBinding) return false;

    const now = nowIso();
    const inserted = this.database.run(
      `INSERT OR IGNORE INTO todo_routes(todo_id, source_status, state, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?)`,
      [todoId, todo.status, now, now]
    );
    let changed = inserted.changes > 0;
    if (force && inserted.changes === 0) {
      const reset = this.database.run(
        `UPDATE todo_routes
         SET workflow_id = NULL, source_status = ?, state = 'pending', manager_runner_id = NULL,
             manager_worker_kind = NULL, selected_worker_kind = NULL,
             dispatch_brief = NULL,
             attempt_id = NULL, lease_token_hash = NULL, lease_expires_at = NULL,
             completed_at = NULL, updated_at = ?
         WHERE todo_id = ?`,
        [todo.status, now, todoId]
      );
      changed = reset.changes > 0;
    }
    if (changed) touchRevision(this.database);
    return changed;
  }

  claim(runnerId: string): ClaimProjectManagerJobResponse {
    const runner = this.runners.getById(runnerId);
    const availableWorkers = runner?.supportedWorkers ?? [];
    if (
      !runner?.workspaceId
      || !runner.capabilities?.includes("project_manager_v1")
      || availableWorkers.length === 0
    ) {
      return { job: null, retryAfterMs: 1_500 };
    }

    const claim = this.database.transaction((): ClaimedManagerJob | null => {
      const now = nowIso();
      const offlineBefore = subtractSeconds(now, this.runnerOfflineSeconds);
      const candidate = this.database
        .query(
          `SELECT tr.todo_id, t.project_id, b.id AS binding_id
           FROM todo_routes tr
           JOIN todos t ON t.id = tr.todo_id
           JOIN projects p ON p.id = t.project_id
           JOIN project_bindings b ON b.project_id = t.project_id AND b.runner_id = ?
           LEFT JOIN runners manager_runner ON manager_runner.id = p.manager_runner_id
           WHERE tr.state = 'pending'
             AND t.status IN ('todo', 'rework')
             AND NOT EXISTS (
               SELECT 1
               FROM todo_routes active_route
               JOIN todos active_todo ON active_todo.id = active_route.todo_id
               WHERE active_route.state = 'claimed'
                 AND active_todo.project_id = t.project_id
             )
             AND (
               p.manager_runner_id IS NULL
               OR p.manager_runner_id = ?
               OR manager_runner.id IS NULL
               OR manager_runner.last_seen_at < ?
             )
           ORDER BY t.priority DESC, tr.created_at ASC
           LIMIT 1`
        )
        .get(runnerId, runnerId, offlineBefore) as ManagerCandidateRow | null;
      if (!candidate) return null;

      const leaseToken = createSecret();
      const attemptId = crypto.randomUUID();
      const leaseExpiresAt = addSeconds(now, this.leaseSeconds);
      const updated = this.database.run(
        `UPDATE todo_routes
         SET state = 'claimed', manager_runner_id = ?, attempt_id = ?, lease_token_hash = ?,
             lease_expires_at = ?, updated_at = ?
         WHERE todo_id = ? AND state = 'pending'`,
        [runnerId, attemptId, hashSecret(leaseToken), leaseExpiresAt, now, candidate.todo_id]
      );
      if (updated.changes !== 1) return null;
      const queued = this.database.run(
        `UPDATE todos
         SET status = 'queued', updated_at = ?, last_error = NULL
         WHERE id = ? AND status IN ('todo', 'rework') AND active_attempt_id IS NULL`,
        [now, candidate.todo_id]
      );
      if (queued.changes !== 1) {
        throw new Error("项目经理领取任务时无法进入队列状态");
      }
      this.database.run(
        `UPDATE projects
         SET manager_runner_id = ?, manager_updated_at = ?
         WHERE id = ?`,
        [runnerId, now, candidate.project_id]
      );
      touchRevision(this.database);
      return { ...candidate, attemptId, leaseToken };
    }).immediate();

    if (!claim) return { job: null, retryAfterMs: 1_500 };
    const todo = this.todos.get(claim.todo_id);
    const project = this.projects.getById(claim.project_id);
    const binding = this.projects.getBinding(claim.binding_id);
    if (!todo || !project || !binding) throw new Error("项目经理任务的数据不完整");
    return {
      job: {
        todo,
        project,
        binding,
        workflows: this.listWorkflows(project.id),
        history: this.listHistory(project.id, todo.id),
        availableWorkers,
        executionSettings: this.settings.getExecution(runner.workspaceId),
        attemptId: claim.attemptId,
        leaseToken: claim.leaseToken,
        leaseSeconds: this.leaseSeconds
      },
      retryAfterMs: 0
    };
  }

  complete(
    runnerId: string,
    todoId: string,
    input: CompleteProjectManagerJobRequest
  ): CompleteProjectManagerJobResponse | null {
    const runner = this.runners.getById(runnerId);
    const availableWorkers = runner?.supportedWorkers ?? [];
    if (
      !runner
      || !runner.capabilities?.includes("project_manager_v1")
      || !availableWorkers.includes(input.managerWorkerKind)
    ) {
      return null;
    }

    const completed = this.database.transaction(() => {
      const now = nowIso();
      const route = this.database
        .query(
          `SELECT tr.todo_id, t.project_id, t.worker_kind
           FROM todo_routes tr
           JOIN todos t ON t.id = tr.todo_id
           WHERE tr.todo_id = ? AND tr.state = 'claimed'
             AND tr.manager_runner_id = ?
             AND tr.lease_token_hash = ?
             AND (
               t.status IN ('todo', 'rework')
               OR (t.status = 'queued' AND t.active_attempt_id IS NULL)
             )`
        )
        .get(todoId, runnerId, hashSecret(input.leaseToken)) as {
          todo_id: string;
          project_id: string;
          worker_kind: string;
        } | null;
      if (!route) return null;
      if (
        input.selectedWorkerKind !== route.worker_kind
        || !availableWorkers.includes(route.worker_kind as WorkerKind)
      ) {
        return null;
      }

      let workflowId = input.workflowId;
      if (workflowId) {
        const workflow = this.database
          .query("SELECT id, worker_kind FROM project_workflows WHERE id = ? AND project_id = ?")
          .get(workflowId, route.project_id) as Pick<WorkflowRow, "id" | "worker_kind"> | null;
        if (!workflow || workflow.worker_kind !== route.worker_kind) return null;
        this.database.run(
          `UPDATE project_workflows SET title = ?, summary = ?, updated_at = ? WHERE id = ?`,
          [input.workflowTitle.trim(), input.workflowSummary.trim(), now, workflowId]
        );
      } else {
        workflowId = crypto.randomUUID();
        this.database.run(
          `INSERT INTO project_workflows(id, project_id, worker_kind, title, summary, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [workflowId, route.project_id, route.worker_kind, input.workflowTitle.trim(), input.workflowSummary.trim(), now, now]
        );
      }

      this.database.run(
        `UPDATE todo_routes
          SET workflow_id = ?, state = 'routed', manager_worker_kind = ?,
              manager_usage_input_tokens = manager_usage_input_tokens + ?,
              manager_usage_cached_input_tokens = manager_usage_cached_input_tokens + ?,
              manager_usage_output_tokens = manager_usage_output_tokens + ?,
              manager_usage_reasoning_output_tokens = manager_usage_reasoning_output_tokens + ?,
              selected_worker_kind = ?, dispatch_brief = ?,
             lease_token_hash = NULL, lease_expires_at = NULL,
             completed_at = ?, updated_at = ?
         WHERE todo_id = ?`,
        [
          workflowId,
          input.managerWorkerKind,
          input.usage?.inputTokens ?? 0,
          input.usage?.cachedInputTokens ?? 0,
          input.usage?.outputTokens ?? 0,
          input.usage?.reasoningOutputTokens ?? 0,
          input.selectedWorkerKind,
          input.dispatchBrief.trim(),
          now,
          now,
          todoId
        ]
      );
      this.database.run("UPDATE todos SET status = 'queued', updated_at = ? WHERE id = ?", [now, todoId]);
      this.database.run(
        `UPDATE projects SET manager_runner_id = ?, manager_worker_kind = ?, manager_updated_at = ? WHERE id = ?`,
        [runnerId, input.managerWorkerKind, now, route.project_id]
      );
      touchRevision(this.database);
      return { workflowId, projectId: route.project_id };
    }).immediate();

    if (!completed) return null;
    const todo = this.todos.get(todoId);
    const workflow = this.getWorkflow(completed.workflowId);
    if (!todo || !workflow) throw new Error("项目经理派单结果读取失败");
    return {
      todo,
      workflow,
      selectedWorkerKind: input.selectedWorkerKind,
      dispatchBrief: input.dispatchBrief.trim()
    };
  }

  block(
    runnerId: string,
    todoId: string,
    input: BlockProjectManagerJobRequest
  ): BlockProjectManagerJobResponse | null {
    const runner = this.runners.getById(runnerId);
    if (!runner || !runner.capabilities?.includes("project_manager_v1")) return null;

    const blocked = this.database.transaction((): { report: string | null } | null => {
      const now = nowIso();
      const route = this.database
        .query(
          `SELECT tr.todo_id, t.project_id, t.worker_kind
           FROM todo_routes tr
           JOIN todos t ON t.id = tr.todo_id
           WHERE tr.todo_id = ? AND tr.state = 'claimed'
             AND tr.manager_runner_id = ?
             AND tr.lease_token_hash = ?
             AND (
               t.status IN ('todo', 'rework')
               OR (t.status = 'queued' AND t.active_attempt_id IS NULL)
             )`
        )
        .get(todoId, runnerId, hashSecret(input.leaseToken)) as {
          todo_id: string;
          project_id: string;
          worker_kind: string;
        } | null;
      if (!route) return null;

      const report = input.report?.trim() || null;
      const technicalError = input.technicalError?.trim() || null;
      this.database.run(
        `UPDATE todo_routes
          SET state = 'routed', manager_worker_kind = ?, selected_worker_kind = ?,
              manager_usage_input_tokens = manager_usage_input_tokens + ?,
              manager_usage_cached_input_tokens = manager_usage_cached_input_tokens + ?,
              manager_usage_output_tokens = manager_usage_output_tokens + ?,
              manager_usage_reasoning_output_tokens = manager_usage_reasoning_output_tokens + ?,
              lease_token_hash = NULL, lease_expires_at = NULL,
             completed_at = ?, updated_at = ?
         WHERE todo_id = ?`,
        [
          input.managerWorkerKind,
          route.worker_kind,
          input.usage?.inputTokens ?? 0,
          input.usage?.cachedInputTokens ?? 0,
          input.usage?.outputTokens ?? 0,
          input.usage?.reasoningOutputTokens ?? 0,
          now,
          now,
          todoId
        ]
      );
      this.database.run(
        `UPDATE todos
         SET status = 'blocked', claimed_by_runner_id = NULL, active_attempt_id = NULL,
             lease_token_hash = NULL, lease_expires_at = NULL, retry_after = NULL,
             result_summary = ?, last_error = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
        [report, technicalError ?? report, now, now, todoId]
      );
      this.database.run(
        `UPDATE projects SET manager_runner_id = ?, manager_worker_kind = ?, manager_updated_at = ? WHERE id = ?`,
        [runnerId, input.managerWorkerKind, now, route.project_id]
      );
      touchRevision(this.database);
      return { report };
    }).immediate();

    if (!blocked) return null;
    const todo = this.todos.get(todoId);
    if (!todo) throw new Error("项目经理阻塞结果读取失败");
    return { todo, report: blocked.report };
  }

  executionContext(todoId: string): TodoExecutionContext {
    const row = this.database
      .query(
        `SELECT tr.dispatch_brief, tr.manager_worker_kind,
                w.id, w.project_id, w.worker_kind, w.title, w.summary, w.created_at, w.updated_at
         FROM todo_routes tr
         LEFT JOIN project_workflows w ON w.id = tr.workflow_id
         WHERE tr.todo_id = ? AND tr.state = 'routed'`
      )
      .get(todoId) as (WorkflowRow & {
        dispatch_brief: string | null;
        manager_worker_kind: string | null;
      }) | null;
    return {
      workflow: row?.id ? toWorkflow(row) : null,
      dispatchBrief: row?.dispatch_brief ?? null,
      managerWorkerKind: (row?.manager_worker_kind as WorkerKind | null | undefined) ?? null
    };
  }

  private getWorkflow(workflowId: string): ProjectWorkflow | null {
    const row = this.database
      .query("SELECT * FROM project_workflows WHERE id = ?")
      .get(workflowId) as WorkflowRow | null;
    return row ? toWorkflow(row) : null;
  }

  private listWorkflows(projectId: string): ProjectWorkflow[] {
    const rows = this.database
      .query("SELECT * FROM project_workflows WHERE project_id = ? ORDER BY updated_at DESC LIMIT 20")
      .all(projectId) as WorkflowRow[];
    return rows.map(toWorkflow);
  }

  private listHistory(projectId: string, excludeTodoId: string): ProjectManagerHistoryItem[] {
    const rows = this.database
      .query(
        `SELECT t.id AS todo_id, t.title, t.details, t.status, t.worker_kind,
                tr.workflow_id, t.result_summary, tr.dispatch_brief, t.updated_at
         FROM todos t
         LEFT JOIN todo_routes tr ON tr.todo_id = t.id
         WHERE t.project_id = ? AND t.id <> ?
         ORDER BY t.updated_at DESC
         LIMIT 30`
      )
      .all(projectId, excludeTodoId) as ManagerHistoryRow[];
    return rows.map((row) => ({
      todoId: row.todo_id,
      title: row.title,
      details: row.details,
      status: row.status as TodoStatus,
      workerKind: row.worker_kind as WorkerKind,
      workflowId: row.workflow_id,
      resultSummary: row.result_summary,
      dispatchBrief: row.dispatch_brief,
      updatedAt: row.updated_at
    }));
  }

}

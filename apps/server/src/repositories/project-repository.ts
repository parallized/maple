import type { Database } from "bun:sqlite";
import type {
  Project,
  ProjectBinding,
  RegisterProjectRequest,
  RegisterProjectResponse,
  UpdateProjectRequest
} from "@maple/protocol";
import { touchRevision } from "../database/revision";
import type { BindingRow, ProjectRow } from "../database/rows";
import { toBinding, toProject } from "../database/rows";
import { nowIso, subtractSeconds } from "../lib/time";
import { hashSecret } from "../lib/crypto";

export class ProjectRepository {
  constructor(
    private readonly database: Database,
    private readonly runnerOfflineSeconds: number
  ) {}

  register(runnerId: string, input: RegisterProjectRequest): RegisterProjectResponse {
    const register = this.database.transaction(() => {
      const now = nowIso();
      const runner = this.database.query("SELECT workspace_id FROM runners WHERE id = ? AND revoked_at IS NULL").get(runnerId) as
        | { workspace_id: string }
        | null;
      if (!runner) throw new Error("执行端不存在或已撤销");
      const workspaceId = runner.workspace_id;
      const existing = this.database
        .query("SELECT id FROM projects WHERE workspace_id = ? AND workspace_external_key = ?")
        .get(workspaceId, input.externalKey) as
        | { id: string }
        | null;
      const projectId = existing?.id ?? crypto.randomUUID();

      if (existing) {
        this.database.run(
          `UPDATE projects
           SET name = ?, repository_url = ?, default_branch = ?, updated_at = ?
           WHERE id = ?`,
          [input.name, input.repositoryUrl ?? null, input.defaultBranch ?? null, now, projectId]
        );
      } else {
        this.database.run(
          `INSERT INTO projects(
             id, workspace_id, external_key, workspace_external_key, name,
             repository_url, default_branch, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            projectId,
            workspaceId,
            `${workspaceId}:${hashSecret(input.externalKey)}`,
            input.externalKey,
            input.name,
            input.repositoryUrl ?? null,
            input.defaultBranch ?? null,
            now,
            now
          ]
        );
      }

      const existingBinding = this.database
        .query("SELECT id FROM project_bindings WHERE project_id = ? AND runner_id = ?")
        .get(projectId, runnerId) as { id: string } | null;
      const bindingId = existingBinding?.id ?? crypto.randomUUID();
      if (existingBinding) {
        this.database.run(
          `UPDATE project_bindings
           SET workspace_label = ?, git_branch = ?, git_head = ?, last_seen_at = ?, updated_at = ?
           WHERE id = ?`,
          [
            input.workspaceLabel,
            input.gitBranch ?? null,
            input.gitHead ?? null,
            now,
            now,
            bindingId
          ]
        );
      } else {
        this.database.run(
          `INSERT INTO project_bindings(
             id, project_id, runner_id, workspace_label, git_branch, git_head,
             last_seen_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            bindingId,
            projectId,
            runnerId,
            input.workspaceLabel,
            input.gitBranch ?? null,
            input.gitHead ?? null,
            now,
            now,
            now
          ]
        );
      }

      touchRevision(this.database);
      const project = this.getById(projectId, workspaceId);
      const binding = this.getBinding(bindingId);
      if (!project || !binding) throw new Error("项目注册失败");
      return { project, binding };
    });

    return register.immediate();
  }

  list(workspaceId?: string): Project[] {
    const onlineSince = subtractSeconds(nowIso(), this.runnerOfflineSeconds);
    const rows = this.database
      .query(
        `SELECT p.*,
                COUNT(DISTINCT b.id) AS binding_count,
                COUNT(DISTINCT CASE WHEN r.last_seen_at >= ? THEN r.id END) AS online_runner_count
         FROM projects p
         LEFT JOIN project_bindings b ON b.project_id = p.id
         LEFT JOIN runners r ON r.id = b.runner_id
         ${workspaceId ? "WHERE p.workspace_id = ?" : ""}
         GROUP BY p.id
         ORDER BY p.updated_at DESC, p.name COLLATE NOCASE`
      )
      .all(...(workspaceId ? [onlineSince, workspaceId] : [onlineSince])) as ProjectRow[];
    return rows.map(toProject);
  }

  getById(projectId: string, workspaceId?: string): Project | null {
    const onlineSince = subtractSeconds(nowIso(), this.runnerOfflineSeconds);
    const row = this.database
      .query(
        `SELECT p.*,
                COUNT(DISTINCT b.id) AS binding_count,
                COUNT(DISTINCT CASE WHEN r.last_seen_at >= ? THEN r.id END) AS online_runner_count
         FROM projects p
         LEFT JOIN project_bindings b ON b.project_id = p.id
         LEFT JOIN runners r ON r.id = b.runner_id
         WHERE p.id = ?${workspaceId ? " AND p.workspace_id = ?" : ""}
         GROUP BY p.id`
      )
      .get(...(workspaceId ? [onlineSince, projectId, workspaceId] : [onlineSince, projectId])) as ProjectRow | null;
    return row ? toProject(row) : null;
  }

  update(projectId: string, input: UpdateProjectRequest, workspaceId?: string): Project | null {
    const current = this.getById(projectId, workspaceId);
    if (!current) return null;
    this.database.run("UPDATE projects SET tag_catalog_json = ?, updated_at = ? WHERE id = ?", [
      input.tagCatalog ?? null,
      nowIso(),
      projectId
    ]);
    touchRevision(this.database);
    return this.getById(projectId, workspaceId);
  }

  listBindings(workspaceId?: string): ProjectBinding[] {
    const rows = this.database
      .query(
        `SELECT b.id, b.project_id, b.runner_id, r.name AS runner_name, b.workspace_label,
                b.git_branch, b.git_head, b.last_seen_at
         FROM project_bindings b
         JOIN runners r ON r.id = b.runner_id
         JOIN projects p ON p.id = b.project_id
         ${workspaceId ? "WHERE p.workspace_id = ?" : ""}
         ORDER BY b.updated_at DESC`
      )
      .all(...(workspaceId ? [workspaceId] : [])) as BindingRow[];
    return rows.map(toBinding);
  }

  getBinding(bindingId: string, workspaceId?: string): ProjectBinding | null {
    const row = this.database
      .query(
        `SELECT b.id, b.project_id, b.runner_id, r.name AS runner_name, b.workspace_label,
                b.git_branch, b.git_head, b.last_seen_at
         FROM project_bindings b
         JOIN runners r ON r.id = b.runner_id
         JOIN projects p ON p.id = b.project_id
         WHERE b.id = ?${workspaceId ? " AND p.workspace_id = ?" : ""}`
      )
      .get(...(workspaceId ? [bindingId, workspaceId] : [bindingId])) as BindingRow | null;
    return row ? toBinding(row) : null;
  }

  removeBinding(runnerId: string, projectId: string): boolean {
    const result = this.database.run(
      "DELETE FROM project_bindings WHERE runner_id = ? AND project_id = ?",
      [runnerId, projectId]
    );
    if (result.changes > 0) touchRevision(this.database);
    return result.changes > 0;
  }

  remove(projectId: string, workspaceId?: string): boolean {
    const remove = this.database.transaction(() => {
      const result = workspaceId
        ? this.database.run("DELETE FROM projects WHERE id = ? AND workspace_id = ?", [projectId, workspaceId])
        : this.database.run("DELETE FROM projects WHERE id = ?", [projectId]);
      if (result.changes > 0) touchRevision(this.database);
      return result.changes > 0;
    });
    return remove.immediate();
  }
}

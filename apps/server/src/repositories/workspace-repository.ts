import type { Database } from "bun:sqlite";
import type { WorkspaceRole, WorkspaceSummary } from "@maple/protocol";
import { HttpError } from "../http/responses";
import { nowIso } from "../lib/time";
import { SettingsRepository } from "./settings-repository";

interface WorkspaceRow {
  id: string;
  name: string;
  role: string;
  created_at: string;
  updated_at: string;
}

function toWorkspace(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    role: row.role as WorkspaceRole,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class WorkspaceRepository {
  private readonly settings: SettingsRepository;

  constructor(private readonly database: Database) {
    this.settings = new SettingsRepository(database);
  }

  listForUser(userId: string): WorkspaceSummary[] {
    const rows = this.database
      .query(
        `SELECT w.id, w.name, m.role, w.created_at, w.updated_at
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE m.user_id = ?
         ORDER BY w.created_at ASC`
      )
      .all(userId) as WorkspaceRow[];
    return rows.map(toWorkspace);
  }

  getForUser(workspaceId: string, userId: string): WorkspaceSummary | null {
    const row = this.database
      .query(
        `SELECT w.id, w.name, m.role, w.created_at, w.updated_at
         FROM workspace_members m
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE w.id = ? AND m.user_id = ?`
      )
      .get(workspaceId, userId) as WorkspaceRow | null;
    return row ? toWorkspace(row) : null;
  }

  defaultForUser(userId: string): WorkspaceSummary | null {
    const recent = this.database
      .query(
        `SELECT w.id, w.name, m.role, w.created_at, w.updated_at
         FROM web_sessions s
         JOIN workspace_members m ON m.workspace_id = s.active_workspace_id AND m.user_id = s.user_id
         JOIN workspaces w ON w.id = m.workspace_id
         WHERE s.user_id = ?
         ORDER BY s.last_seen_at DESC, s.created_at DESC
         LIMIT 1`
      )
      .get(userId) as WorkspaceRow | null;
    return recent ? toWorkspace(recent) : (this.listForUser(userId)[0] ?? null);
  }

  createForUser(userId: string, name: string): WorkspaceSummary {
    const workspaceName = name.trim();
    if (!workspaceName) throw new HttpError(422, "workspace_name_required", "工作区名称不能为空。");
    const id = crypto.randomUUID();
    const now = nowIso();
    this.database.transaction(() => {
      this.database.run(
        "INSERT INTO workspaces(id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [id, workspaceName, userId, now, now]
      );
      this.database.run(
        "INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
        [id, userId, now]
      );
      this.settings.seedDefaults(id);
    }).immediate();
    const workspace = this.getForUser(id, userId);
    if (!workspace) throw new Error("工作区创建失败");
    return workspace;
  }

  rename(workspaceId: string, userId: string, name: string): WorkspaceSummary {
    const membership = this.getForUser(workspaceId, userId);
    if (!membership) throw new HttpError(404, "workspace_not_found", "工作区不存在。");
    if (membership.role !== "owner") throw new HttpError(403, "owner_required", "只有工作区所有者可以重命名。");
    const nextName = name.trim();
    if (!nextName) throw new HttpError(422, "workspace_name_required", "工作区名称不能为空。");
    this.database.run("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?", [nextName, nowIso(), workspaceId]);
    return this.getForUser(workspaceId, userId)!;
  }
}

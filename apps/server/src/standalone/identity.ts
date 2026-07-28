import type { Database } from "bun:sqlite";
import { hostname } from "node:os";
import { createSecret } from "../lib/crypto";
import { nowIso } from "../lib/time";
import { SettingsRepository } from "../repositories/settings-repository";
import { UserSettingsRepository } from "../repositories/user-settings-repository";

const USER_METADATA_KEY = "standalone.user_id";
const WORKSPACE_METADATA_KEY = "standalone.workspace_id";
const LOCAL_EMAIL = "local@maple.invalid";
// Maple Local 默认以真实本机名作为工作区名与用户名，原样保留大小写。
const LOCAL_HOSTNAME = hostname();

export interface StandaloneIdentity {
  userId: string;
  workspaceId: string;
  workspaceName: string;
}

function readIdentity(database: Database): StandaloneIdentity | null {
  const row = database.query(
    `SELECT user_meta.value AS user_id, workspace_meta.value AS workspace_id, workspaces.name AS workspace_name
     FROM metadata AS user_meta
     JOIN users ON users.id = user_meta.value
     JOIN metadata AS workspace_meta ON workspace_meta.key = ?
     JOIN workspaces ON workspaces.id = workspace_meta.value
     JOIN workspace_members
       ON workspace_members.workspace_id = workspaces.id
      AND workspace_members.user_id = users.id
     WHERE user_meta.key = ?`
  ).get(WORKSPACE_METADATA_KEY, USER_METADATA_KEY) as {
    user_id: string;
    workspace_id: string;
    workspace_name: string;
  } | null;
  return row ? {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name
  } : null;
}

/**
 * Creates the one passwordless local identity used by Maple Local.
 * Random identifiers are persisted in metadata so this is not another global placeholder workspace.
 */
export async function ensureStandaloneIdentity(database: Database): Promise<StandaloneIdentity> {
  const current = readIdentity(database);
  if (current) return current;

  const existingUser = database
    .query("SELECT id FROM users WHERE email = ? COLLATE NOCASE")
    .get(LOCAL_EMAIL) as { id: string } | null;
  const userId = existingUser?.id ?? crypto.randomUUID();
  const existingWorkspace = database.query(
    `SELECT workspaces.id
     FROM workspaces
     JOIN workspace_members ON workspace_members.workspace_id = workspaces.id
     WHERE workspace_members.user_id = ? AND workspace_members.role = 'owner'
     ORDER BY workspaces.created_at ASC
     LIMIT 1`
  ).get(userId) as { id: string } | null;
  const workspaceId = existingWorkspace?.id ?? crypto.randomUUID();
  const passwordHash = existingUser
    ? null
    : await Bun.password.hash(createSecret(48), {
        algorithm: "argon2id",
        memoryCost: 65_536,
        timeCost: 3
      });
  const now = nowIso();

  database.transaction(() => {
    if (!existingUser) {
      database.run(
        "INSERT INTO users(id, email, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [userId, LOCAL_EMAIL, passwordHash, LOCAL_HOSTNAME, now, now]
      );
    }
    if (!existingWorkspace) {
      database.run(
        "INSERT INTO workspaces(id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [workspaceId, LOCAL_HOSTNAME, userId, now, now]
      );
      database.run(
        "INSERT INTO workspace_members(workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
        [workspaceId, userId, now]
      );
    }
    database.run(
      `INSERT INTO metadata(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [USER_METADATA_KEY, userId]
    );
    database.run(
      `INSERT INTO metadata(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [WORKSPACE_METADATA_KEY, workspaceId]
    );
    new UserSettingsRepository(database).seedDefaults(userId);
    new SettingsRepository(database).seedDefaults(workspaceId);
  }).immediate();

  const created = readIdentity(database);
  if (!created) throw new Error("Maple Local 本地身份创建失败。");
  return created;
}

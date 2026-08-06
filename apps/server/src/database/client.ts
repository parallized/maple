import { Database } from "bun:sqlite";
import { WORKER_KINDS } from "@maple/protocol";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_download_counts (
  version TEXT NOT NULL,
  source TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(version, source)
);

CREATE TABLE IF NOT EXISTS release_download_events (
  event_hash TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  network_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_file TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, key)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'member')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, key)
);

CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  csrf_token TEXT,
  csrf_token_hash TEXT NOT NULL,
  trust TEXT NOT NULL CHECK(trust IN ('trusted', 'review')),
  ip_address TEXT NOT NULL,
  network_key TEXT NOT NULL,
  user_agent_hash TEXT NOT NULL,
  device_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  reviewed_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES web_sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
  ip_address TEXT,
  device_label TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  succeeded INTEGER NOT NULL DEFAULT 0 CHECK(succeeded IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_authorizations (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code_hash TEXT NOT NULL UNIQUE,
  code_challenge TEXT NOT NULL,
  runner_name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  supported_workers TEXT NOT NULL DEFAULT '[]',
  worker_inventory TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK(state IN ('pending', 'approved', 'consumed', 'denied')),
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_by_session_id TEXT REFERENCES web_sessions(id) ON DELETE SET NULL,
  runner_id TEXT,
  runner_token_encrypted TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT,
  last_polled_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL UNIQUE,
  workspace_external_key TEXT,
  name TEXT NOT NULL,
  repository_url TEXT,
  default_branch TEXT,
  tag_catalog_json TEXT,
  manager_runner_id TEXT,
  manager_worker_kind TEXT,
  manager_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runners (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hostname TEXT NOT NULL,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  supported_workers TEXT NOT NULL DEFAULT '[]',
  worker_inventory TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  default_worker TEXT,
  leader_worker TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_bindings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  runner_id TEXT NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  workspace_label TEXT NOT NULL,
  git_branch TEXT,
  git_head TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, runner_id)
);

CREATE TABLE IF NOT EXISTS runner_commands (
  id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  lease_token_hash TEXT,
  lease_expires_at TEXT,
  retry_after TEXT,
  result_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  result_binding_id TEXT REFERENCES project_bindings(id) ON DELETE SET NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  parent_id TEXT REFERENCES todos(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  worker_kind TEXT NOT NULL CHECK(worker_kind IN ('codex', 'deepseek', 'claude', 'kimi', 'glm', 'iflow', 'gemini', 'opencode')),
  claimed_by_runner_id TEXT REFERENCES runners(id) ON DELETE SET NULL,
  active_attempt_id TEXT,
  lease_token_hash TEXT,
  lease_expires_at TEXT,
  retry_after TEXT,
  result_summary TEXT,
  last_error TEXT,
  rework_count INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT,
  details_doc TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS todo_attempts (
  id TEXT PRIMARY KEY,
  todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  runner_id TEXT NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  worker_kind TEXT NOT NULL,
  state TEXT NOT NULL,
  exit_code INTEGER,
  result_summary TEXT,
  error TEXT,
  usage_input_tokens INTEGER NOT NULL DEFAULT 0,
  usage_cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  usage_output_tokens INTEGER NOT NULL DEFAULT 0,
  usage_reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  background_playwright_screenshot INTEGER NOT NULL DEFAULT 0 CHECK(background_playwright_screenshot IN (0, 1)),
  screenshot_compression_preset TEXT NOT NULL DEFAULT 'balanced'
    CHECK(screenshot_compression_preset IN ('high', 'balanced', 'compact')),
  retry_interval_seconds INTEGER NOT NULL DEFAULT 10,
  retry_max_attempts INTEGER NOT NULL DEFAULT 5,
  session_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_artifacts (
  id TEXT PRIMARY KEY,
  todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES todo_attempts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('screenshot')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  storage_name TEXT NOT NULL UNIQUE,
  delivery_id TEXT,
  created_at TEXT NOT NULL
);

/* Workspace Provider secrets are encrypted before SQLite sees them. */
CREATE TABLE IF NOT EXISTS provider_credentials (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('deepseek')),
  encrypted_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS todo_assets (
  todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
  storage_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(todo_id, id)
);

CREATE TABLE IF NOT EXISTS todo_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES todo_attempts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT,
  stream TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'raw',
  level TEXT NOT NULL DEFAULT 'info',
  status TEXT,
  title TEXT,
  content TEXT NOT NULL,
  group_id TEXT,
  delivery_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_workflows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  worker_kind TEXT NOT NULL CHECK(worker_kind IN ('codex', 'deepseek', 'claude', 'kimi', 'glm', 'iflow', 'gemini', 'opencode')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_routes (
  todo_id TEXT PRIMARY KEY REFERENCES todos(id) ON DELETE CASCADE,
  workflow_id TEXT REFERENCES project_workflows(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK(state IN ('pending', 'claimed', 'routed')),
  source_status TEXT CHECK(source_status IN ('todo', 'rework')),
  manager_runner_id TEXT REFERENCES runners(id) ON DELETE SET NULL,
  manager_worker_kind TEXT,
  manager_usage_input_tokens INTEGER NOT NULL DEFAULT 0,
  manager_usage_cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  manager_usage_output_tokens INTEGER NOT NULL DEFAULT 0,
  manager_usage_reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  selected_worker_kind TEXT,
  dispatch_brief TEXT,
  attempt_id TEXT,
  lease_token_hash TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

/* Provider/model pricing is a server-wide cache, not workspace data. */
CREATE TABLE IF NOT EXISTS model_pricing (
  provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  input_usd_per_million REAL,
  reasoning_usd_per_million REAL,
  output_usd_per_million REAL,
  cache_read_usd_per_million REAL,
  cache_write_usd_per_million REAL,
  input_audio_usd_per_million REAL,
  output_audio_usd_per_million REAL,
  cost_json TEXT NOT NULL,
  last_updated TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS model_pricing_sync (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  source_url TEXT NOT NULL DEFAULT 'https://models.dev/api.json',
  etag TEXT,
  last_modified TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  fetched_at TEXT,
  last_error TEXT,
  provider_count INTEGER NOT NULL DEFAULT 0,
  model_count INTEGER NOT NULL DEFAULT 0,
  priced_model_count INTEGER NOT NULL DEFAULT 0,
  lock_until TEXT
);

INSERT OR IGNORE INTO model_pricing_sync(id) VALUES (1);

CREATE INDEX IF NOT EXISTS idx_bindings_runner ON project_bindings(runner_id);
CREATE INDEX IF NOT EXISTS idx_bindings_project ON project_bindings(project_id);
CREATE INDEX IF NOT EXISTS idx_runner_commands_claim ON runner_commands(runner_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_runner_commands_expiry ON runner_commands(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runner_commands_active_picker
  ON runner_commands(runner_id, type)
  WHERE status IN ('pending', 'claimed');
CREATE INDEX IF NOT EXISTS idx_todos_project_status ON todos(project_id, status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_todos_lease ON todos(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_attempts_todo ON todo_attempts(todo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_runner ON todo_attempts(runner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_attempt ON todo_logs(attempt_id, id);
CREATE INDEX IF NOT EXISTS idx_artifacts_todo ON todo_artifacts(todo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_attempt ON todo_artifacts(attempt_id, created_at);
CREATE INDEX IF NOT EXISTS idx_todo_assets_todo ON todo_assets(todo_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflows_project ON project_workflows(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_routes_state ON todo_routes(state, created_at);
CREATE INDEX IF NOT EXISTS idx_todo_routes_workflow ON todo_routes(workflow_id, state);
CREATE INDEX IF NOT EXISTS idx_model_pricing_provider ON model_pricing(provider_id, model_name);
CREATE INDEX IF NOT EXISTS idx_model_pricing_model ON model_pricing(model_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON web_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON web_sessions(active_workspace_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_provider_credentials_workspace ON provider_credentials(workspace_id);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_lookup ON auth_attempts(scope, key_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_authorizations_expiry ON device_authorizations(state, expires_at);
CREATE INDEX IF NOT EXISTS idx_release_download_events_network
  ON release_download_events(source, network_hash, created_at DESC);

INSERT OR IGNORE INTO metadata(key, value) VALUES ('revision', '0');
`;

export function createDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path, { create: true, strict: true });
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL;");
  database.exec(SCHEMA);
  migrate(database);
  return database;
}

function migrate(database: Database): void {
  migrateTodoWorker(database);
  ensureColumn(database, "todo_attempts", "session_id", "TEXT");
  ensureColumn(database, "todos", "tags_json", "TEXT");
  ensureColumn(database, "todos", "details_doc", "TEXT");
  ensureColumn(database, "todos", "parent_id", "TEXT REFERENCES todos(id) ON DELETE CASCADE");
  ensureColumn(database, "todos", "retry_after", "TEXT");
  ensureColumn(database, "todos", "rework_count", "INTEGER NOT NULL DEFAULT 0");
  migrateTodoWorkerConstraint(database);
  ensureTodoWorkerInvariant(database);
  migrateProjectWorkflowWorker(database);
  ensureProjectWorkflowWorkerInvariant(database);
  ensureColumn(database, "projects", "tag_catalog_json", "TEXT");
  ensureColumn(database, "projects", "workspace_id", "TEXT");
  ensureColumn(database, "projects", "workspace_external_key", "TEXT");
  ensureColumn(database, "projects", "manager_runner_id", "TEXT");
  ensureColumn(database, "projects", "manager_worker_kind", "TEXT");
  ensureColumn(database, "projects", "manager_updated_at", "TEXT");
  ensureColumn(database, "runners", "supported_workers", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "runners", "workspace_id", "TEXT");
  ensureColumn(database, "runners", "revoked_at", "TEXT");
  ensureColumn(database, "runners", "worker_inventory", "TEXT");
  ensureColumn(database, "runners", "capabilities", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(database, "runners", "default_worker", "TEXT");
  ensureColumn(database, "runners", "leader_worker", "TEXT");
  ensureColumn(database, "pairing_codes", "workspace_id", "TEXT");
  ensureColumn(database, "todo_logs", "sequence", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_logs", "occurred_at", "TEXT");
  ensureColumn(database, "todo_logs", "kind", "TEXT NOT NULL DEFAULT 'raw'");
  ensureColumn(database, "todo_logs", "level", "TEXT NOT NULL DEFAULT 'info'");
  ensureColumn(database, "todo_logs", "status", "TEXT");
  ensureColumn(database, "todo_logs", "title", "TEXT");
  ensureColumn(database, "todo_logs", "group_id", "TEXT");
  ensureColumn(database, "todo_logs", "delivery_id", "TEXT");
  ensureColumn(database, "todo_artifacts", "delivery_id", "TEXT");
  dropColumn(database, "todos", "preferred_worker");
  dropColumn(database, "project_bindings", "worker_kind");
  dropColumn(database, "runner_commands", "worker_kind");
  ensureColumn(database, "todo_attempts", "usage_input_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_attempts", "usage_cached_input_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_attempts", "usage_output_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_attempts", "usage_reasoning_output_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_attempts", "background_playwright_screenshot", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_attempts", "screenshot_compression_preset", "TEXT NOT NULL DEFAULT 'balanced'");
  ensureColumn(database, "todo_attempts", "retry_interval_seconds", "INTEGER NOT NULL DEFAULT 10");
  ensureColumn(database, "todo_attempts", "retry_max_attempts", "INTEGER NOT NULL DEFAULT 5");
  ensureColumn(database, "web_sessions", "csrf_token", "TEXT");
  ensureColumn(database, "todo_routes", "source_status", "TEXT");
  ensureColumn(database, "todo_routes", "attempt_id", "TEXT");
  ensureColumn(database, "todo_routes", "manager_usage_input_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_routes", "manager_usage_cached_input_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_routes", "manager_usage_output_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(database, "todo_routes", "manager_usage_reasoning_output_tokens", "INTEGER NOT NULL DEFAULT 0");
  dropColumn(database, "todo_routes", "execution_mode");
  purgeUnreleasedLegacyWorkspace(database);
  database.exec(`
    UPDATE projects SET workspace_external_key = external_key WHERE workspace_external_key IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_workspace_external_key
      ON projects(workspace_id, workspace_external_key)
      WHERE workspace_external_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runners_workspace ON runners(workspace_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_todos_retry ON todos(status, retry_after);
    CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(project_id, parent_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_logs_delivery
      ON todo_logs(delivery_id) WHERE delivery_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_artifacts_delivery
      ON todo_artifacts(delivery_id) WHERE delivery_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_routes_attempt
      ON todo_routes(attempt_id) WHERE attempt_id IS NOT NULL;
    UPDATE todo_routes
      SET attempt_id = 'legacy:' || todo_id
      WHERE attempt_id IS NULL AND state IN ('claimed', 'routed');
  `);
  migrateProjectManagerQueueStatus(database);
  migrateLegacyRunnerNames(database);
  collapseDuplicateRunners(database);
}

function purgeUnreleasedLegacyWorkspace(database: Database): void {
  const legacyWorkspaceId = "00000000-0000-4000-8000-000000000001";
  database.transaction(() => {
    database.run("DELETE FROM projects WHERE workspace_id IS NULL OR workspace_id = ?", [legacyWorkspaceId]);
    database.run("DELETE FROM runners WHERE workspace_id IS NULL OR workspace_id = ?", [legacyWorkspaceId]);
    database.run("DELETE FROM pairing_codes WHERE workspace_id IS NULL OR workspace_id = ?", [legacyWorkspaceId]);
    database.run("DELETE FROM todos WHERE project_id NOT IN (SELECT id FROM projects)");
    database.run("DELETE FROM workspace_settings WHERE workspace_id = ?", [legacyWorkspaceId]);
    database.run("DELETE FROM workspaces WHERE id = ?", [legacyWorkspaceId]);
    database.exec("DROP TABLE IF EXISTS app_settings");
  }).immediate();
}

function migrateLegacyRunnerNames(database: Database): void {
  database.exec(`
    UPDATE runners
    SET name = hostname
    WHERE name = hostname || ' · Maple CLI';

    UPDATE device_authorizations
    SET runner_name = hostname
    WHERE runner_name = hostname || ' · Maple CLI';
  `);
}

function migrateProjectManagerQueueStatus(database: Database): void {
  database.exec(`
    UPDATE todo_routes
    SET source_status = CASE (
      SELECT status FROM todos WHERE todos.id = todo_routes.todo_id
    ) WHEN 'rework' THEN 'rework' ELSE 'todo' END
    WHERE source_status IS NULL;

    UPDATE todos
    SET status = 'queued'
    WHERE status IN ('todo', 'rework')
      AND id IN (
        SELECT todo_id FROM todo_routes WHERE state IN ('claimed', 'routed')
      );
  `);
}

function migrateTodoWorker(database: Database): void {
  ensureColumn(database, "todos", "worker_kind", "TEXT");
  const allowedWorkers = WORKER_KINDS.map((kind) => `'${kind}'`).join(", ");

  if (hasColumn(database, "todos", "preferred_worker")) {
    database.exec(
      `UPDATE todos
       SET worker_kind = preferred_worker
       WHERE worker_kind IS NULL AND preferred_worker IN (${allowedWorkers})`
    );
  }

  if (hasColumn(database, "project_bindings", "worker_kind")) {
    database.exec(
      `UPDATE todos
       SET worker_kind = (
         SELECT b.worker_kind
         FROM project_bindings b
         WHERE b.project_id = todos.project_id
           AND b.worker_kind IN (${allowedWorkers})
         ORDER BY b.updated_at DESC, b.id ASC
         LIMIT 1
       )
       WHERE worker_kind IS NULL`
    );
  }

  database.exec(
    `UPDATE todos
     SET worker_kind = 'codex'
     WHERE worker_kind IS NULL OR worker_kind NOT IN (${allowedWorkers})`
  );
}

function ensureTodoWorkerInvariant(database: Database): void {
  const allowedWorkers = WORKER_KINDS.map((kind) => `'${kind}'`).join(", ");
  database.exec(`
    DROP TRIGGER IF EXISTS todos_worker_kind_insert_guard;
    DROP TRIGGER IF EXISTS todos_worker_kind_update_guard;

    CREATE TRIGGER todos_worker_kind_insert_guard
    BEFORE INSERT ON todos
    WHEN NEW.worker_kind IS NULL OR NEW.worker_kind NOT IN (${allowedWorkers})
    BEGIN
      SELECT RAISE(ABORT, 'todos.worker_kind must be a supported Worker');
    END;

    CREATE TRIGGER todos_worker_kind_update_guard
    BEFORE UPDATE OF worker_kind ON todos
    WHEN NEW.worker_kind IS NULL OR NEW.worker_kind NOT IN (${allowedWorkers})
    BEGIN
      SELECT RAISE(ABORT, 'todos.worker_kind must be a supported Worker');
    END;
  `);
}

function migrateProjectWorkflowWorker(database: Database): void {
  const allowedWorkers = WORKER_KINDS.map((kind) => `'${kind}'`).join(", ");
  const hadWorkerKind = hasColumn(database, "project_workflows", "worker_kind");
  ensureColumn(
    database,
    "project_workflows",
    "worker_kind",
    `TEXT NOT NULL DEFAULT 'codex' CHECK(worker_kind IN (${allowedWorkers}))`
  );

  const targetFilter = hadWorkerKind
    ? `WHERE worker_kind IS NULL OR worker_kind NOT IN (${allowedWorkers})`
    : "";
  database.exec(`
    UPDATE project_workflows
    SET worker_kind = COALESCE((
      SELECT t.worker_kind
      FROM todo_routes tr
      JOIN todos t ON t.id = tr.todo_id
      WHERE tr.workflow_id = project_workflows.id
        AND t.worker_kind IN (${allowedWorkers})
      ORDER BY tr.created_at ASC, t.created_at ASC, t.rowid ASC
      LIMIT 1
    ), 'codex')
    ${targetFilter};
  `);
}

/**
 * 旧库若已存在 nullable worker_kind，SQLite 无法原地补 NOT NULL/CHECK；
 * 触发器为这类库提供与新表约束一致的写入保护。
 */
function ensureProjectWorkflowWorkerInvariant(database: Database): void {
  const allowedWorkers = WORKER_KINDS.map((kind) => `'${kind}'`).join(", ");
  database.exec(`
    DROP TRIGGER IF EXISTS project_workflows_worker_kind_insert_guard;
    DROP TRIGGER IF EXISTS project_workflows_worker_kind_update_guard;

    CREATE TRIGGER project_workflows_worker_kind_insert_guard
    BEFORE INSERT ON project_workflows
    WHEN NEW.worker_kind IS NULL OR NEW.worker_kind NOT IN (${allowedWorkers})
    BEGIN
      SELECT RAISE(ABORT, 'project_workflows.worker_kind must be a supported Worker');
    END;

    CREATE TRIGGER project_workflows_worker_kind_update_guard
    BEFORE UPDATE OF worker_kind ON project_workflows
    WHEN NEW.worker_kind IS NULL OR NEW.worker_kind NOT IN (${allowedWorkers})
    BEGIN
      SELECT RAISE(ABORT, 'project_workflows.worker_kind must be a supported Worker');
    END;
  `);
}

/**
 * SQLite 不能原地修改 CHECK。旧版 todos 表需要无损重建，才能允许 DeepSeek；
 * API Key 不在该表中，迁移只处理公开的 Worker kind。
 */
function migrateTodoWorkerConstraint(database: Database): void {
  const row = database
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'todos'")
    .get() as { sql?: string | null } | null;
  if (row?.sql?.includes("'deepseek'")) return;

  const allowedWorkers = WORKER_KINDS.map((kind) => `'${kind}'`).join(", ");
  const foreignKeysRow = database.query("PRAGMA foreign_keys").get() as { foreign_keys?: number } | null;
  const restoreForeignKeys = foreignKeysRow?.foreign_keys !== 0;
  database.exec("PRAGMA foreign_keys = OFF;");
  try {
    database.transaction(() => {
      database.exec(`
        DROP TABLE IF EXISTS todos_worker_migration;
        CREATE TABLE todos_worker_migration (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          details TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          parent_id TEXT REFERENCES todos(id) ON DELETE CASCADE,
          priority INTEGER NOT NULL DEFAULT 0,
          worker_kind TEXT NOT NULL CHECK(worker_kind IN (${allowedWorkers})),
          claimed_by_runner_id TEXT REFERENCES runners(id) ON DELETE SET NULL,
          active_attempt_id TEXT,
          lease_token_hash TEXT,
          lease_expires_at TEXT,
          retry_after TEXT,
          result_summary TEXT,
          last_error TEXT,
          tags_json TEXT,
          details_doc TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT
        );

        INSERT INTO todos_worker_migration (
          id, project_id, title, details, status, parent_id, priority, worker_kind,
          claimed_by_runner_id, active_attempt_id, lease_token_hash, lease_expires_at,
          retry_after, result_summary, last_error, tags_json, details_doc,
          created_at, updated_at, started_at, completed_at
        )
        SELECT
          id, project_id, title, details, status, parent_id, priority, worker_kind,
          claimed_by_runner_id, active_attempt_id, lease_token_hash, lease_expires_at,
          retry_after, result_summary, last_error, tags_json, details_doc,
          created_at, updated_at, started_at, completed_at
        FROM todos;

        DROP TABLE todos;
        ALTER TABLE todos_worker_migration RENAME TO todos;
        CREATE INDEX idx_todos_project_status ON todos(project_id, status, priority DESC, created_at);
        CREATE INDEX idx_todos_lease ON todos(status, lease_expires_at);
        CREATE INDEX idx_todos_retry ON todos(status, retry_after);
      `);
    }).immediate();
  } finally {
    if (restoreForeignKeys) database.exec("PRAGMA foreign_keys = ON;");
  }
}

/**
 * 历史脏数据清理：同一台机器（hostname + platform）在过去每次重新配对都会
 * 新建一条 runner 记录，导致 dashboard 上出现重复的 worker。
 * 此迁移按 (hostname, platform) 保留最近活跃的一条 runner，把其余 runner 的
 * project_bindings 迁移到保留 runner 上（冲突的同 project binding 先丢弃冗余项），
 * 再删除多余的 runner。幂等，跑过一次后再启动也不会重复处理。
 */
function collapseDuplicateRunners(database: Database): void {
  const duplicates = database
    .query(
      `SELECT workspace_id, hostname, platform, COUNT(*) AS n
       FROM runners
       GROUP BY workspace_id, hostname, platform
       HAVING n > 1`
    )
    .all() as Array<{ workspace_id: string; hostname: string; platform: string }>;
  if (duplicates.length === 0) return;

  for (const { workspace_id: workspaceId, hostname, platform } of duplicates) {
    // 按 last_seen_at 降序，保留第一条；其余为待合并。
    const rows = database
      .query("SELECT id FROM runners WHERE workspace_id = ? AND hostname = ? AND platform = ? ORDER BY last_seen_at DESC, created_at DESC")
      .all(workspaceId, hostname, platform) as Array<{ id: string }>;
    if (rows.length < 2) continue;
    const keepId = rows[0].id;
    const dropIds = rows.slice(1).map((row) => row.id);

    for (const dropId of dropIds) {
      // 把待删 runner 的 binding 迁到保留 runner。
      // 同 project 的 binding 在保留 runner 上可能已存在（UNIQUE(project_id, runner_id)），
      // 此时丢弃待删那条冗余 binding（保留 runner 的更新）。
      database.run(
        `DELETE FROM project_bindings
         WHERE runner_id = ?
           AND project_id IN (SELECT project_id FROM project_bindings WHERE runner_id = ?)`,
        [dropId, keepId]
      );
      database.run("UPDATE project_bindings SET runner_id = ? WHERE runner_id = ?", [keepId, dropId]);
      // 其余挂在待删 runner 的引用（commands/attempts）按 schema ON DELETE SET NULL 自行处理。
      database.run("DELETE FROM runners WHERE id = ?", [dropId]);
    }
  }
}

function ensureColumn(database: Database, table: string, column: string, definition: string): void {
  if (!hasColumn(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function hasColumn(database: Database, table: string, column: string): boolean {
  const columns = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((existing) => existing.name === column);
}

function dropColumn(database: Database, table: string, column: string): void {
  if (hasColumn(database, table, column)) {
    database.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

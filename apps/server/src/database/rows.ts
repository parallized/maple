import {
  DEFAULT_SCREENSHOT_COMPRESSION_PRESET,
  isScreenshotCompressionPreset,
  RUNNER_CAPABILITIES,
  WORKER_KINDS
} from "@maple/protocol";
import type {
  AttemptState,
  LogStream,
  Project,
  ProjectBinding,
  Runner,
  RunnerCapability,
  RunnerCommand,
  RunnerRunRecord,
  RunLogKind,
  RunLogLevel,
  RunLogStatus,
  Todo,
  TodoAttempt,
  TodoLog,
  TodoStatus,
  TokenUsage,
  WorkerInventoryItem,
  WorkerKind
} from "@maple/protocol";

export interface ProjectRow {
  id: string;
  workspace_id?: string;
  external_key: string;
  workspace_external_key?: string | null;
  name: string;
  repository_url: string | null;
  default_branch: string | null;
  tag_catalog_json: string | null;
  binding_count?: number;
  online_runner_count?: number;
  created_at: string;
  updated_at: string;
}

export interface BindingRow {
  id: string;
  project_id: string;
  runner_id: string;
  runner_name: string;
  workspace_label: string;
  git_branch: string | null;
  git_head: string | null;
  last_seen_at: string;
}

export interface RunnerRow {
  id: string;
  workspace_id?: string;
  name: string;
  hostname: string;
  platform: string;
  version: string;
  supported_workers?: string | null;
  worker_inventory?: string | null;
  capabilities?: string | null;
  last_seen_at: string;
  created_at: string;
  project_ids?: string | null;
}

export interface RunnerCommandRow {
  id: string;
  runner_id: string;
  type: string;
  status: string;
  result_project_id: string | null;
  result_binding_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

export interface TodoRow {
  id: string;
  project_id: string;
    title: string;
    details: string;
    status: string;
    parent_id: string | null;
    priority: number;
  worker_kind: string;
  claimed_by_runner_id: string | null;
  active_attempt_id: string | null;
  lease_expires_at: string | null;
  retry_after: string | null;
  result_summary: string | null;
  last_error: string | null;
  tags_json: string | null;
  details_doc: string | null;
  usage_input_tokens?: number;
  usage_cached_input_tokens?: number;
  usage_output_tokens?: number;
  usage_reasoning_output_tokens?: number;
  session_id?: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
    route_state?: string | null;
    manager_attempt_id?: string | null;
    manager_lease_expires_at?: string | null;
    serial_blocked?: number | null;
  }

export interface AttemptRow {
  id: string;
  todo_id: string;
  runner_id: string;
  worker_kind: string;
  state: string;
  exit_code: number | null;
  result_summary: string | null;
  error: string | null;
  usage_input_tokens: number;
  usage_cached_input_tokens: number;
  usage_output_tokens: number;
  usage_reasoning_output_tokens: number;
  session_id: string | null;
  background_playwright_screenshot: number;
  screenshot_compression_preset: string;
  retry_interval_seconds: number;
  retry_max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface LogRow {
  id: number;
  attempt_id: string;
  sequence: number;
  occurred_at: string | null;
  stream: string;
  kind: string;
  level: string;
  status: string | null;
  title: string | null;
  content: string;
  group_id: string | null;
  delivery_id?: string | null;
  created_at: string;
}

export interface RunnerRunRow {
  attempt_id: string;
  todo_id: string;
  todo_title: string;
  project_id: string;
  project_name: string;
  worker_kind: string;
  state: string;
  exit_code: number | null;
  result_summary: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    externalKey: row.workspace_external_key ?? row.external_key,
    name: row.name,
    repositoryUrl: row.repository_url,
    defaultBranch: row.default_branch,
    tagCatalog: row.tag_catalog_json ?? undefined,
    bindingCount: row.binding_count ?? 0,
    onlineRunnerCount: row.online_runner_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toBinding(row: BindingRow): ProjectBinding {
  return {
    id: row.id,
    projectId: row.project_id,
    runnerId: row.runner_id,
    runnerName: row.runner_name,
    workspaceLabel: row.workspace_label,
    gitBranch: row.git_branch,
    gitHead: row.git_head,
    lastSeenAt: row.last_seen_at
  };
}

function parseSupportedWorkers(raw: string | null | undefined): WorkerKind[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (kind): kind is WorkerKind => typeof kind === "string" && (WORKER_KINDS as readonly string[]).includes(kind)
    );
  } catch {
    return [];
  }
}

function parseWorkerInventory(raw: string | null | undefined): WorkerInventoryItem[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<WorkerKind>();
    const inventory: WorkerInventoryItem[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const value = item as Record<string, unknown>;
      const kind = value.kind;
      if (typeof kind !== "string" || !(WORKER_KINDS as readonly string[]).includes(kind)) continue;
      if (seen.has(kind as WorkerKind) || typeof value.available !== "boolean") continue;
      seen.add(kind as WorkerKind);
      inventory.push({
        kind: kind as WorkerKind,
        available: value.available,
        modelId: typeof value.modelId === "string" ? value.modelId : null,
        modelName: typeof value.modelName === "string" ? value.modelName : null,
        reasoningEffort: typeof value.reasoningEffort === "string" ? value.reasoningEffort : null
      });
    }
    return inventory;
  } catch {
    return [];
  }
}

function parseRunnerCapabilities(raw: string | null | undefined): RunnerCapability[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (capability): capability is RunnerCapability => (
        typeof capability === "string"
        && (RUNNER_CAPABILITIES as readonly string[]).includes(capability)
      )
    );
  } catch {
    return [];
  }
}

export function toRunner(row: RunnerRow, offlineBefore: string): Runner {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    hostname: row.hostname,
    platform: row.platform,
    version: row.version,
    state: row.last_seen_at >= offlineBefore ? "online" : "offline",
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    projectIds: row.project_ids ? row.project_ids.split(",").filter(Boolean) : [],
    supportedWorkers: parseSupportedWorkers(row.supported_workers),
    workerInventory: parseWorkerInventory(row.worker_inventory),
    capabilities: parseRunnerCapabilities(row.capabilities)
  };
}

export function toRunnerCommand(row: RunnerCommandRow): RunnerCommand {
  return {
    id: row.id,
    runnerId: row.runner_id,
    type: row.type as RunnerCommand["type"],
    status: row.status as RunnerCommand["status"],
    resultProjectId: row.result_project_id,
    resultBindingId: row.result_binding_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at
  };
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function toExecutionPhase(row: TodoRow): NonNullable<Todo["executionPhase"]> | null {
  if (row.status === "running") return "running";
  if (row.status === "queued") {
    return row.route_state === "claimed" || row.route_state === "routed" ? "planning" : "queued";
  }
  if ((row.status === "todo" || row.status === "rework") && row.route_state === "pending") {
    return "queued";
  }
  return null;
}

export function toTodo(row: TodoRow): Todo {
  const hasExecution = Boolean(row.active_attempt_id || row.manager_attempt_id);
  const activeLease = row.active_attempt_id ? row.lease_expires_at : row.manager_lease_expires_at ?? null;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
      details: row.details,
      status: row.status as TodoStatus,
      parentId: row.parent_id ?? null,
      priority: row.priority,
    workerKind: row.worker_kind as WorkerKind,
    claimedByRunnerId: row.claimed_by_runner_id,
    activeAttemptId: row.active_attempt_id,
    leaseExpiresAt: row.lease_expires_at,
      executionPhase: toExecutionPhase(row),
      serialBlocked: row.serial_blocked === 1,
      executionConnection: hasExecution
      ? (activeLease !== null && activeLease > new Date().toISOString() ? "connected" : "interrupted")
      : null,
    retryAfter: row.retry_after,
    resultSummary: row.result_summary,
    lastError: row.last_error,
    tags: parseTags(row.tags_json),
    detailsDoc: row.details_doc ?? undefined,
    usage:
      row.usage_input_tokens != null
        ? {
            inputTokens: row.usage_input_tokens,
            cachedInputTokens: row.usage_cached_input_tokens ?? 0,
            outputTokens: row.usage_output_tokens ?? 0,
            reasoningOutputTokens: row.usage_reasoning_output_tokens ?? 0
          }
        : undefined,
    sessionId: row.session_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function toAttempt(row: AttemptRow): TodoAttempt {
  return {
    id: row.id,
    todoId: row.todo_id,
    runnerId: row.runner_id,
    workerKind: row.worker_kind as WorkerKind,
    state: row.state as AttemptState,
    exitCode: row.exit_code,
    resultSummary: row.result_summary,
    error: row.error,
    usage: toUsage(row),
    sessionId: row.session_id ?? undefined,
    acceptanceSettings: {
      backgroundPlaywrightScreenshot: row.background_playwright_screenshot === 1,
      screenshotCompressionPreset: isScreenshotCompressionPreset(row.screenshot_compression_preset)
        ? row.screenshot_compression_preset
        : DEFAULT_SCREENSHOT_COMPRESSION_PRESET
    },
    retryIntervalSeconds: row.retry_interval_seconds,
    retryMaxAttempts: row.retry_max_attempts,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

function toUsage(row: AttemptRow): TokenUsage | null {
  const total =
    row.usage_input_tokens + row.usage_cached_input_tokens + row.usage_output_tokens + row.usage_reasoning_output_tokens;
  if (total <= 0) return null;
  return {
    inputTokens: row.usage_input_tokens,
    cachedInputTokens: row.usage_cached_input_tokens,
    outputTokens: row.usage_output_tokens,
    reasoningOutputTokens: row.usage_reasoning_output_tokens
  };
}

export function toLog(row: LogRow): TodoLog {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    sequence: row.sequence ?? 0,
    occurredAt: row.occurred_at ?? row.created_at,
    stream: row.stream as LogStream,
    kind: (row.kind ?? "raw") as RunLogKind,
    level: (row.level ?? (row.stream === "stderr" ? "error" : "info")) as RunLogLevel,
    status: (row.status as RunLogStatus | null) ?? undefined,
    title: row.title ?? undefined,
    content: row.content,
    groupId: row.group_id ?? undefined,
    createdAt: row.created_at
  };
}

export function toRunnerRun(row: RunnerRunRow): RunnerRunRecord {
  return {
    attemptId: row.attempt_id,
    todoId: row.todo_id,
    todoTitle: row.todo_title,
    projectId: row.project_id,
    projectName: row.project_name,
    workerKind: row.worker_kind as WorkerKind,
    state: row.state as AttemptState,
    exitCode: row.exit_code,
    summary: row.result_summary,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

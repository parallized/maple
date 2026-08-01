import type { TodoStatus } from "./statuses";

export const WORKER_KINDS = ["codex", "deepseek", "claude", "kimi", "glm", "iflow", "gemini", "opencode"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export type DeepSeekCredentialSource = "windows_credential_manager" | "environment" | "unavailable";

/** Maple Local 只公开连接状态；API Key 永远不会出现在响应或数据库中。 */
export interface DeepSeekConnectionStatus {
  provider: "deepseek";
  supported: boolean;
  configured: boolean;
  source: DeepSeekCredentialSource;
  message: string | null;
}

/** CLI 本机解析出的 Worker 默认模型；只包含可公开的模型元数据。 */
export interface WorkerInventoryItem {
  kind: WorkerKind;
  available: boolean;
  modelId: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
}

/** 单次执行结束后的 token 用量（取最后一次 turn.completed）。 */
export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/** A provider-specific model price snapshot sourced from models.dev. */
export interface ModelPricingEntry {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  /** USD per million tokens; null means models.dev did not publish this rate. */
  inputUsdPerMillion: number | null;
  reasoningUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  inputAudioUsdPerMillion: number | null;
  outputAudioUsdPerMillion: number | null;
  /** Retains tiers and other pricing dimensions added by models.dev. */
  cost: Record<string, unknown>;
  lastUpdated: string | null;
  fetchedAt: string;
}

export const SCREENSHOT_COMPRESSION_PRESETS = ["high", "balanced", "compact"] as const;
export type ScreenshotCompressionPreset = (typeof SCREENSHOT_COMPRESSION_PRESETS)[number];
export const DEFAULT_SCREENSHOT_COMPRESSION_PRESET: ScreenshotCompressionPreset = "balanced";
export function isScreenshotCompressionPreset(value: unknown): value is ScreenshotCompressionPreset {
  return typeof value === "string" && (SCREENSHOT_COMPRESSION_PRESETS as readonly string[]).includes(value);
}

export interface AcceptanceSettings {
  backgroundPlaywrightScreenshot: boolean;
  /** Optional on the wire so older clients can update the screenshot switch without resetting this setting. */
  screenshotCompressionPreset?: ScreenshotCompressionPreset;
}

export const AI_OUTPUT_LANGUAGES = ["follow_ui", "zh", "en"] as const;
export type AiOutputLanguage = (typeof AI_OUTPUT_LANGUAGES)[number];

export interface WorkspaceExecutionSettings {
  /** Default Coding Agent assigned to newly created tasks. */
  defaultWorker: WorkerKind;
  /** Coding Agent used by the Leader PM. */
  leaderWorker: WorkerKind;
  /** @deprecated Compatibility alias for defaultWorker. */
  baseWorker: WorkerKind;
  aiOutputLanguage: AiOutputLanguage;
  /** Worker 宪法：所有 Worker 执行前阅读并遵守。 */
  constitution: string;
  /** Leader 宪法：Leader PM 在归组派单前阅读并遵守。 */
  leaderConstitution: string;
  /** Maximum number of Worker Todo attempts a Runner may execute concurrently. */
  concurrency: number;
  retryIntervalSeconds: number;
  retryMaxAttempts: number;
}

export const DEFAULT_WORKSPACE_EXECUTION_SETTINGS: WorkspaceExecutionSettings = {
  defaultWorker: "claude",
  leaderWorker: "claude",
  baseWorker: "claude",
  aiOutputLanguage: "follow_ui",
  constitution: "",
  leaderConstitution: "",
  concurrency: 2,
  retryIntervalSeconds: 10,
  retryMaxAttempts: 5
};

export interface MapleSettings {
  acceptance: AcceptanceSettings;
  execution: WorkspaceExecutionSettings;
}
export const RUNNER_CAPABILITIES = ["project_manager_v1"] as const;
export type RunnerCapability = (typeof RUNNER_CAPABILITIES)[number];

export type RunnerState = "online" | "offline";
export type ExecutionConnection = "connected" | "interrupted";
export const TODO_EXECUTION_PHASES = ["queued", "planning", "running"] as const;
export type TodoExecutionPhase = (typeof TODO_EXECUTION_PHASES)[number];
export type RunnerCommandType = "select_project_directory";
export type RunnerCommandStatus = "pending" | "claimed" | "succeeded" | "cancelled" | "failed" | "expired";
export type AttemptState = "claimed" | "running" | "succeeded" | "failed" | "abandoned";
export type LogStream = "stdout" | "stderr" | "system";

export const RUN_LOG_KINDS = [
  "lifecycle",
  "assistant",
  "reasoning",
  "tool",
  "tool_result",
  "command",
  "file_change",
  "warning",
  "error",
  "raw"
] as const;
export type RunLogKind = (typeof RUN_LOG_KINDS)[number];

export const RUN_LOG_LEVELS = ["debug", "info", "warning", "error"] as const;
export type RunLogLevel = (typeof RUN_LOG_LEVELS)[number];

export const RUN_LOG_STATUSES = ["started", "progress", "completed", "failed"] as const;
export type RunLogStatus = (typeof RUN_LOG_STATUSES)[number];

/**
 * Coding Agent adapter 输出的统一运行事件。
 * sequence 在一次 attempt 内单调递增；groupId 用于把同一次工具调用的开始、进度与结果关联起来。
 */
export interface RunLogEntry {
  sequence: number;
  occurredAt: string;
  stream: LogStream;
  kind: RunLogKind;
  level: RunLogLevel;
  status?: RunLogStatus;
  title?: string;
  content: string;
  groupId?: string;
}

export interface Project {
  id: string;
  /** 项目所属工作区；旧版客户端可以忽略。 */
  workspaceId?: string;
  externalKey: string;
  name: string;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  tagCatalog?: string;
  bindingCount: number;
  onlineRunnerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBinding {
  id: string;
  projectId: string;
  runnerId: string;
  runnerName: string;
  workspaceLabel: string;
  gitBranch: string | null;
  gitHead: string | null;
  lastSeenAt: string;
}

export interface Runner {
  id: string;
  /** Runner 只能属于一个工作区；旧版客户端可以忽略。 */
  workspaceId?: string;
  name: string;
  hostname: string;
  platform: string;
  version: string;
  state: RunnerState;
  lastSeenAt: string;
  createdAt: string;
  projectIds: string[];
  /** CLI 上报的本机可用 Worker 工具；旧版 Runner 未上报时缺省。 */
  supportedWorkers?: WorkerKind[];
  /** CLI 上报的完整 Worker 类型、安装状态与默认模型；旧版 Runner 未上报时缺省。 */
  workerInventory?: WorkerInventoryItem[];
  /** CLI 明确声明的可选协议能力，避免新版 Server 误用旧 CLI。 */
  capabilities?: RunnerCapability[];
}

export interface RunnerCommand {
  id: string;
  runnerId: string;
  type: RunnerCommandType;
  status: RunnerCommandStatus;
  resultProjectId: string | null;
  resultBindingId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

export interface Todo {
  id: string;
  projectId: string;
  title: string;
  details: string;
  status: TodoStatus;
  priority: number;
  workerKind: WorkerKind;
  claimedByRunnerId: string | null;
  activeAttemptId: string | null;
  leaseExpiresAt: string | null;
  /** Server-derived execution phase. Optional for rolling upgrades with older clients. */
  executionPhase?: TodoExecutionPhase | null;
  /** Transport health for the current Worker or project-manager attempt. */
  executionConnection?: ExecutionConnection | null;
  /** Failed executions are not claimable before this server-side retry deadline. */
  retryAfter?: string | null;
  resultSummary: string | null;
  lastError: string | null;
  tags: string[];
  detailsDoc?: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TodoAttempt {
  id: string;
  todoId: string;
  runnerId: string;
  workerKind: WorkerKind;
  state: AttemptState;
  exitCode: number | null;
  resultSummary: string | null;
  error: string | null;
  usage: TokenUsage | null;
  acceptanceSettings?: AcceptanceSettings;
  retryIntervalSeconds?: number;
  retryMaxAttempts?: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export type TodoArtifactKind = "screenshot";
export const TODO_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024;
export const TODO_SCREENSHOT_MAX_COUNT = 6;
export const TODO_SCREENSHOT_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type TodoScreenshotMimeType = (typeof TODO_SCREENSHOT_MIME_TYPES)[number];

export interface TodoArtifact {
  id: string;
  todoId: string;
  attemptId: string;
  kind: TodoArtifactKind;
  fileName: string;
  mimeType: TodoScreenshotMimeType;
  sizeBytes: number;
  createdAt: string;
}

export const TODO_ASSET_MAX_BYTES = 8 * 1024 * 1024;
export const TODO_ASSET_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type TodoAssetMimeType = (typeof TODO_ASSET_MIME_TYPES)[number];

/** An image embedded in a Todo's editable body. */
export interface TodoAsset {
  id: string;
  todoId: string;
  fileName: string;
  mimeType: TodoAssetMimeType;
  sizeBytes: number;
  createdAt: string;
}

export interface TodoLog extends RunLogEntry {
  id: number;
  attemptId: string;
  createdAt: string;
}

/** 一个项目内可持续复用上下文的工作流。 */
export interface ProjectWorkflow {
  id: string;
  projectId: string;
  /** Workflow 固定使用的 Worker；更换 Worker 必须创建新 Workflow。 */
  workerKind: WorkerKind;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/** 项目经理只读取的 Maple 历史摘要，不包含本机绝对路径或完整运行日志。 */
export interface ProjectManagerHistoryItem {
  todoId: string;
  title: string;
  details: string;
  status: TodoStatus;
  workerKind: WorkerKind;
  workflowId: string | null;
  resultSummary: string | null;
  dispatchBrief: string | null;
  updatedAt: string;
}

/** Server 派给项目经理的快速诊断任务。 */
export interface ProjectManagerJob {
  todo: Todo;
  project: Project;
  binding: ProjectBinding;
  workflows: ProjectWorkflow[];
  history: ProjectManagerHistoryItem[];
  availableWorkers: WorkerKind[];
  executionSettings?: WorkspaceExecutionSettings;
  attemptId: string;
  leaseToken: string;
  leaseSeconds: number;
}

/** Runner Token 只能读取属于自己的执行记录。 */
export interface RunnerRunRecord {
  attemptId: string;
  todoId: string;
  todoTitle: string;
  projectId: string;
  projectName: string;
  workerKind: WorkerKind;
  state: AttemptState;
  exitCode: number | null;
  summary: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ExecutionJob {
  todo: Todo;
  project: Project;
  binding: ProjectBinding;
  attempt: TodoAttempt;
  leaseToken: string;
  leaseSeconds: number;
  acceptanceSettings?: AcceptanceSettings;
  executionSettings?: WorkspaceExecutionSettings;
  /** 项目经理已归组时提供，旧版 Server/CLI 可以缺省。 */
  workflow?: ProjectWorkflow | null;
  /** 项目经理给 Worker 的短派单备注，不是实施 Plan。 */
  dispatchBrief?: string | null;
  /** 最初完成派单的 Leader PM；Worker 失败时只允许由它生成收口报告。 */
  managerWorkerKind?: WorkerKind | null;
}

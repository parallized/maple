import type {
  AcceptanceSettings,
  WorkspaceExecutionSettings,
  ExecutionJob,
  LogStream,
  MapleSettings,
  Project,
  ProjectBinding,
  ProjectManagerJob,
  ProjectWorkflow,
  Runner,
  RunnerCapability,
  RunnerCommand,
  RunnerRunRecord,
  RunLogKind,
  RunLogLevel,
  RunLogStatus,
  Todo,
  TodoAsset,
  TodoArtifact,
  TodoAttempt,
  TodoLog,
  TokenUsage,
  WorkerInventoryItem,
  WorkerKind
} from "./models";
import type { DeploymentMode } from "./auth";
import type { TodoStatus } from "./statuses";

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface HealthResponse {
  name: "maple-server";
  version: string;
  status: "ok";
  deploymentMode: DeploymentMode;
  now: string;
}

/** One published Maple version and its successful install.sh downloads. */
export interface VersionHistoryItem {
  version: string;
  releasedAt: string;
  summary: string;
  changes: string[];
  installShDownloads: number;
}

export interface VersionHistoryResponse {
  currentVersion: string;
  releases: VersionHistoryItem[];
}

/** Public counters rendered by the product homepage. */
export interface HomeStatsResponse {
  version: string;
  installShDownloads: number;
}

export interface RecordInstallShDownloadResponse extends HomeStatsResponse {
  /** False when the same installer event is retried. */
  counted: boolean;
}

export interface DashboardSnapshot {
  projects: Project[];
  bindings: ProjectBinding[];
  runners: Runner[];
  todos: Todo[];
  tokenUsage: TokenUsageBreakdown[];
  settings: MapleSettings;
  revision: number;
  serverTime: string;
}

export type UpdateAcceptanceSettingsRequest = Partial<AcceptanceSettings>;
export type UpdateWorkspaceExecutionSettingsRequest = Partial<WorkspaceExecutionSettings>;

/** 按项目 × Worker 类型聚合的 token 用量（用于概览柱状图）。 */
export interface TokenUsageBreakdown {
  projectId: string;
  workerKind: WorkerKind;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface CreatePairingResponse {
  code: string;
  expiresAt: string;
}

export interface ExchangePairingRequest {
  code: string;
  runnerName: string;
  hostname: string;
  platform: string;
  version: string;
  /** CLI 探测到的本机可用 Worker 工具；旧版 CLI 可能不上报。 */
  supportedWorkers?: WorkerKind[];
  workerInventory?: WorkerInventoryItem[];
  capabilities?: RunnerCapability[];
}

export interface ExchangePairingResponse {
  runner: Runner;
  runnerToken: string;
}

export interface RunnerHeartbeatRequest {
  version: string;
  /** CLI 探测到的本机可用 Worker 工具；上报时刷新 Server 侧记录。 */
  supportedWorkers?: WorkerKind[];
  workerInventory?: WorkerInventoryItem[];
  capabilities?: RunnerCapability[];
}

export interface RunnerHeartbeatResponse {
  runner: Runner;
  workspace: {
    id: string;
    name: string;
    updatedAt: string;
  };
}

export interface CreateRunnerCommandRequest {
  type: "select_project_directory";
}

export interface RunnerCommandListResponse {
  commands: RunnerCommand[];
}

export interface ClaimRunnerCommandResponse {
  command: RunnerCommand | null;
  leaseToken: string | null;
  retryAfterMs: number;
}

export interface CompleteRunnerCommandRequest {
  leaseToken: string;
  outcome: "succeeded" | "cancelled" | "failed";
  projectId?: string;
  bindingId?: string;
  error?: string;
}

export interface RegisterProjectRequest {
  externalKey: string;
  name: string;
  repositoryUrl?: string | null;
  defaultBranch?: string | null;
  workspaceLabel: string;
  gitBranch?: string | null;
  gitHead?: string | null;
}

export interface RegisterProjectResponse {
  project: Project;
  binding: ProjectBinding;
}

export interface CreateTodoRequest {
  /** 可选客户端 id(Web 看板本地生成,保证创建幂等)。 */
  id?: string;
  title: string;
  details?: string;
  priority?: number;
  workerKind: WorkerKind;
  status?: Extract<TodoStatus, "draft" | "todo">;
  tags?: string[];
}

export interface UpdateTodoRequest {
  title?: string;
  details?: string;
  priority?: number;
  workerKind?: WorkerKind;
  status?: TodoStatus;
  tags?: string[];
  detailsDoc?: string;
}

export interface UpdateProjectRequest {
  tagCatalog?: string;
}

export interface ClaimJobResponse {
  job: ExecutionJob | null;
  retryAfterMs: number;
}

export interface ClaimProjectManagerJobResponse {
  job: ProjectManagerJob | null;
  retryAfterMs: number;
}

export interface CompleteProjectManagerJobRequest {
  leaseToken: string;
  managerWorkerKind: WorkerKind;
  selectedWorkerKind: WorkerKind;
  /** null 表示创建新 Workflow；存在时必须属于当前项目。 */
  workflowId: string | null;
  workflowTitle: string;
  workflowSummary: string;
  executionMode: "serial" | "parallel";
  dispatchBrief: string;
}

export interface CompleteProjectManagerJobResponse {
  todo: Todo;
  workflow: ProjectWorkflow;
  selectedWorkerKind: WorkerKind;
  executionMode: "serial" | "parallel";
  dispatchBrief: string;
}

export interface BlockProjectManagerJobRequest {
  leaseToken: string;
  managerWorkerKind: WorkerKind;
  /** 只接受 Leader PM Coding Agent 的原始 Markdown 回复；系统不得代写。 */
  report?: string;
  /** PM 自身失败时只保存技术原因，不把它冒充为执行报告。 */
  technicalError?: string;
}

export interface BlockProjectManagerJobResponse {
  todo: Todo;
  report: string | null;
}

export interface StartJobRequest {
  leaseToken: string;
}

export interface HeartbeatJobRequest {
  leaseToken: string;
}

export interface AppendJobLogRequest {
  leaseToken: string;
  stream: LogStream;
  content: string;
  /** 新字段保持可选，允许旧版 CLI 向新版 Server 回传原始日志。 */
  sequence?: number;
  occurredAt?: string;
  kind?: RunLogKind;
  level?: RunLogLevel;
  status?: RunLogStatus;
  title?: string;
  groupId?: string;
}

export interface CompleteJobRequest {
  leaseToken: string;
  success: boolean;
  exitCode?: number | null;
  summary?: string;
  error?: string;
  usage?: TokenUsage | null;
  /** 指定 Worker 不得被替换；新 CLI 的失败由 PM 收口后直接阻塞。 */
  failureDisposition?: "retry" | "blocked";
}

export interface JobMutationResponse {
  todo: Todo;
  attempt: TodoAttempt;
}

export interface TodoDetailResponse {
  todo: Todo;
  attempts: TodoAttempt[];
  logs: TodoLog[];
  artifacts: TodoArtifact[];
}

export interface UploadTodoArtifactResponse {
  artifact: TodoArtifact;
}

export interface UploadTodoAssetResponse {
  asset: TodoAsset;
}

export interface RunnerRunListResponse {
  runs: RunnerRunRecord[];
}

export interface RunnerRunLogResponse {
  run: RunnerRunRecord;
  logs: TodoLog[];
  nextAfterId: number | null;
}

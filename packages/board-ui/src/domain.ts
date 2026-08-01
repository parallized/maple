export type ViewKey = "overview" | "board" | "progress" | "settings";
export type WorkerKind = "claude" | "codex" | "deepseek" | "kimi" | "glm" | "iflow" | "gemini" | "opencode";

export type DeepSeekConnectionStatus = {
  provider: "deepseek";
  supported: boolean;
  configured: boolean;
  source: "windows_credential_manager" | "server_encrypted" | "environment" | "unavailable";
  message: string | null;
};
export type TaskStatus =
  | "草稿"
  | "待办"
  | "待返工"
  | "队列中"
  | "进行中"
  | "需要更多信息"
  | "已完成"
  | "已阻塞";
export type DetailMode = "sidebar" | "modal";
/** 服务端下发的任务执行阶段；旧 Server 不下发时为 undefined。 */
export type TaskExecutionPhase = "queued" | "planning" | "running";
/** 看板展示类型：自优化列表 / 任务画廊 / 关系树（预留，禁用）。 */
export type BoardDisplayType = "list" | "gallery" | "tree";

/** 截图压缩档位（与 @maple/protocol ScreenshotCompressionPreset 一致）。 */
export type ScreenshotCompressionPreset = "high" | "balanced" | "compact";

/** 验收设置（与 @maple/protocol AcceptanceSettings 结构一致，仅 Server-backed 平台支持读写）。 */
export type AcceptanceSettings = {
  /** 后台 Playwright 截图验收：任务完成后自动截图并附入执行报告。 */
  backgroundPlaywrightScreenshot: boolean;
  /** 截图压缩档位；旧客户端可能不返回，缺省视为 balanced。 */
  screenshotCompressionPreset?: ScreenshotCompressionPreset;
};

export type WorkerConfig = {
  executable: string;
  runArgs: string;
  consoleArgs: string;
  probeArgs: string;
  dangerMode: boolean;
};

export type McpServerConfig = {
  executable: string;
  args: string;
  cwd: string;
  autoStart: boolean;
};

export type WorkerCommandResult = {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

export type WorkerLogEvent = {
  workerId: string;
  taskTitle: string;
  stream: "stdout" | "stderr";
  line: string;
};

export type WorkerDoneEvent = {
  workerId: string;
  success: boolean;
  code: number | null;
};

export type McpServerStatus = {
  running: boolean;
  pid: number | null;
  command: string;
};

/** 已连接到 Server 的 CLI 执行端（runner）摘要，用于 Worker 列表展示。 */
export type RunnerState = "online" | "offline";
export type RunnerWorkerInventoryItem = {
  kind: WorkerKind;
  available: boolean;
  modelId: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
};
export type RunnerSummary = {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  state: RunnerState;
  lastSeenAt: string;
  /** CLI 上报的本机可用 Worker 工具;旧版 CLI 未上报时为 undefined。 */
  supportedWorkers?: WorkerKind[];
  /** CLI 解析出的 Worker 默认模型；不包含任何凭据或本机配置路径。 */
  workerInventory?: RunnerWorkerInventoryItem[];
};

export type TaskReport = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
};

/** 任务附件元数据(截图等);内容由平台按需拉取,不内嵌在任务里。 */
export type TaskArtifact = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type TagDefinition = {
  color?: string;
  icon?: string;
  label?: {
    zh?: string;
    en?: string;
  };
};

export type TagCatalog = Record<string, TagDefinition>;

export type Task = {
  id: string;
  title: string;
  details: string;
  detailsDoc?: unknown;
  status: TaskStatus;
  /** 父任务 id；为空时是顶层任务。表格以树形结构展示子任务。 */
  parentId?: string | null;
  /** 执行该任务的 Worker 类型；新建任务默认为「基模」。 */
  workerKind: WorkerKind;
  needsConfirmation?: boolean;
  tags: string[];
  /** 服务端下发的执行阶段；缺失/null 时按 status 展示（兼容旧 Server）。 */
  executionPhase?: TaskExecutionPhase | null;
  /** 执行开始时间；running 计时起点，缺失时回退 updatedAt。 */
  startedAt?: string | null;
  /** 同一工作流内有前序任务正在执行/排队，本任务在等待串行执行。 */
  serialBlocked?: boolean;
  createdAt: string;
  updatedAt: string;
  reports: TaskReport[];
};

/** 单个项目的 token 用量按 Worker 类型分桶（用于概览柱状图）。 */
export type ProjectTokenUsage = {
  workerKind: WorkerKind;
  /** 产生该用量的 Maple 角色：Leader（调度决策）或 Worker（任务执行）。 */
  agentRole: "leader" | "worker";
  /** 4 项 token 之和，柱状图 y 轴高度。 */
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type Project = {
  id: string;
  name: string;
  directory: string;
  /** 项目创建时间(服务端快照提供);用于侧栏「新增」标记,本地存储的项目可能没有。 */
  createdAt?: string;
  tasks: Task[];
  tagCatalog?: TagCatalog;
  tokenUsage?: ProjectTokenUsage[];
};

export type McpTaskUpdatedEvent = {
  projectName: string;
  task: Task;
};

export type McpTagCatalogUpdatedEvent = {
  projectName: string;
  tagCatalog: TagCatalog;
};

export type McpWorkerFinishedEvent = {
  project: string;
  summary: string;
};

export const isMac = navigator.userAgent.includes("Mac");

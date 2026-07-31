import type {
  AcceptanceSettings,
  DeepSeekConnectionStatus,
  McpTagCatalogUpdatedEvent,
  McpTaskUpdatedEvent,
  McpWorkerFinishedEvent,
  Project,
  RunnerSummary,
  Task,
  TaskArtifact,
  WorkerKind,
  WorkerCommandResult,
  WorkerDoneEvent,
  WorkerLogEvent,
} from "../domain";
import type { InstallTargetId } from "../lib/install-targets";
import type { AiLanguage, ThemeMode, UiFont, UiLanguage, WorkerRetryConfig } from "../lib/constants";

/** 安装目标探测结果(与 Tauri `probe_install_targets` 返回一致)。 */
export type WorkerProbe = {
  id: InstallTargetId;
  runtime: "native" | "wsl";
  cliFound: boolean;
  installed: boolean;
  npmFound: boolean;
};

/** 安装进度事件(与 Tauri `maple://install-task-event` payload 一致)。 */
export type InstallTaskEvent =
  | { kind: "log"; installId: string; targetId?: string | null; stream?: string | null; line?: string | null }
  | { kind: "target_state"; installId: string; targetId?: string | null; state?: string | null }
  | { kind: "target_result"; installId: string; targetId?: string | null; result?: unknown }
  | { kind: "done"; installId: string; success?: boolean | null };

export type InstallMeta = {
  skillsVersion: number | null;
  installedAt: string | null;
  latestSkillsVersion: number;
};

export type RunWorkerRequest = {
  workerId: string;
  taskTitle: string;
  executable: string;
  args: string[];
  prompt: string;
  cwd: string;
};

export type PlatformCapabilities = {
  /** 桌面(Tauri)运行时:窗口控制、托盘。 */
  isDesktop: boolean;
  /** 可以本地 spawn Worker CLI 并交互(执行/停止/stdin/权限确认)。 */
  canExecuteWorkers: boolean;
  /** 可以安装/探测 MCP skills 与 Worker CLI。 */
  canInstall: boolean;
  /** 可以通过系统目录选择器选择本地目录。 */
  canPickDirectory: boolean;
  /** 可以打开本地目录 / 外部编辑器。 */
  canOpenPath: boolean;
  /** 项目来源:directory = 本地目录;runner = 由执行端注册。 */
  projectSource: "directory" | "runner";
};

export type Unsubscribe = () => void;

export type BoardUserPreferences = {
  theme: ThemeMode;
  uiFont: UiFont;
  uiLanguage: UiLanguage;
};

export type BoardExecutionSettings = {
  baseWorker: WorkerKind;
  /** Leader PM 使用的 Coding Agent；状态条展示用。 */
  leaderWorker: WorkerKind;
  aiOutputLanguage: AiLanguage;
  /** Worker 宪法：所有 Worker 执行前阅读并遵守。 */
  constitution: string;
  /** Leader 宪法：Leader PM 在归组派单前阅读并遵守。 */
  leaderConstitution: string;
  retryIntervalSeconds: WorkerRetryConfig["intervalSeconds"];
  retryMaxAttempts: WorkerRetryConfig["maxAttempts"];
};

/**
 * Server-backed 平台的显式任务写入接口。
 * React 中的 Task 只作为显示缓存，成功结果以数据源返回值为准。
 */
export interface TaskCommands {
  create(projectId: string, task: Task, fallbackWorkerKind?: WorkerKind): Promise<Task>;
  update(projectId: string, previous: Task, next: Task): Promise<Task>;
  remove(projectId: string, taskId: string): Promise<void>;
}

/** Server-backed 平台的显式项目写入接口。删除仅作用于数据源记录。 */
export interface ProjectCommands {
  remove(projectId: string): Promise<void>;
}

/**
 * BoardApp 的平台适配层。桌面端由 Tauri 实现,Web 端由 Server HTTP 实现。
 * 所有方法都必须可用(不支持的能力返回安全默认值),UI 依据 capabilities 隐藏入口。
 */
export interface BoardPlatform {
  readonly capabilities: PlatformCapabilities;

  // ── 项目数据持久化 ──
  /** 启动时加载项目树;返回 null 表示无持久化数据(用空列表)。 */
  loadProjects(): Promise<Project[] | null>;
  /** 本地平台保存项目树；提供 taskCommands 的平台只在这里同步项目级元数据。 */
  persistProjects(projects: Project[]): void;
  /**
   * 外部数据源推送(Web 轮询)。cb 收到最新项目树与 dirtyTaskIds
   * (有未落地本地修改的任务,合并时保留本地版本)。桌面端可不实现。
   */
  subscribeProjects?(
    cb: (
      projects: Project[],
      meta: { dirtyTaskIds: ReadonlySet<string>; runners: RunnerSummary[] },
    ) => void,
  ): Unsubscribe;
  /** 存在时任务通过显式命令写入；persistProjects 不负责保存任务。 */
  readonly taskCommands?: TaskCommands;
  /** 存在时项目删除通过显式命令写入；不会删除项目目录。 */
  readonly projectCommands?: ProjectCommands;

  // ── 宪法 ──
  loadConstitution(): Promise<string | null>;
  saveConstitution(text: string): Promise<void>;
  loadLeaderConstitution(): Promise<string | null>;
  saveLeaderConstitution(text: string): Promise<void>;

  // ── 任务详情图片资产 ──
  /** 保存图片,返回资产 id(引用形如 maple://asset/<id>)。 */
  saveImageAsset(taskId: string, data: Uint8Array, mimeType: string): Promise<string>;
  /** 解析资产 id 为可展示 URL(data: 或 blob:),不存在返回 null。 */
  resolveImageAssetUrl(taskId: string, assetId: string): Promise<string | null>;

  // ── Hosted preference/settings persistence ──
  loadUserPreferences?(): Promise<BoardUserPreferences>;
  saveUserPreferences?(next: BoardUserPreferences): Promise<void>;
  loadExecutionSettings?(): Promise<BoardExecutionSettings>;
  saveExecutionSettings?(next: BoardExecutionSettings): Promise<void>;

  // ── Local Provider connections ──
  loadDeepSeekConnection?(): Promise<DeepSeekConnectionStatus>;
  connectDeepSeek?(apiKey: string): Promise<DeepSeekConnectionStatus>;
  disconnectDeepSeek?(): Promise<DeepSeekConnectionStatus>;

  // ── Worker 执行(仅 canExecuteWorkers)──
  runWorker(req: RunWorkerRequest): Promise<WorkerCommandResult>;
  stopWorker(workerId: string): Promise<boolean>;
  sendWorkerInput(workerId: string, input: string): Promise<void>;
  probeWorker(executable: string, args: string[], cwd: string): Promise<WorkerCommandResult>;
  onWorkerLog(cb: (event: WorkerLogEvent) => void): Unsubscribe;
  onWorkerDone(cb: (event: WorkerDoneEvent) => void): Unsubscribe;

  // ── MCP 推送事件(仅桌面端有真实来源)──
  onTaskUpdated(cb: (event: McpTaskUpdatedEvent) => void): Unsubscribe;
  onTagCatalogUpdated(cb: (event: McpTagCatalogUpdatedEvent) => void): Unsubscribe;
  onWorkerFinished(cb: (event: McpWorkerFinishedEvent) => void): Unsubscribe;

  // ── 安装 / 探测(仅 canInstall)──
  probeInstallTargets(): Promise<WorkerProbe[]>;
  installMcpSkills(options: unknown): Promise<void>;
  getInstallMeta(): Promise<InstallMeta | null>;
  onInstallTaskEvent(cb: (event: InstallTaskEvent) => void): Unsubscribe;

  // ── 验收设置（仅 Server-backed 平台实现；未实现时设置页隐藏「验收」tab）──
  /** 读取验收设置；平台不支持或未加载到时返回 null。 */
  loadAcceptanceSettings?(): Promise<AcceptanceSettings | null>;
  /** 写入验收设置；失败应抛错，由 UI 回滚。 */
  saveAcceptanceSettings?(next: AcceptanceSettings): Promise<void>;

  // ── 任务附件（截图;仅 Server-backed 平台实现,未实现时详情面板不渲染画廊）──
  /** 列出任务附件元数据;失败应抛错,由 UI 决定静默或提示。 */
  loadTaskArtifacts?(taskId: string): Promise<TaskArtifact[]>;
  /** 带鉴权拉取附件内容,供 UI 生成 object URL 展示;variant=thumb 时取服务端缩略图(没有则回退原图)。 */
  fetchArtifactBlob?(taskId: string, artifactId: string, variant?: "thumb" | "full"): Promise<Blob>;

  // ── 系统集成 ──
  openPath(path: string): Promise<void>;
  openInEditor(path: string, editorApp: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
  /** 系统通知;返回 false 表示未发出(调用方降级为应用内提示)。 */
  notify(title: string, body: string): Promise<boolean>;
  /** 同步托盘角标(仅桌面端,fire-and-forget)。 */
  syncTray(projects: Project[], theme: string): void;

  /** 窗口控制;非桌面端为 null。 */
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onResized(cb: () => void): Unsubscribe;
  } | null;
}

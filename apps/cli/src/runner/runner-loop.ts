import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  ExecutionJob,
  LogStream,
  RunLogEntry,
  RunnerAttemptReconcileResult,
  WorkerKind
} from "@maple/protocol";
import { MapleApiClient } from "../api/client";
import { CLI_CAPABILITIES } from "../capabilities";
import { loadConfig, saveConfig } from "../config/store";
import type { CliConfig, LocalProject } from "../config/types";
import { deepSeekCredentialRevision } from "../credentials/deepseek";
import { DeliveryOutbox, resolveOutboxPath } from "../delivery/outbox";
import { buildExecutionPrompt } from "../execution/prompt";
import { executeWorker, type WorkerExecutor } from "../execution/process-executor";
import { resolvePlaywrightExecutable } from "../execution/playwright-runtime";
import { formatRunLogEntry } from "../execution/run-log";
import {
  prepareScreenshotDirectory,
  collectScreenshotArtifacts
} from "../execution/screenshot-artifacts";
import type { WorkerShell } from "../execution/shells";
import { detectCodingAgentTools, toWorkerInventory } from "../execution/tool-availability";
import {
  runProjectManager,
  type ProjectManagerDiagnosticEvent
} from "../manager/project-manager";
import { selectProjectManagerWorkerForJob } from "../manager/decision";
import { runProjectManagerFailureReport } from "../manager/failure-report";
import type { DirectoryPicker } from "../project/directory-picker";
import { AgentSessionStore } from "../session/store";
import { handleRunnerCommand } from "./runner-command-handler";

const CLI_VERSION = "0.1.7";
const RUNNER_COMMAND_POLL_MS = 1_500;
/** Server 连接失败后的固定重试间隔（用户要求每秒重试，不做指数退避）。 */
const CONNECTION_RETRY_MS = 1_000;

/** Bun/undici 的网络层报错是英文（如 "Unable to connect…"），统一翻成面向用户的中文描述。 */
function describeConnectionError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/unable to connect|fetch failed|econnrefused|enotfound|etimedout|econnreset|eai_again|socket/i.test(raw)) {
    return "无法连接 Server（请确认服务已启动、地址可访问）";
  }
  return raw;
}

/** Runner 与 Server 的连接状态，TUI 状态行使用。 */
export interface RunnerConnectionStatus {
  state: "connecting" | "online" | "interrupted" | "error";
  message: string;
}

/** 带运行上下文的统一事件，TUI 无需从并发输出文本中反推事件归属。 */
export interface RunnerRunEvent extends RunLogEntry {
  slot: number;
  attemptId: string;
  todoId: string;
  todoTitle: string;
  projectId: string;
  projectName: string;
  workerKind: WorkerKind;
}

export type ProjectManagerActivityState = "idle" | "diagnosing" | "dispatched" | "failed";

/** 项目经理与 Worker 槽位分开上报，TUI 可在项目行展示其独立生命周期。 */
export interface ProjectManagerActivity {
  projectId: string;
  projectName: string;
  state: ProjectManagerActivityState;
  managerWorkerKind?: WorkerKind;
  selectedWorkerKind?: WorkerKind;
}

/** PM 日志与 Worker 槽位隔离，避免并发输出失去归属。 */
export interface ProjectManagerRunEvent extends ProjectManagerDiagnosticEvent {
  todoId: string;
  todoTitle: string;
  projectId: string;
  projectName: string;
}

/** Runner 运行期的所有终端输出都经过这个出口，TUI 可以接管渲染。 */
export interface RunnerOutput {
  /** slot 存在时属于某个 Worker 槽位，否则是全局信息。 */
  info(message: string, slot?: number): void;
  warn(message: string): void;
  /** 兼容旧终端输出；实现 record 后，Worker 事件不会再经此回调重复发送。 */
  worker(stream: LogStream, chunk: string, slot?: number): void;
  /** Coding Agent adapter 归一化后的结构化运行事件。 */
  record?(event: RunnerRunEvent): void;
  /** 项目经理的结构化诊断事件，不写入 Worker 执行报告。 */
  managerRecord?(event: ProjectManagerRunEvent): void;
  active?(count: number): void;
  /** 连接状态变化时触发（已去重）。 */
  connection?(status: RunnerConnectionStatus): void;
  jobStarted?(slot: number, title: string, projectName: string, workerKind: WorkerKind): void;
  jobFinished?(slot: number, title: string, success: boolean): void;
  managerStatus?(activity: ProjectManagerActivity): void;
}

export interface RunnerLoopOptions {
  configPath: string;
  output?: RunnerOutput;
  workerShell?: WorkerShell;
  directoryPicker?: DirectoryPicker;
  projectManagerRunner?: typeof runProjectManager;
  projectManagerFailureReporter?: typeof runProjectManagerFailureReport;
  workerExecutor?: WorkerExecutor;
  sessionStore?: AgentSessionStore;
  outbox?: DeliveryOutbox;
  playwrightExecutable?: string | null;
}

export const consoleRunnerOutput: RunnerOutput = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  worker: (stream, chunk) => {
    if (stream === "stderr") process.stderr.write(chunk);
    else process.stdout.write(chunk);
  },
  managerRecord: (event) => console.log(`[PM · ${event.projectName}] ${formatRunLogEntry(event)}`)
};

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

interface AttemptController {
  supersede(): void;
  forceTerminate(): void;
}

export class RunnerLoop {
  private readonly active = new Set<Promise<void>>();
  private commandTask: Promise<void> | null = null;
  private managerTask: Promise<void> | null = null;
  private config: CliConfig;
  private readonly configPath: string;
  private readonly dataDirectory: string;
  private readonly directoryPicker?: DirectoryPicker;
  private readonly output: RunnerOutput;
  private readonly projectManagerRunner: typeof runProjectManager;
  private readonly projectManagerFailureReporter: typeof runProjectManagerFailureReport;
  private readonly workerExecutor: WorkerExecutor;
  private readonly sessionStore: AgentSessionStore;
  private readonly outbox: DeliveryOutbox;
  private readonly ownsOutbox: boolean;
  private readonly workerShell: WorkerShell;
  private readonly playwrightExecutable: string | null;
  /** 空闲 Worker 槽位序号，执行 Todo 时占用、收尾后归还。 */
  private readonly freeSlots: number[];
  private connectionMessage = "";
  private readonly attemptControllers = new Map<string, AttemptController>();
  private forceTerminationRequested = false;
  private readonly deliveryFailures = new Map<string, string>();

  constructor(
    private readonly api: MapleApiClient,
    config: CliConfig,
    private readonly concurrency: number,
    options: RunnerLoopOptions
  ) {
    this.config = config;
    this.configPath = resolve(options.configPath);
    this.dataDirectory = dirname(this.configPath);
    this.directoryPicker = options.directoryPicker;
    this.output = options.output ?? consoleRunnerOutput;
    this.projectManagerRunner = options.projectManagerRunner ?? runProjectManager;
    this.projectManagerFailureReporter = options.projectManagerFailureReporter ?? runProjectManagerFailureReport;
    this.workerExecutor = options.workerExecutor ?? executeWorker;
    this.sessionStore = options.sessionStore ?? new AgentSessionStore(options.configPath);
    this.outbox = options.outbox ?? new DeliveryOutbox(resolveOutboxPath(this.configPath));
    this.ownsOutbox = options.outbox === undefined;
    this.workerShell = options.workerShell ?? "direct";
    this.playwrightExecutable = options.playwrightExecutable === undefined
      ? resolvePlaywrightExecutable()
      : options.playwrightExecutable;
    this.freeSlots = Array.from({ length: Math.max(1, concurrency) }, (_, index) => index);
  }

  /** 本机主动添加项目后，立即让正在运行的领取循环使用最新目录映射。 */
  replaceConfig(config: CliConfig): void {
    this.config = config;
  }

  /** TUI 二次确认后的硬终止入口；对所有正在执行的 Worker / PM 进程树幂等生效。 */
  forceTerminate(): void {
    this.forceTerminationRequested = true;
    for (const controller of this.attemptControllers.values()) controller.forceTerminate();
  }

  private setConnection(state: RunnerConnectionStatus["state"], message: string): void {
    if (message === this.connectionMessage) return;
    this.connectionMessage = message;
    this.output.connection?.({ state, message });
  }

  async run(signal: AbortSignal): Promise<void> {
    this.output.info(`[maple] 已连接 ${this.api.serverUrl}`);
    this.output.info(`[maple] 已注册 ${this.config.projects.filter((project) => project.projectId).length} 个项目，并发数 ${this.concurrency}`);
    this.output.info("[maple] 正在等待 Todo。按 Ctrl+C 安全停止。\n");
    this.setConnection("connecting", "正在连接 Server…");

    let heartbeatAt = 0;
    let credentialRevision = deepSeekCredentialRevision();
    while (!signal.aborted && !this.forceTerminationRequested) {
      try {
        const nextCredentialRevision = deepSeekCredentialRevision();
        if (nextCredentialRevision !== credentialRevision) {
          credentialRevision = nextCredentialRevision;
          heartbeatAt = 0;
        }
        if (Date.now() >= heartbeatAt) {
          // 每次心跳重新探测；连接或移除 Provider 后无需重启 Runner。
          const tools = detectCodingAgentTools();
          const supportedWorkers = tools
            .filter((tool) => tool.available)
            .map((tool) => tool.kind);
          const workerInventory = toWorkerInventory(tools);
          const heartbeat = await this.api.heartbeat(
            CLI_VERSION,
            supportedWorkers,
            [...CLI_CAPABILITIES],
            workerInventory
          );
          if (heartbeat && typeof heartbeat === "object" && "workspace" in heartbeat && this.config.runner) {
            const workspace = heartbeat.workspace;
            if (
              workspace
              && (this.config.runner.workspaceId !== workspace.id || this.config.runner.workspaceName !== workspace.name)
            ) {
              this.config = {
                ...this.config,
                runner: {
                  ...this.config.runner,
                  workspaceId: workspace.id,
                  workspaceName: workspace.name
                }
              };
              saveConfig(this.config, this.configPath);
            }
          }
          await this.reconcileAndFlush();
          heartbeatAt = Date.now() + 10_000;
        }
        await this.flushOutbox();
        await this.claimRunnerCommand(signal);
        await this.claimProjectManagerJob(signal);

        let claimedAny = false;
        while (!signal.aborted && this.active.size < this.concurrency) {
          const response = await this.api.claim();
          if (!response.job) {
            if (!claimedAny) await wait(Math.min(response.retryAfterMs, RUNNER_COMMAND_POLL_MS), signal);
            break;
          }
          claimedAny = true;
          const slot = this.freeSlots.shift()!;
          const task = this.execute(response.job, signal, slot).finally(() => {
            this.active.delete(task);
            this.freeSlots.push(slot);
            this.freeSlots.sort((a, b) => a - b);
            this.output.active?.(this.active.size);
          });
          this.active.add(task);
          this.output.active?.(this.active.size);
        }
        this.setConnection("online", `已连接 ${this.api.serverUrl}`);
        if (this.active.size >= this.concurrency) {
          await Promise.race([...this.active, wait(RUNNER_COMMAND_POLL_MS, signal)]);
        }
      } catch (error) {
        const detail = describeConnectionError(error);
        const status = `连接中断：${detail}，1 秒后重试`;
        // 同样的错误每秒重复时只在状态行刷新，不重复刷日志行。
        if (status !== this.connectionMessage) {
          this.output.warn(`[maple] Server 连接异常：${detail}，1 秒后重试。`);
        }
        this.setConnection("interrupted", status);
        await wait(CONNECTION_RETRY_MS, signal);
      }
    }

    if (this.active.size > 0) {
      this.output.info(`[maple] 正在结束 ${this.active.size} 个运行中的 Worker…`);
    }
    const settling = [...this.active];
    if (this.commandTask) settling.push(this.commandTask);
    if (this.managerTask) settling.push(this.managerTask);
    if (settling.length > 0) await Promise.allSettled(settling);
    if (this.ownsOutbox) this.outbox.close();
  }

  private async execute(job: ExecutionJob, signal: AbortSignal, slot: number): Promise<void> {
    const project = this.projectForJob(job);
    const jobController = new AbortController();
    const forceController = new AbortController();
    const abortJob = () => jobController.abort();
    signal.addEventListener("abort", abortJob, { once: true });
    if (signal.aborted) abortJob();
    let leaseLost = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let jobSucceeded = false;
    let screenshotDirectory: string | null = null;
    let nextLogSequence = 0;
    const recentLogs: RunLogEntry[] = [];
    this.outbox.registerAttempt({
      scope: "execution",
      todoId: job.todo.id,
      attemptId: job.attempt.id,
      leaseToken: job.leaseToken,
      leaseSeconds: job.leaseSeconds
    });
    this.outbox.enqueueStart(job.attempt.id);
    const attemptController: AttemptController = {
      supersede: () => {
        leaseLost = true;
        jobController.abort();
      },
      forceTerminate: () => {
        forceController.abort();
        jobController.abort();
      }
    };
    this.attemptControllers.set(job.attempt.id, attemptController);
    if (this.forceTerminationRequested) attemptController.forceTerminate();
    this.output.jobStarted?.(slot, job.todo.title, job.project.name, job.attempt.workerKind);
    this.output.info(`\n[maple] 领取 Todo：${job.todo.title}`, slot);
    const queueLog = (entry: RunLogEntry): Promise<void> => {
      const normalizedEntry = { ...entry, sequence: nextLogSequence++ };
      recentLogs.push(normalizedEntry);
      if (recentLogs.length > 20) recentLogs.shift();
      const runEvent: RunnerRunEvent = {
        ...normalizedEntry,
        slot,
        attemptId: job.attempt.id,
        todoId: job.todo.id,
        todoTitle: job.todo.title,
        projectId: job.project.id,
        projectName: job.project.name,
        workerKind: job.attempt.workerKind
      };
      if (this.output.record) this.output.record(runEvent);
      else this.output.worker(normalizedEntry.stream, `${formatRunLogEntry(normalizedEntry)}\n`, slot);
      if (this.outbox.hasAttempt(job.attempt.id)) this.outbox.enqueueLog(job.attempt.id, normalizedEntry);
      return Promise.resolve();
    };

    try {
      const heartbeatMs = Math.max(5_000, Math.floor((job.leaseSeconds * 1000) / 3));
      heartbeat = setInterval(() => {
        void this.api.heartbeatJob(job.todo.id, job.leaseToken).catch((error) => {
          this.output.warn(`[maple] Todo 租约续期失败：${error instanceof Error ? error.message : String(error)}`);
        });
      }, heartbeatMs);

      const screenshotEnabled = job.acceptanceSettings?.backgroundPlaywrightScreenshot
        ?? job.attempt.acceptanceSettings?.backgroundPlaywrightScreenshot
        ?? false;
      let screenshotPreparationError: string | null = null;
      if (project && existsSync(project.path) && screenshotEnabled) {
        if (!this.playwrightExecutable) {
          screenshotPreparationError = "Playwright 未安装。请运行 Maple Playwright 安装器后重启 CLI。";
        } else {
          try {
            screenshotDirectory = await prepareScreenshotDirectory(this.dataDirectory, job.attempt.id);
          } catch (error) {
            screenshotPreparationError = error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (screenshotPreparationError) {
        await queueLog({
          sequence: 0,
          occurredAt: new Date().toISOString(),
          stream: "system",
          kind: "warning",
          level: "warning",
          status: "progress",
          title: "截图验收不可用",
          content: `可选截图验收暂不可用，本次任务继续按 Worker 结果执行：${screenshotPreparationError}`
        });
      }

      let result;
      if (!project || !existsSync(project.path)) {
        result = {
          success: false,
          exitCode: null,
          summary: "",
          error: project ? `本机项目目录不可用：${project.path}` : "本机没有这个项目的目录映射。"
        };
        await queueLog({
          sequence: 0,
          occurredAt: new Date().toISOString(),
          stream: "system",
          kind: "error",
          level: "error",
          status: "failed",
          title: "项目目录不可用",
          content: result.error
        });
      } else {
        const workflowId = job.workflowExecutionMode === "serial" ? job.workflow?.id : undefined;
        const existingSession = workflowId
          ? this.sessionStore.read("workflow", workflowId, job.attempt.workerKind)
          : null;
        const run = (resumeSessionId?: string) => this.workerExecutor({
          workerKind: job.attempt.workerKind,
          cwd: project.path,
          prompt: buildExecutionPrompt(job, {
            resumingWorkflowSession: Boolean(resumeSessionId),
            screenshotDirectory: screenshotDirectory ?? undefined,
            playwrightExecutable: this.playwrightExecutable ?? undefined
          }),
          signal: jobController.signal,
          forceSignal: forceController.signal,
          shell: this.workerShell,
          summaryMode: "report",
          resumeSessionId,
          additionalWritableDirectories: screenshotDirectory ? [screenshotDirectory] : undefined,
          onSession: workflowId
            ? (sessionId) => {
                this.sessionStore.save({
                  scope: "workflow",
                  scopeId: workflowId,
                  workerKind: job.attempt.workerKind,
                  sessionId
                });
              }
            : undefined,
          onLog: queueLog
        });

        result = await run(existingSession?.sessionId);
        if (workflowId && existingSession && result.sessionUnavailable && !jobController.signal.aborted) {
          this.sessionStore.remove("workflow", workflowId, job.attempt.workerKind);
          await queueLog({
            sequence: 0,
            occurredAt: new Date().toISOString(),
            stream: "system",
            kind: "warning",
            level: "warning",
            status: "progress",
            title: "Worker 会话已重建",
            content: "原 Worker session 已失效，正在从项目经理派单上下文建立新会话。"
          });
          result = await run();
        }
        if (workflowId && result.success && !result.sessionId) {
          result = {
            ...result,
            success: false,
            error: `${job.attempt.workerKind} 没有返回可续接的 session ID。`
          };
        }
        if (workflowId && result.sessionId) {
          this.sessionStore.save({
            scope: "workflow",
            scopeId: workflowId,
            workerKind: job.attempt.workerKind,
            sessionId: result.sessionId
          });
        }
      }

      if (result.success && screenshotDirectory) {
        try {
          const screenshotResult = await collectScreenshotArtifacts(screenshotDirectory);
          for (const artifact of screenshotResult.artifacts) {
            this.outbox.enqueueArtifact(job.attempt.id, artifact);
          }
          for (const warning of screenshotResult.warnings) {
            await queueLog({
              sequence: 0,
              occurredAt: new Date().toISOString(),
              stream: "system",
              kind: "warning",
              level: "warning",
              status: "progress",
              title: "截图验收",
              content: warning
            });
          }
          await queueLog({
            sequence: 0,
            occurredAt: new Date().toISOString(),
            stream: "system",
            kind: screenshotResult.artifacts.length > 0 ? "tool_result" : "warning",
            level: screenshotResult.artifacts.length > 0 ? "info" : "warning",
            status: screenshotResult.artifacts.length > 0 ? "completed" : "progress",
            title: "截图验收",
            content: screenshotResult.artifacts.length > 0
              ? `已收集 ${screenshotResult.artifacts.length} 张真实截图，等待 Server 确认。`
              : "未发现适用的 Playwright 验收截图，本次任务继续按 Worker 结果完成。"
          });
        } catch (error) {
          await queueLog({
            sequence: 0,
            occurredAt: new Date().toISOString(),
            stream: "system",
            kind: "warning",
            level: "warning",
            status: "progress",
            title: "截图验收",
            content: `可选截图收集失败，本次任务继续按 Worker 结果完成：${error instanceof Error ? error.message : String(error)}`
          });
        }
      }

      let failureReport: string | null = null;
      if (!result.success && job.managerWorkerKind && !jobController.signal.aborted && !leaseLost) {
        try {
          const managerWorkspace = this.sessionStore.workspace("manager", job.project.id);
          mkdirSync(managerWorkspace, { recursive: true });
          failureReport = await this.projectManagerFailureReporter({
            projectId: job.project.id,
            managerWorkerKind: job.managerWorkerKind,
            managerWorkspace,
            signal: jobController.signal,
            forceSignal: forceController.signal,
            shell: this.workerShell,
            outputLanguage: job.executionSettings?.aiOutputLanguage,
            sessionStore: this.sessionStore,
            executor: this.workerExecutor,
            onDiagnostic: queueLog,
            failure: {
              stage: "execution",
              projectName: job.project.name,
              todo: job.todo,
              requiredWorkerKind: job.attempt.workerKind,
              exitCode: result.exitCode,
              error: result.error,
              recentLogs: recentLogs.slice()
            }
          });
        } catch (error) {
          await queueLog({
            sequence: 0,
            occurredAt: new Date().toISOString(),
            stream: "system",
            kind: "error",
            level: "error",
            status: "failed",
            title: "Leader PM 报告失败",
            content: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (!result.success) result = { ...result, summary: failureReport ?? "" };

      if (leaseLost) {
        this.output.info(`\n[maple] Todo 租约已撤销，本地 Worker 已停止：${job.todo.title}\n`, slot);
        return;
      }
      this.outbox.enqueueCompletion(job.attempt.id, {
        success: result.success,
        exitCode: result.exitCode,
        summary: result.summary,
        error: result.error ?? undefined,
        usage: result.usage ?? undefined,
        failureDisposition: result.success ? undefined : "blocked"
      });
      await this.flushOutbox();
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      jobSucceeded = result.success;
      const pending = this.outbox.hasAttempt(job.attempt.id);
      const outcome = result.success ? "已完成，等待验收" : "执行失败";
      this.output.info(
        `\n[maple] Todo ${outcome}${pending ? "，结果将在连接恢复后回传" : ""}：${job.todo.title}\n`,
        slot
      );
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      signal.removeEventListener("abort", abortJob);
      this.attemptControllers.delete(job.attempt.id);
      this.output.jobFinished?.(slot, job.todo.title, jobSucceeded);
    }
  }

  private async claimRunnerCommand(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.commandTask) return;
    const claim = await this.api.claimRunnerCommand();
    if (!claim.command || !claim.leaseToken) return;

    let task: Promise<void>;
    task = handleRunnerCommand({
      api: this.api,
      claim,
      configPath: this.configPath,
      signal,
      output: this.output,
      directoryPicker: this.directoryPicker
    })
      .then((config) => {
        this.config = config;
      })
      .catch((error) => {
        this.output.warn(`[maple] 添加项目请求处理失败：${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        if (this.commandTask === task) this.commandTask = null;
      });
    this.commandTask = task;
  }

  private async claimProjectManagerJob(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.managerTask) return;
    const claim = await this.api.claimProjectManagerJob();
    if (!claim.job) return;

    const job = claim.job;
    const managerController = new AbortController();
    const managerForceController = new AbortController();
    const abortManager = () => managerController.abort();
    signal.addEventListener("abort", abortManager, { once: true });
    if (signal.aborted) abortManager();
    this.outbox.registerAttempt({
      scope: "project_manager",
      todoId: job.todo.id,
      attemptId: job.attemptId,
      leaseToken: job.leaseToken,
      leaseSeconds: job.leaseSeconds
    });
    const attemptController: AttemptController = {
      supersede: abortManager,
      forceTerminate: () => {
        managerForceController.abort();
        managerController.abort();
      }
    };
    this.attemptControllers.set(job.attemptId, attemptController);
    if (this.forceTerminationRequested) attemptController.forceTerminate();
    const managerWorkerKind = selectProjectManagerWorkerForJob(job);
    let managerLogSequence = 0;
    const managerActivity = (activity: Omit<ProjectManagerActivity, "projectId" | "projectName">) => {
      this.output.managerStatus?.({
        projectId: job.project.id,
        projectName: job.project.name,
        ...activity
      });
    };
    const managerDiagnostic = async (diagnostic: ProjectManagerDiagnosticEvent): Promise<void> => {
      this.output.managerRecord?.({
        ...diagnostic,
        sequence: managerLogSequence++,
        todoId: job.todo.id,
        todoTitle: job.todo.title,
        projectId: job.project.id,
        projectName: job.project.name
      });
    };
    let task: Promise<void>;
    task = (async () => {
      managerActivity({ state: "diagnosing", managerWorkerKind });
      const project = this.projectForManagerJob(job.project.id);
      if (!project || !existsSync(project.path)) {
        throw new Error("项目经理无法读取当前项目目录。");
      }
      this.output.info(`[maple] 项目经理正在快速诊断：${job.todo.title}`);
      const managerDirectory = this.sessionStore.workspace("manager", job.project.id);
      mkdirSync(managerDirectory, { recursive: true });
      const dispatch = await this.projectManagerRunner(
        job,
        project,
        managerController.signal,
        this.workerShell,
        managerDirectory,
        this.sessionStore,
        undefined,
        managerDiagnostic,
        managerForceController.signal
      );
      if (dispatch.outcome === "blocked") {
        this.outbox.enqueueManagerBlock(job.attemptId, {
          managerWorkerKind: dispatch.managerWorkerKind,
          report: dispatch.report
        });
        await this.flushOutbox();
        managerActivity({ state: "failed", managerWorkerKind: dispatch.managerWorkerKind });
        this.output.info(`[maple] 项目经理已阻塞“${job.todo.title}”，未改派其他 Worker。`);
        return;
      }
      this.outbox.enqueueManagerComplete(job.attemptId, {
        managerWorkerKind: dispatch.managerWorkerKind,
        ...dispatch.decision
      });
      await this.flushOutbox();
      managerActivity({
        state: "dispatched",
        managerWorkerKind: dispatch.managerWorkerKind,
        selectedWorkerKind: dispatch.decision.selectedWorkerKind
      });
      this.output.info(
        `[maple] 项目经理已将“${job.todo.title}”派给 ${dispatch.decision.selectedWorkerKind}，正在唤起 Worker tab。`
      );
    })()
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        await managerDiagnostic({
          sequence: 0,
          occurredAt: new Date().toISOString(),
          stream: "system",
          kind: "error",
          level: "error",
          status: "failed",
          title: "项目经理派单失败",
          content: message,
          managerWorkerKind
        });
        managerActivity({ state: "failed" });
        this.output.warn(`[maple] 项目经理派单失败：${message}`);
        if (!managerController.signal.aborted && this.outbox.hasAttempt(job.attemptId)) {
          this.outbox.enqueueManagerBlock(job.attemptId, {
            managerWorkerKind,
            technicalError: message
          });
          await this.flushOutbox();
        }
      })
      .finally(() => {
        signal.removeEventListener("abort", abortManager);
        this.attemptControllers.delete(job.attemptId);
        if (this.managerTask === task) this.managerTask = null;
      });
    this.managerTask = task;
  }

  private async reconcileAndFlush(): Promise<void> {
    const reconcilable = new Set(this.reconcilableAttemptIds());
    const references = this.outbox.references().filter((reference) => reconcilable.has(reference.attemptId));
    const results: RunnerAttemptReconcileResult[] = [];
    for (let offset = 0; offset < references.length; offset += 200) {
      const response = await this.api.reconcile({ attempts: references.slice(offset, offset + 200) });
      results.push(...response.attempts);
    }
    for (const result of results) {
      if (result.state === "superseded") this.attemptControllers.get(result.attemptId)?.supersede();
    }
    const warnings = await this.outbox.applyReconciliation(results);
    for (const warning of warnings) this.output.warn(`[maple] ${warning}`);
    await this.flushOutbox();
  }

  private async flushOutbox(): Promise<void> {
    const result = await this.outbox.flush(this.api, this.flushableAttemptIds());
    for (const warning of result.warnings) this.output.warn(`[maple] ${warning.message}`);
    const currentFailures = new Set<string>();
    for (const failure of result.failures) {
      currentFailures.add(failure.attemptId);
      if (this.deliveryFailures.get(failure.attemptId) !== failure.message) {
        this.deliveryFailures.set(failure.attemptId, failure.message);
        this.output.warn(`[maple] 回传队列等待重试：${failure.message}`);
      }
    }
    for (const attemptId of this.deliveryFailures.keys()) {
      if (!currentFailures.has(attemptId)) this.deliveryFailures.delete(attemptId);
    }
  }

  private reconcilableAttemptIds(): string[] {
    return this.outbox.references()
      .filter((reference) => (
        this.attemptControllers.has(reference.attemptId)
        || this.outbox.hasTerminalMessage(reference.attemptId)
        || this.outbox.hasTerminalServerState(reference.attemptId)
      ))
      .map((reference) => reference.attemptId);
  }

  private flushableAttemptIds(): string[] {
    return this.outbox.references()
      .filter((reference) => (
        !this.outbox.hasTerminalServerState(reference.attemptId)
        && (
          this.attemptControllers.has(reference.attemptId)
          || this.outbox.hasTerminalMessage(reference.attemptId)
        )
      ))
      .map((reference) => reference.attemptId);
  }

  private projectForJob(job: ExecutionJob): LocalProject | null {
    const current = this.config.projects.find((project) => project.projectId === job.project.id);
    if (current) return current;

    // 项目可能刚由目录选择命令注册完成；从原子写入的本机配置重新加载一次。
    this.config = loadConfig(this.configPath);
    return this.config.projects.find((project) => project.projectId === job.project.id) ?? null;
  }

  private projectForManagerJob(projectId: string): LocalProject | null {
    const current = this.config.projects.find((project) => project.projectId === projectId);
    if (current) return current;
    this.config = loadConfig(this.configPath);
    return this.config.projects.find((project) => project.projectId === projectId) ?? null;
  }
}

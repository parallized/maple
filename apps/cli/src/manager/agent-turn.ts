import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WorkerKind } from "@maple/protocol";
import { executeWorker, type ProcessExecutionResult, type WorkerExecutor } from "../execution/process-executor";
import type { WorkerShell } from "../execution/shells";
import { computeUsageDelta, isCumulativeUsageWorker } from "../execution/usage-delta";
import { AgentSessionStore } from "../session/store";
import type { ProjectManagerDiagnosticHandler } from "./project-manager";
import {
  createLeaderTimeoutWatchdog,
  leaderHardTimeoutMessage,
  leaderIdleTimeoutMessage,
  type LeaderTimeoutReason
} from "./leader-timeout";

/** 兼容旧名：等同 Leader 空闲超时。 */
export {
  DEFAULT_MANAGER_HARD_TIMEOUT_MS,
  DEFAULT_MANAGER_IDLE_TIMEOUT_MS,
  DEFAULT_MANAGER_TIMEOUT_MS
} from "./leader-timeout";

interface ManagerPromptContext {
  resuming: boolean;
  existingContextFingerprint: string | null;
}

export interface ManagerAgentTurnOptions {
  projectId: string;
  managerWorkerKind: WorkerKind;
  managerWorkspace: string;
  signal: AbortSignal;
  forceSignal?: AbortSignal;
  shell: WorkerShell;
  buildPrompt(context: ManagerPromptContext): string;
  contextFingerprint?: string | null;
  sessionStore?: AgentSessionStore;
  executor?: WorkerExecutor;
  summaryMode?: "raw" | "report" | "strict-report";
  onDiagnostic?: ProjectManagerDiagnosticHandler;
  /** Leader 默认按 Todo 新建会话，避免长期会话让上下文与 token 持续膨胀。 */
  reuseSession?: boolean;
  /** 覆盖 Leader PM 的“无动静”空闲上限（默认 30 秒），主要供测试和受控运行环境使用。 */
  timeoutMs?: number;
  /** 覆盖 Leader PM 单次派单的总时长兜底（默认 2 分钟），防止看似有动静实则卡死。 */
  hardTimeoutMs?: number;
}

/** 统一维护 Leader PM 的 Provider session、超时与诊断事件。 */
export async function runManagerAgentTurn(
  options: ManagerAgentTurnOptions
): Promise<ProcessExecutionResult> {
  const executor = options.executor ?? executeWorker;
  const reuseSession = options.reuseSession ?? false;
  const existingSession = reuseSession
    ? options.sessionStore?.read("manager", options.projectId, options.managerWorkerKind) ?? null
    : null;
  // Leader 复用 Codex / DeepSeek 会话时同样需要把累计用量换算成单次增量。
  let usageBaseline = reuseSession && isCumulativeUsageWorker(options.managerWorkerKind)
    ? options.sessionStore?.readUsageBaseline("manager", options.projectId, options.managerWorkerKind) ?? null
    : null;
  if (!reuseSession) {
    options.sessionStore?.remove("manager", options.projectId, options.managerWorkerKind);
  }
  const isolatedHome = options.managerWorkerKind === "deepseek"
    ? join(options.managerWorkspace, "deepseek-codex-home")
    : undefined;
  if (isolatedHome) mkdirSync(isolatedHome, { recursive: true });
  const controller = new AbortController();
  const stoppedMessage = "Maple CLI 已停止，Leader PM 派单已取消。";
  const forceStoppedMessage = "Maple CLI 已强制终止，Leader PM 派单已取消。";
  let timeoutReason: LeaderTimeoutReason | null = null;
  const abort = () => controller.abort(stoppedMessage);
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const watchdog = createLeaderTimeoutWatchdog((reason, message) => {
    timeoutReason = reason;
    controller.abort(message);
  }, {
    timeoutMs: options.timeoutMs,
    hardTimeoutMs: options.hardTimeoutMs
  });

  const run = (resumeSessionId?: string) => {
    watchdog.markActivity();
    return executor({
      workerKind: options.managerWorkerKind,
      cwd: options.managerWorkspace,
      prompt: options.buildPrompt({
        resuming: Boolean(resumeSessionId),
        existingContextFingerprint: existingSession?.contextFingerprint ?? null
      }),
      signal: controller.signal,
      forceSignal: options.forceSignal,
      shell: options.shell,
      readOnly: true,
      reasoningEffort: "low",
      disableMcp: true,
      isolatedHome,
      completeOnTerminalEvent: true,
      summaryMode: options.summaryMode,
      resumeSessionId,
      onSession: reuseSession ? (sessionId) => {
        watchdog.markActivity();
        options.sessionStore?.save({
          scope: "manager",
          scopeId: options.projectId,
          workerKind: options.managerWorkerKind,
          sessionId,
          contextFingerprint: options.contextFingerprint
        });
      } : undefined,
      onLog: async (entry) => {
        watchdog.markActivity();
        await options.onDiagnostic?.({ ...entry, managerWorkerKind: options.managerWorkerKind });
      }
    });
  };

  try {
    let result = await run(existingSession?.sessionId);
    if (existingSession && result.sessionUnavailable && !controller.signal.aborted && !options.forceSignal?.aborted) {
      options.sessionStore?.remove("manager", options.projectId, options.managerWorkerKind);
      usageBaseline = null;
      result = await run();
    }
    if (options.forceSignal?.aborted) throw new Error(forceStoppedMessage);
    if (options.signal.aborted) throw new Error(stoppedMessage);
    if (timeoutReason) {
      throw new Error(timeoutReason === "hard"
        ? leaderHardTimeoutMessage(watchdog.config.hardTimeoutMs)
        : leaderIdleTimeoutMessage(watchdog.config.idleTimeoutMs));
    }
    if (!result.success) {
      throw new Error(result.error || "项目经理 Coding Agent 没有完成任务。");
    }
    if (reuseSession && options.sessionStore && !result.sessionId) {
      throw new Error(`${options.managerWorkerKind} 没有返回可续接的 session ID。`);
    }
    if (reuseSession && result.sessionId) {
      options.sessionStore?.save({
        scope: "manager",
        scopeId: options.projectId,
        workerKind: options.managerWorkerKind,
        sessionId: result.sessionId,
        contextFingerprint: options.contextFingerprint
      });
    }
    if (result.usage && isCumulativeUsageWorker(options.managerWorkerKind)) {
      const cumulative = result.usage;
      result = {
        ...result,
        usage: computeUsageDelta(cumulative, usageBaseline)
      };
      if (result.sessionId) {
        options.sessionStore?.saveUsageBaseline(
          "manager",
          options.projectId,
          options.managerWorkerKind,
          cumulative
        );
      }
    }
    return result;
  } finally {
    watchdog.dispose();
    options.signal.removeEventListener("abort", abort);
  }
}

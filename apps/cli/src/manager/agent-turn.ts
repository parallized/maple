import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WorkerKind } from "@maple/protocol";
import { executeWorker, type ProcessExecutionResult, type WorkerExecutor } from "../execution/process-executor";
import type { WorkerShell } from "../execution/shells";
import { AgentSessionStore } from "../session/store";
import type { ProjectManagerDiagnosticHandler } from "./project-manager";

export const DEFAULT_MANAGER_TIMEOUT_MS = 30_000;

function managerTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1_000));
  const duration = seconds % 60 === 0
    ? `${seconds / 60} 分钟`
    : `${seconds} 秒`;
  return `Leader PM 执行超过 ${duration}，已自动停止本次派单。`;
}

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
  /** 覆盖 Leader PM 的单次执行上限，主要供测试和受控运行环境使用。 */
  timeoutMs?: number;
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_MANAGER_TIMEOUT_MS;
  const timeoutMessage = managerTimeoutMessage(timeoutMs);
  let timedOut = false;
  const abort = () => controller.abort(stoppedMessage);
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutMessage);
  }, timeoutMs);

  const run = (resumeSessionId?: string) => executor({
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
      options.sessionStore?.save({
        scope: "manager",
        scopeId: options.projectId,
        workerKind: options.managerWorkerKind,
        sessionId,
        contextFingerprint: options.contextFingerprint
      });
    } : undefined,
    onLog: async (entry) => {
      await options.onDiagnostic?.({ ...entry, managerWorkerKind: options.managerWorkerKind });
    }
  });

  try {
    let result = await run(existingSession?.sessionId);
    if (existingSession && result.sessionUnavailable && !controller.signal.aborted && !options.forceSignal?.aborted) {
      options.sessionStore?.remove("manager", options.projectId, options.managerWorkerKind);
      result = await run();
    }
    if (options.forceSignal?.aborted) throw new Error(forceStoppedMessage);
    if (options.signal.aborted) throw new Error(stoppedMessage);
    if (timedOut) throw new Error(timeoutMessage);
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
    return result;
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", abort);
  }
}

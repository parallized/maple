import type { WorkerKind } from "@maple/protocol";
import { executeWorker, type ProcessExecutionResult, type WorkerExecutor } from "../execution/process-executor";
import type { WorkerShell } from "../execution/shells";
import { AgentSessionStore } from "../session/store";
import type { ProjectManagerDiagnosticHandler } from "./project-manager";

const MANAGER_TIMEOUT_MS = 90_000;

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
}

/** 统一维护 Leader PM 的 Provider session、超时与诊断事件。 */
export async function runManagerAgentTurn(
  options: ManagerAgentTurnOptions
): Promise<ProcessExecutionResult> {
  const executor = options.executor ?? executeWorker;
  const existingSession = options.sessionStore?.read(
    "manager",
    options.projectId,
    options.managerWorkerKind
  ) ?? null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const timeout = setTimeout(abort, MANAGER_TIMEOUT_MS);

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
    summaryMode: options.summaryMode,
    resumeSessionId,
    onSession: (sessionId) => {
      options.sessionStore?.save({
        scope: "manager",
        scopeId: options.projectId,
        workerKind: options.managerWorkerKind,
        sessionId,
        contextFingerprint: options.contextFingerprint
      });
    },
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
    if (options.signal.aborted || options.forceSignal?.aborted) {
      throw new Error("Maple CLI 已停止，项目经理任务已取消。");
    }
    if (!result.success) {
      throw new Error(result.error || "项目经理 Coding Agent 没有完成任务。");
    }
    if (options.sessionStore && !result.sessionId) {
      throw new Error(`${options.managerWorkerKind} 没有返回可续接的 session ID。`);
    }
    if (result.sessionId) {
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

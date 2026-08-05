import type { RunLogEntry, TokenUsage, WorkerKind } from "@maple/protocol";
import { readDeepSeekApiKey } from "../credentials/deepseek";
import { getCodingAgentAdapter } from "./adapters/registry";
import type { AgentOutputParser, AgentRunEventDraft } from "./adapters/types";
import { detectPermissionBlocker } from "./permission-blocker";
import {
  forceTerminateProcessTree,
  reapCompletedProcessTree,
  terminateProcessTree
} from "./process-termination";
import { ExecutionReportCollector } from "./report";
import { createSecretRedactor } from "./secret-redaction";
import type { WorkerShell } from "./shells";
import { describeWindowsSandboxFailure, isCodexSandboxSession } from "./windows-sandbox";
import { buildResolvedWorkerCommand } from "./worker-command";

const MAX_CAPTURE_CHARS = 200_000;
const MAX_LOG_CHUNK_CHARS = 32_000;

type PipedSpawnOptions = Bun.SpawnOptions.OptionsObject<Bun.SpawnOptions.Writable, "pipe", "pipe">;
type PipedSubprocess = Bun.Subprocess<Bun.SpawnOptions.Writable, "pipe", "pipe">;

export type ProcessSpawner = (command: string[], options: PipedSpawnOptions) => PipedSubprocess;

export interface ProcessExecutionOptions {
  workerKind: WorkerKind;
  cwd: string;
  prompt: string;
  signal: AbortSignal;
  /** 独立于正常取消的硬终止信号，用于杀掉不响应退出请求的完整 Worker 进程树。 */
  forceSignal?: AbortSignal;
  shell?: WorkerShell;
  readOnly?: boolean;
  /** Optional per-run reasoning override, primarily used for the lightweight Leader turn. */
  reasoningEffort?: string;
  /** Do not attach Maple MCP configuration to this run. */
  disableMcp?: boolean;
  /** Provider-specific home directory used to isolate this run from user-global configuration. */
  isolatedHome?: string;
  /** Return as soon as the adapter emits its authoritative execution-completed lifecycle event. */
  completeOnTerminalEvent?: boolean;
  summaryMode?: "raw" | "report" | "strict-report";
  resumeSessionId?: string;
  additionalWritableDirectories?: string[];
  /** Server 下发的单次运行凭据；只保留在当前任务内存中。 */
  deepSeekApiKey?: string;
  /** 跳过启动前宿主预检（测试或调用方已自行处理宿主环境时使用）。 */
  skipPreparation?: boolean;
  /** Session 一经 Provider 确认就立即持久化，避免长任务中途退出后丢失续接点。 */
  onSession?: (sessionId: string) => void;
  onLog: (entry: RunLogEntry) => Promise<void>;
  /** Process launcher injection used by lifecycle tests. */
  spawnProcess?: ProcessSpawner;
}

export interface ProcessExecutionResult {
  success: boolean;
  exitCode: number | null;
  summary: string;
  error: string | null;
  usage: TokenUsage | null;
  sessionId: string | null;
  sessionUnavailable: boolean;
}

export type WorkerExecutor = (options: ProcessExecutionOptions) => Promise<ProcessExecutionResult>;

function executionEnvironment(
  workerKind: WorkerKind,
  runtimeDeepSeekApiKey?: string
): Record<string, string | undefined> {
  if (workerKind !== "deepseek") return process.env;
  const runtimeKey = runtimeDeepSeekApiKey?.trim();
  if (runtimeKey) return { ...process.env, DEEPSEEK_API_KEY: runtimeKey };
  try {
    const apiKey = readDeepSeekApiKey();
    return apiKey ? { ...process.env, DEEPSEEK_API_KEY: apiKey } : process.env;
  } catch {
    // 凭据读取异常会让 DeepSeek CLI 返回标准鉴权错误；这里绝不打印或持久化密钥。
    return process.env;
  }
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function tail(value: string, length: number): string {
  const clean = stripAnsi(value).trim();
  return clean.length <= length ? clean : clean.slice(-length).trimStart();
}

function splitEvent(event: AgentRunEventDraft): AgentRunEventDraft[] {
  if (event.content.length <= MAX_LOG_CHUNK_CHARS) return [event];
  const chunks: AgentRunEventDraft[] = [];
  for (let offset = 0; offset < event.content.length; offset += MAX_LOG_CHUNK_CHARS) {
    chunks.push({
      ...event,
      content: event.content.slice(offset, offset + MAX_LOG_CHUNK_CHARS),
      status: offset + MAX_LOG_CHUNK_CHARS >= event.content.length ? event.status : "progress"
    });
  }
  return chunks;
}

async function consumeStream(
  stream: ReadableStream<Uint8Array>,
  name: "stdout" | "stderr",
  parser: AgentOutputParser,
  appendRaw: (value: string) => void,
  emit: (events: AgentRunEventDraft[]) => Promise<void>,
  announceSession: () => void,
  signal?: AbortSignal
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    while (!signal?.aborted) {
      const record = await reader.read().catch((error) => {
        if (signal?.aborted) return null;
        throw error;
      });
      if (!record) return;
      if (record.done) break;
      const content = decoder.decode(record.value, { stream: true });
      if (!content) continue;
      appendRaw(content);
      const events = parser.push(name, content);
      announceSession();
      await emit(events);
    }
    if (signal?.aborted) return;
    const tailChunk = decoder.decode();
    if (tailChunk) {
      appendRaw(tailChunk);
      const events = parser.push(name, tailChunk);
      announceSession();
      await emit(events);
    }
    const events = parser.flush(name);
    announceSession();
    await emit(events);
  } finally {
    signal?.removeEventListener("abort", cancel);
    try {
      reader.releaseLock();
    } catch {
      // cancel() may still be settling; the process reaper will close the stream.
    }
  }
}

function isExecutionCompleted(event: AgentRunEventDraft): boolean {
  return event.kind === "lifecycle"
    && event.status === "completed"
    && event.title === "执行完成";
}

function sessionUnavailable(output: string): boolean {
  return /(?:session|conversation|thread|会话).{0,120}(?:not found|does not exist|unknown|invalid|missing|不存在|无效)/is.test(output)
    || /no (?:saved )?(?:session|conversation|thread)/i.test(output);
}

function explicitCancellationMessage(signal: AbortSignal): string | null {
  if (typeof signal.reason !== "string") return null;
  const message = signal.reason.trim();
  return message || null;
}

export async function executeWorker(options: ProcessExecutionOptions): Promise<ProcessExecutionResult> {
  const shell = options.shell ?? "direct";
  const adapter = getCodingAgentAdapter(options.workerKind);
  const parser = adapter.createOutputParser();
  const workerEnv = executionEnvironment(options.workerKind, options.deepSeekApiKey);
  const windowsSandboxBypass = isCodexSandboxSession();
  const command = buildResolvedWorkerCommand(
    options.workerKind,
    options.prompt,
    shell,
    workerEnv,
    undefined,
    {
      readOnly: options.readOnly,
      reasoningEffort: options.reasoningEffort,
      disableMcp: options.disableMcp,
      isolatedHome: options.isolatedHome,
      resumeSessionId: options.resumeSessionId,
      additionalWritableDirectories: options.additionalWritableDirectories,
      windowsSandboxBypass
    }
  );
  const redact = createSecretRedactor([
    options.workerKind === "deepseek" ? command.env?.DEEPSEEK_API_KEY : null
  ]);
  let rawOutput = "";
  let assistantOutput = "";
  let operationalOutput = "";
  const reportCollector = new ExecutionReportCollector();
  let sequence = 0;
  let observedSessionId: string | null = null;
  let terminalCompleted = false;
  let resolveTerminalCompletion: (() => void) | null = null;
  const terminalCompletion = new Promise<void>((resolve) => {
    resolveTerminalCompletion = resolve;
  });

  /** 进程结束后调用：优先让 adapter 从外部数据源补全 usage，否则取流内累积值。 */
  const resolveFinalUsage = (): TokenUsage | null => {
    if (!parser.finalize) return parser.usage();
    const sessionId = observedSessionId ?? options.resumeSessionId ?? null;
    return parser.finalize({ cwd: options.cwd, sessionId }) ?? parser.usage();
  };

  const announceSession = () => {
    const sessionId = parser.sessionId();
    if (!sessionId || sessionId === observedSessionId) return;
    observedSessionId = sessionId;
    options.onSession?.(sessionId);
  };

  const appendRaw = (value: string) => {
    rawOutput = `${rawOutput}${value}`;
    if (rawOutput.length > MAX_CAPTURE_CHARS) rawOutput = rawOutput.slice(-MAX_CAPTURE_CHARS);
  };

  const emit = async (drafts: AgentRunEventDraft[]): Promise<void> => {
    for (const rawDraft of drafts) {
      const draft: AgentRunEventDraft = {
        ...rawDraft,
        content: redact(rawDraft.content),
        ...(rawDraft.title ? { title: redact(rawDraft.title) } : {})
      };
      if (!draft.content) continue;
      reportCollector.push(draft);
      if (draft.kind === "assistant") {
        assistantOutput = `${assistantOutput}${assistantOutput ? "\n" : ""}${draft.content}`;
        if (assistantOutput.length > MAX_CAPTURE_CHARS) assistantOutput = assistantOutput.slice(-MAX_CAPTURE_CHARS);
      } else if (draft.kind !== "reasoning" && draft.kind !== "lifecycle") {
        operationalOutput = `${operationalOutput}${operationalOutput ? "\n" : ""}${draft.content}`;
        if (operationalOutput.length > MAX_CAPTURE_CHARS) operationalOutput = operationalOutput.slice(-MAX_CAPTURE_CHARS);
      }
      for (const part of splitEvent(draft)) {
        const entry: RunLogEntry = {
          ...part,
          sequence: sequence++,
          occurredAt: new Date().toISOString()
        };
        await options.onLog(entry);
      }
      if (options.completeOnTerminalEvent && isExecutionCompleted(draft) && !terminalCompleted) {
        terminalCompleted = true;
        resolveTerminalCompletion?.();
      }
    }
  };

  const via = shell === "direct" ? "" : `（经 ${shell}）`;
  const launchAction = options.resumeSessionId ? "续接" : "启动";
  await emit([
    {
      stream: "system",
      kind: "lifecycle",
      level: "info",
      status: "started",
      title: `${launchAction} ${adapter.label}`,
      content: `${launchAction} ${adapter.label} session${via}：${command.executable}`
    }
  ]);

  let forceRequested = options.forceSignal?.aborted ?? false;
  const agentRole = options.readOnly ? "Leader PM" : "Worker";
  const stopped = () => options.signal.aborted || forceRequested || Boolean(options.forceSignal?.aborted);
  const interruptionMessage = () => forceRequested
    ? `Maple CLI 已强制终止 ${agentRole}。`
    : explicitCancellationMessage(options.signal) ?? `Maple CLI 已停止，${agentRole} 执行被中断。`;

  if (stopped()) {
    const message = forceRequested
      ? `Maple CLI 已强制终止，${agentRole} 未启动。`
      : explicitCancellationMessage(options.signal) ?? `Maple CLI 已停止，${agentRole} 未启动。`;
    await emit([{
      stream: "system",
      kind: "error",
      level: "error",
      status: "failed",
      title: `${adapter.label} 已取消`,
      content: message
    }]);
    return {
      success: false,
      exitCode: null,
      summary: "",
      error: message,
      usage: resolveFinalUsage(),
      sessionId: options.resumeSessionId ?? null,
      sessionUnavailable: false
    };
  }

  /** Windows 沙箱启动前自愈 / 预检：尽力补齐工作区写权限，或提示用户处理宿主环境问题。 */
  if (adapter.prepareRun && !options.skipPreparation) {
    try {
      const preparation = await adapter.prepareRun({
        cwd: options.cwd,
        readOnly: options.readOnly,
        additionalWritableDirectories: options.additionalWritableDirectories,
        windowsSandboxBypass
      });
      const note = preparation?.note?.trim();
      if (note && preparation) {
        await emit([{
          stream: "system",
          kind: preparation.warning ? "warning" : "lifecycle",
          level: preparation.warning ? "warning" : "info",
          status: "progress",
          title: preparation.warning ? "Windows 沙箱权限不足" : "Windows 沙箱准备",
          content: note
        }]);
      }
    } catch {
      // 预检是尽力而为；异常不阻断启动，进程失败时由运行时诊断兜底。
    }
  }

  let subprocess: PipedSubprocess | null = null;
  let forceTermination: Promise<void> | null = null;
  let gracefulTermination: Promise<void> | null = null;
  const abort = () => {
    const current = subprocess;
    if (current) {
      if (process.platform !== "win32") terminateProcessTree(current);
      gracefulTermination ??= reapCompletedProcessTree(current);
    }
  };
  const forceAbort = () => {
    forceRequested = true;
    const current = subprocess;
    if (current && !forceTermination) forceTermination = forceTerminateProcessTree(current);
  };
  try {
    const spawnOptions: PipedSpawnOptions = {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      stdin: command.stdin === undefined ? "ignore" : new Blob([command.stdin]),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...command.env,
        MAPLE_PROJECT_DIR: options.cwd,
        MAPLE_AGENT_ROLE: options.readOnly ? "project_manager" : "worker"
      }
    };
    subprocess = options.spawnProcess
      ? options.spawnProcess([command.executable, ...command.args], spawnOptions)
      : Bun.spawn([command.executable, ...command.args], spawnOptions);
    options.signal.addEventListener("abort", abort, { once: true });
    options.forceSignal?.addEventListener("abort", forceAbort, { once: true });
    if (options.forceSignal?.aborted) forceAbort();
    if (options.signal.aborted) abort();

    const streamController = new AbortController();
    const streamConsumption = Promise.all([
      consumeStream(subprocess.stdout, "stdout", parser, appendRaw, emit, announceSession, streamController.signal),
      consumeStream(subprocess.stderr, "stderr", parser, appendRaw, emit, announceSession, streamController.signal)
    ]);
    if (options.completeOnTerminalEvent) {
      await Promise.race([streamConsumption, terminalCompletion]);
    } else {
      await streamConsumption;
    }
    if (terminalCompleted && !stopped()) {
      streamController.abort();
      void streamConsumption.catch(() => undefined);
      void reapCompletedProcessTree(subprocess).catch(() => undefined);
      const report = reportCollector.value();
      return {
        success: true,
        exitCode: 0,
        summary: options.summaryMode === "strict-report"
          ? report
          : options.summaryMode === "report"
            ? report
            : tail(assistantOutput, 8_000) || redact(tail(rawOutput, 8_000)) || `${agentRole} 执行完成。`,
        error: null,
        usage: resolveFinalUsage(),
        sessionId: observedSessionId ?? options.resumeSessionId ?? null,
        sessionUnavailable: false
      };
    }
    await streamConsumption;
    const exitCode = await subprocess.exited;
    const permissionBlocker = exitCode === 0 && !stopped()
      ? detectPermissionBlocker({ operationalOutput, assistantOutput })
      : null;
    const success = exitCode === 0 && !stopped() && !permissionBlocker;
    const sandboxFailure = success || permissionBlocker
      ? null
      : describeWindowsSandboxFailure(rawOutput);
    const report = reportCollector.value();
    await emit([
      {
        stream: "system",
        kind: success ? "lifecycle" : "error",
        level: success ? "info" : "error",
        status: success ? "completed" : "failed",
        title: success ? `${adapter.label} 执行完成` : `${adapter.label} 执行失败`,
        content: stopped()
          ? interruptionMessage()
          : permissionBlocker
            ? permissionBlocker
            : success
              ? `${adapter.label} 已完成任务。`
              : sandboxFailure ?? `${adapter.label} 退出，代码 ${exitCode}。`
      }
    ]);
    return {
      success,
      exitCode,
      summary: options.summaryMode === "strict-report"
        ? report
        : options.summaryMode === "report"
          ? report
          : tail(assistantOutput, 8_000) || redact(tail(rawOutput, 8_000)) || (success ? `${agentRole} 执行完成。` : `${agentRole} 未返回可读输出。`),
      error: success
        ? null
        : stopped()
          ? interruptionMessage()
          : permissionBlocker ?? sandboxFailure ?? redact(tail(rawOutput, 4_000)),
      usage: resolveFinalUsage(),
      sessionId: observedSessionId ?? options.resumeSessionId ?? null,
      sessionUnavailable: Boolean(options.resumeSessionId) && !success && sessionUnavailable(rawOutput)
    };
  } catch (error) {
    if (subprocess) {
      if (forceRequested) {
        forceTermination ??= forceTerminateProcessTree(subprocess);
        await forceTermination.catch(() => undefined);
      } else {
        gracefulTermination ??= reapCompletedProcessTree(subprocess);
        await gracefulTermination.catch(() => undefined);
      }
    }
    const interrupted = stopped();
    const message = interrupted
      ? interruptionMessage()
      : redact(error instanceof Error ? error.message : String(error));
    await emit([
      {
        stream: "system",
        kind: "error",
        level: "error",
        status: "failed",
        title: interrupted ? `${adapter.label} 已取消` : `无法启动 ${adapter.label}`,
        content: message
      }
    ]).catch(() => undefined);
    return {
      success: false,
      exitCode: null,
      summary: "",
      error: message,
      usage: resolveFinalUsage(),
      sessionId: observedSessionId ?? options.resumeSessionId ?? null,
      sessionUnavailable: Boolean(options.resumeSessionId) && sessionUnavailable(`${rawOutput}\n${message}`)
    };
  } finally {
    options.signal.removeEventListener("abort", abort);
    options.forceSignal?.removeEventListener("abort", forceAbort);
    if (forceTermination) await forceTermination.catch(() => undefined);
    if (gracefulTermination) await gracefulTermination.catch(() => undefined);
  }
}

import type { LogStream, RunLogEntry, TokenUsage, WorkerKind } from "@maple/protocol";

export interface WorkerCommand {
  executable: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
}

export interface AgentCommandOptions {
  readOnly?: boolean;
  /** Per-run reasoning override; the Leader uses a lighter setting than Workers. */
  reasoningEffort?: string;
  /** Leader turns do not use tools, so skip Maple-provided MCP configuration. */
  disableMcp?: boolean;
  /** Optional provider home used to isolate a lightweight Leader from user-global configuration. */
  isolatedHome?: string;
  /** 已持久化的 Provider session ID；存在时必须续接该会话。 */
  resumeSessionId?: string;
  /** Maple 管理的任务级目录；Agent 只能在有明确用途时额外写入这些目录。 */
  additionalWritableDirectories?: string[];
  /** 当前进程本身已运行在 Codex Windows 沙箱会话内时，跳过内层 Codex 沙箱（避免 setup refresh 无 WRITE_DAC 失败）。 */
  windowsSandboxBypass?: boolean;
}

/** Agent 启动前的宿主级预检结果；note 存在时才需要展示。 */
export interface AgentRunPreparation {
  /** 面向用户的简短说明（已修复 / 需用户处理），为空表示无需提示。 */
  note?: string;
  /** note 属于需要用户介入的警告，而非已完成的自愈。 */
  warning?: boolean;
}

export type AgentRunEventDraft = Omit<RunLogEntry, "sequence" | "occurredAt">;

export interface AgentOutputParser {
  push(stream: Exclude<LogStream, "system">, chunk: string): AgentRunEventDraft[];
  flush(stream: Exclude<LogStream, "system">): AgentRunEventDraft[];
  sessionId(): string | null;
  /** 取本次执行累积的 token 用量（多次 turn.completed 取最后一次）；无数据返回 null。 */
  usage(): TokenUsage | null;
  /**
   * 进程结束后调用，供 adapter 从外部数据源（如 session 归档文件）补全 usage。
   * 返回最终 usage 时覆盖 usage()；返回 null 时回退到 usage()。默认不实现。
   */
  finalize?(context: { cwd: string; sessionId: string | null }): TokenUsage | null;
}

export interface CodingAgentAdapter {
  readonly kind: WorkerKind;
  readonly label: string;
  buildCommand(
    prompt: string,
    env: Record<string, string | undefined>,
    options?: AgentCommandOptions
  ): WorkerCommand;
  /**
   * 启动前的宿主级预检（如 Windows 沙箱 ACL 自愈）。返回 note 时由执行器写入日志；
   * 抛错不阻断启动，运行时诊断兜底。
   */
  prepareRun?(context: {
    cwd: string;
    readOnly?: boolean;
    additionalWritableDirectories?: string[];
    windowsSandboxBypass?: boolean;
  }): Promise<AgentRunPreparation | void>;
  createOutputParser(): AgentOutputParser;
}

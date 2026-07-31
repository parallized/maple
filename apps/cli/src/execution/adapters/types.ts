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
  /** 已持久化的 Provider session ID；存在时必须续接该会话。 */
  resumeSessionId?: string;
  /** Maple 管理的任务级目录；Agent 只能在有明确用途时额外写入这些目录。 */
  additionalWritableDirectories?: string[];
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
  createOutputParser(): AgentOutputParser;
}

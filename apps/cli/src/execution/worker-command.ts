import type { WorkerKind } from "@maple/protocol";
import { getCodingAgentAdapter } from "./adapters/registry";
import type { WorkerCommand } from "./adapters/types";
import type { AgentCommandOptions } from "./adapters/types";
import { resolveExecutablePath, type ExecutableResolver } from "./executable";
import { wrapWorkerCommand, type WorkerShell } from "./shells";

export type { WorkerCommand } from "./adapters/types";

export function buildWorkerCommand(
  kind: WorkerKind,
  prompt: string,
  shell: WorkerShell = "direct",
  env: Record<string, string | undefined> = process.env,
  options?: AgentCommandOptions
): WorkerCommand {
  const base = getCodingAgentAdapter(kind).buildCommand(prompt, env, options);
  return wrapWorkerCommand(shell, base);
}

/** 生产执行使用：Agent 本体与包装 Shell 都先解析为可直接启动的真实路径。 */
export function buildResolvedWorkerCommand(
  kind: WorkerKind,
  prompt: string,
  shell: WorkerShell = "direct",
  env: Record<string, string | undefined> = process.env,
  resolver?: ExecutableResolver,
  options?: AgentCommandOptions
): WorkerCommand {
  const base = getCodingAgentAdapter(kind).buildCommand(prompt, env, options);
  const agentCommand = {
    ...base,
    executable: resolveExecutablePath(base.executable, resolver) ?? base.executable
  };
  if (shell === "direct") return agentCommand;

  const wrapped = wrapWorkerCommand(shell, agentCommand);
  return {
    ...wrapped,
    executable: resolveExecutablePath(wrapped.executable, resolver) ?? wrapped.executable
  };
}

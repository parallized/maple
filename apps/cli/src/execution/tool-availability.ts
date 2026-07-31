import { WORKER_KINDS, type WorkerInventoryItem, type WorkerKind } from "@maple/protocol";
import { isDeepSeekConfigured } from "../credentials/deepseek";
import { getCodingAgentAdapter } from "./adapters/registry";
import { resolveExecutablePath, type ExecutableResolver } from "./executable";
import { resolveWorkerModelIdentity } from "./model-identity";

export interface CodingAgentToolStatus {
  kind: WorkerKind;
  label: string;
  executable: string;
  available: boolean;
  modelId: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
}

export function toWorkerInventory(tools: readonly CodingAgentToolStatus[]): WorkerInventoryItem[] {
  return tools.map(({ kind, available, modelId, modelName, reasoningEffort }) => ({
    kind,
    available,
    modelId,
    modelName,
    reasoningEffort
  }));
}

/** 启动时按各 Adapter 的真实命令探测本机 Coding Agent。 */
export function detectCodingAgentTools(
  env: Record<string, string | undefined> = process.env,
  resolver?: ExecutableResolver
): CodingAgentToolStatus[] {
  // 显式传入隔离 env 的测试/探测不得读取真实 Windows 凭据；生产默认 env 才查询系统存储。
  const deepSeekConfigured = env === process.env
    ? isDeepSeekConfigured(env)
    : Boolean(env.DEEPSEEK_API_KEY?.trim());
  return WORKER_KINDS.map((kind) => {
    const adapter = getCodingAgentAdapter(kind);
    const executable = adapter.buildCommand("", env).executable;
    let available = false;
    try {
      available = resolveExecutablePath(executable, resolver) !== null;
      if (kind === "deepseek") available = available && deepSeekConfigured;
    } catch {
      // 单个工具探测失败不应阻止 Runner 启动。
    }
    return { kind, label: adapter.label, executable, available, ...resolveWorkerModelIdentity(kind, env) };
  });
}

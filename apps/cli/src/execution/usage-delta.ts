import type { TokenUsage, WorkerKind } from "@maple/protocol";

/**
 * Codex / DeepSeek 的 `turn.completed.usage` 是整条 session 的累计值而非单次 run 的增量
 * （官方 issue openai/codex#16213），同一 session 被多个任务复用时必须用前后差值换算。
 * 其余 Worker（Claude / Gemini / Kimi 等）上报的本身就是单次增量，不参与换算。
 */
export function isCumulativeUsageWorker(kind: WorkerKind): boolean {
  return kind === "codex" || kind === "deepseek";
}

/**
 * Codex 语义中 cached_input_tokens 是 input_tokens 的子集（输入含缓存读取）。
 * 拆开记列后服务端会把两者相加，导致缓存部分每次都被重复计费，这里先剔除子集。
 */
export function normalizeCodexUsage(usage: TokenUsage): TokenUsage {
  return {
    ...usage,
    inputTokens: Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  };
}

/** 用本次累计值减去上一次 baseline，得到单次 run 的增量；baseline 为空时原样返回。 */
export function computeUsageDelta(current: TokenUsage, baseline: TokenUsage | null): TokenUsage {
  if (!baseline) return current;
  return {
    inputTokens: Math.max(0, current.inputTokens - baseline.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - baseline.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - baseline.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - baseline.reasoningOutputTokens)
  };
}

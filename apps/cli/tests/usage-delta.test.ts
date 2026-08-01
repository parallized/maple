import { describe, expect, it } from "bun:test";
import {
  computeUsageDelta,
  isCumulativeUsageWorker,
  normalizeCodexUsage
} from "../src/execution/usage-delta";

describe("worker usage delta", () => {
  it("marks only Codex / DeepSeek as cumulative-usage workers", () => {
    expect(isCumulativeUsageWorker("codex")).toBe(true);
    expect(isCumulativeUsageWorker("deepseek")).toBe(true);
    expect(isCumulativeUsageWorker("kimi")).toBe(false);
    expect(isCumulativeUsageWorker("claude")).toBe(false);
    expect(isCumulativeUsageWorker("gemini")).toBe(false);
  });

  it("subtracts the cached subset from input tokens", () => {
    expect(normalizeCodexUsage({
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 5,
      reasoningOutputTokens: 3
    })).toEqual({
      inputTokens: 80,
      cachedInputTokens: 20,
      outputTokens: 5,
      reasoningOutputTokens: 3
    });
    expect(normalizeCodexUsage({
      inputTokens: 20,
      cachedInputTokens: 30,
      outputTokens: 5,
      reasoningOutputTokens: 3
    }).inputTokens).toBe(0);
  });

  it("returns the current usage unchanged when there is no baseline", () => {
    const usage = {
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 5,
      reasoningOutputTokens: 3
    };
    expect(computeUsageDelta(usage, null)).toBe(usage);
  });

  it("computes the per-run increment from cumulative session usage", () => {
    // 用户描述的场景：A 任务后累计 100，B 任务复用同一 session 后累计 170。
    expect(computeUsageDelta(
      { inputTokens: 80, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 2 },
      null
    )).toEqual({ inputTokens: 80, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 2 });

    expect(computeUsageDelta(
      { inputTokens: 120, cachedInputTokens: 50, outputTokens: 26, reasoningOutputTokens: 5 },
      { inputTokens: 80, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 2 }
    )).toEqual({ inputTokens: 40, cachedInputTokens: 30, outputTokens: 16, reasoningOutputTokens: 3 });
  });

  it("clamps negative increments to zero", () => {
    expect(computeUsageDelta(
      { inputTokens: 50, cachedInputTokens: 10, outputTokens: 5, reasoningOutputTokens: 1 },
      { inputTokens: 80, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 2 }
    )).toEqual({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 });
  });
});

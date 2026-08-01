import type { WorkerKind } from "../domain";
import type { ModelPriceQuote } from "../platform/types";

/** 粗略汇率：中文界面以人民币展示成本（models.dev 原始费率为 USD）。 */
export const USD_TO_CNY_RATE = 7.2;

/** Worker 类型 → models.dev providerId 候选（按优先级）。 */
const PROVIDER_CANDIDATES: Partial<Record<WorkerKind, string[]>> = {
  claude: ["anthropic"],
  codex: ["openai"],
  kimi: ["moonshotai", "moonshot"],
  deepseek: ["deepseek"],
  gemini: ["google"]
};

export type TokenCostBucket = {
  workerKind: WorkerKind;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** 在定价快照中查找某 Worker 类型的模型价格：先按 provider 过滤，再按 modelId 精确/包含匹配。 */
function findPrice(
  kind: WorkerKind,
  modelIds: string[],
  pricing: ModelPriceQuote[]
): ModelPriceQuote | null {
  const providers = PROVIDER_CANDIDATES[kind];
  if (!providers || providers.length === 0) return null;
  const candidates = pricing.filter((entry) => providers.includes(entry.providerId.toLowerCase()));
  if (candidates.length === 0) return null;

  const wanted = modelIds.map(normalizeModelId).filter(Boolean);
  for (const id of wanted) {
    const exact = candidates.find((entry) => normalizeModelId(entry.modelId) === id);
    if (exact) return exact;
  }
  for (const id of wanted) {
    const fuzzy = candidates.find((entry) => {
      const entryId = normalizeModelId(entry.modelId);
      return entryId.includes(id) || id.includes(entryId);
    });
    if (fuzzy) return fuzzy;
  }
  return null;
}

/**
 * 估算一组用量桶的 USD 成本。
 * 缓存读按 cacheRead 费率（缺失回退 input 费率），推理输出按 reasoning 费率（缺失回退 output 费率）。
 * 任一桶找不到价格时该桶按 0 计；全部可计价桶费率缺失时返回 null。
 */
export function estimateTokenCostUsd(
  buckets: TokenCostBucket[],
  pricing: ModelPriceQuote[],
  modelIdsByKind: Partial<Record<WorkerKind, string[]>>
): number | null {
  if (pricing.length === 0) return null;
  let total = 0;
  let priced = false;
  for (const bucket of buckets) {
    const price = findPrice(bucket.workerKind, modelIdsByKind[bucket.workerKind] ?? [], pricing);
    if (!price) continue;
    const inputRate = price.inputUsdPerMillion;
    const cacheRate = price.cacheReadUsdPerMillion ?? inputRate;
    const outputRate = price.outputUsdPerMillion;
    const reasoningRate = price.reasoningUsdPerMillion ?? outputRate;
    let bucketCost = 0;
    let bucketPriced = false;
    if (inputRate !== null && bucket.inputTokens > 0) {
      bucketCost += (bucket.inputTokens * inputRate) / 1_000_000;
      bucketPriced = true;
    }
    if (cacheRate !== null && bucket.cachedInputTokens > 0) {
      bucketCost += (bucket.cachedInputTokens * cacheRate) / 1_000_000;
      bucketPriced = true;
    }
    if (outputRate !== null && bucket.outputTokens > 0) {
      bucketCost += (bucket.outputTokens * outputRate) / 1_000_000;
      bucketPriced = true;
    }
    if (reasoningRate !== null && bucket.reasoningOutputTokens > 0) {
      bucketCost += (bucket.reasoningOutputTokens * reasoningRate) / 1_000_000;
      bucketPriced = true;
    }
    total += bucketCost;
    priced = priced || bucketPriced;
  }
  return priced ? total : null;
}

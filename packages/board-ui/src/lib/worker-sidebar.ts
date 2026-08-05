import type { RunnerSummary, RunnerWorkerInventoryItem, WorkerKind } from "../domain";
import { WORKER_KINDS } from "./constants";

export type SidebarWorkerState = "online" | "offline" | "missing" | "unknown" | "no_runner";

export interface SidebarWorkerItem {
  /** 行内稳定 key：同一 Worker 类型可能因多台 Runner 连接不同模型而拆成多行。 */
  uid: string;
  kind: WorkerKind;
  label: string;
  state: SidebarWorkerState;
  model: string;
  title: string;
}

export function formatReasoningEffort(value: string | null): string {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "xhigh") return "XHigh";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

/** 行内已有 Worker 图标标识品牌，显示模型时省略品牌前缀（Claude / GPT / Kimi…），tooltip 仍保留完整 modelId。 */
const BRAND_PREFIX_PATTERN = /^(?:claude|gpt|deepseek|kimi|gemini|glm|iflow|codex|opencode)[-\s]+/i;

function modelLabel(item: RunnerWorkerInventoryItem): string | null {
  const model = item.modelName?.trim() || item.modelId?.trim();
  if (!model) return null;
  const effort = formatReasoningEffort(item.reasoningEffort);
  const full = effort ? `${model} ${effort}` : model;
  const abbreviated = full.replace(BRAND_PREFIX_PATTERN, "");
  return abbreviated || full;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

/** 将多台 Runner 的 inventory 聚合成固定 Worker 列表，模型不丢精度。 */
export function buildSidebarWorkers(runners: readonly RunnerSummary[]): SidebarWorkerItem[] {
  const onlineRunners = runners.filter((runner) => runner.state === "online");
  const relevantRunners = onlineRunners.length > 0 ? onlineRunners : [...runners];
  const anyInventory = relevantRunners.some((runner) => runner.workerInventory !== undefined);

  const items: SidebarWorkerItem[] = [];

  for (const { kind, label } of WORKER_KINDS) {
    const reports = relevantRunners.flatMap(
      (runner) => runner.workerInventory?.filter((item) => item.kind === kind) ?? []
    );
    const available = reports.filter((item) => item.available);

    if (available.length > 0) {
      // 多台 Runner 连不同模型时各占一行，不再用斜杠拼接。
      const byModel = new Map<string, string[]>();
      for (const item of available) {
        const model = modelLabel(item) ?? "模型未解析";
        const ids = byModel.get(model) ?? [];
        ids.push(item.modelId?.trim() || model);
        byModel.set(model, ids);
      }
      for (const [model, ids] of byModel) {
        items.push({
          uid: `${kind}:${model}`,
          kind,
          label,
          state: onlineRunners.length > 0 ? "online" : "offline",
          model,
          title: unique(ids).join(" / ") || model
        });
      }
      continue;
    }

    if (anyInventory) {
      items.push({ uid: `${kind}:missing`, kind, label, state: "missing", model: "未安装", title: `${label} 未安装` });
      continue;
    }
    if (relevantRunners.length > 0) {
      items.push({ uid: `${kind}:unknown`, kind, label, state: "unknown", model: "等待 CLI 上报", title: "当前 CLI 版本尚未上报模型" });
      continue;
    }
    items.push({ uid: `${kind}:no_runner`, kind, label, state: "no_runner", model: "暂无执行端", title: "连接 CLI 后显示精确模型" });
  }

  return items;
}

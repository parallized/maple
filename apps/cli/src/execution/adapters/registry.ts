import type { WorkerKind } from "@maple/protocol";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { deepSeekAdapter } from "./deepseek";
import { geminiAdapter } from "./gemini";
import { glmAdapter } from "./glm";
import { iflowAdapter } from "./iflow";
import { kimiAdapter } from "./kimi";
import { opencodeAdapter } from "./opencode";
import type { CodingAgentAdapter } from "./types";

const CODING_AGENT_ADAPTERS = {
  codex: codexAdapter,
  deepseek: deepSeekAdapter,
  claude: claudeAdapter,
  kimi: kimiAdapter,
  glm: glmAdapter,
  iflow: iflowAdapter,
  gemini: geminiAdapter,
  opencode: opencodeAdapter
} satisfies Record<WorkerKind, CodingAgentAdapter>;

export function getCodingAgentAdapter(kind: WorkerKind): CodingAgentAdapter {
  return CODING_AGENT_ADAPTERS[kind];
}

export function workerLabel(kind: WorkerKind): string {
  return getCodingAgentAdapter(kind).label;
}

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkerKind } from "@maple/protocol";

const DEFAULT_GLM_MODEL = "zai-coding-plan/glm-5.2";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

type ConfigRecord = Record<string, unknown>;

export interface WorkerModelIdentity {
  modelId: string | null;
  modelName: string | null;
  reasoningEffort: string | null;
}

function record(value: unknown): ConfigRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ConfigRecord : null;
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    const item = record(current);
    if (!item) return undefined;
    current = item[key];
  }
  return current;
}

function stringAt(value: unknown, ...paths: readonly string[][]): string | null {
  for (const path of paths) {
    const candidate = valueAt(value, path);
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function readStructured(path: string): ConfigRecord | null {
  if (!existsSync(path)) return null;
  try {
    const source = readFileSync(path, "utf8");
    const parsed = path.toLowerCase().endsWith(".toml") ? Bun.TOML.parse(source) : JSON.parse(source);
    return record(parsed);
  } catch {
    return null;
  }
}

function firstConfig(paths: readonly string[]): ConfigRecord | null {
  for (const path of paths) {
    const config = readStructured(path);
    if (config) return config;
  }
  return null;
}

function envValue(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key]?.trim();
  return value || null;
}

function displayToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === "gpt") return "GPT";
  if (lower === "glm") return "GLM";
  if (lower === "kimi") return "Kimi";
  if (lower === "gemini") return "Gemini";
  if (lower === "claude") return "Claude";
  if (lower === "codex") return "Codex";
  if (lower === "deepseek") return "DeepSeek";
  if (lower === "iflow") return "iFlow";
  if (/^k\d+$/.test(lower)) return lower.toUpperCase();
  if (/^\d+(?:\.\d+)*(?:k|m)$/.test(lower)) return `${lower.slice(0, -1)}${lower.at(-1)!.toUpperCase()}`;
  if (/^[a-z]\d+$/.test(lower)) return lower.toUpperCase();
  return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
}

/** 把 Provider model ID 转成稳定显示名，同时保留 modelId 供 tooltip 精确查看。 */
export function formatWorkerModelName(kind: WorkerKind, modelId: string): string {
  const finalSegment = modelId.trim().split("/").filter(Boolean).at(-1) ?? modelId.trim();
  const tokens = finalSegment
    .replace(/\[([^\]]+)\]/g, "-$1")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(displayToken);
  let name = tokens.join(" ") || modelId.trim();
  const lower = name.toLowerCase();
  if (kind === "claude" && !lower.startsWith("claude ")) name = `Claude ${name}`;
  if (kind === "kimi" && !lower.startsWith("kimi ")) name = `Kimi ${name}`;
  if (kind === "gemini" && !lower.startsWith("gemini ")) name = `Gemini ${name}`;
  if (kind === "glm" && !lower.startsWith("glm ")) name = `GLM ${name}`;
  if (kind === "iflow" && !lower.startsWith("iflow ")) name = `iFlow ${name}`;
  if (kind === "deepseek" && !lower.startsWith("deepseek ")) name = `DeepSeek ${name}`;
  return name;
}

function homeDirectory(env: Record<string, string | undefined>): string {
  return env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
}

function resolveConfigIdentity(
  kind: WorkerKind,
  env: Record<string, string | undefined>,
  home: string
): { modelId: string | null; reasoningEffort: string | null } {
  if (kind === "glm") {
    return { modelId: envValue(env, "MAPLE_GLM_MODEL") ?? DEFAULT_GLM_MODEL, reasoningEffort: null };
  }

  if (kind === "deepseek") {
    return {
      modelId: envValue(env, "MAPLE_DEEPSEEK_MODEL") ?? DEFAULT_DEEPSEEK_MODEL,
      reasoningEffort: envValue(env, "MAPLE_DEEPSEEK_REASONING_EFFORT") ?? "high"
    };
  }

  if (kind === "codex") {
    const configHome = envValue(env, "CODEX_HOME") ?? join(home, ".codex");
    const config = readStructured(join(configHome, "config.toml"));
    return {
      modelId: envValue(env, "MAPLE_CODEX_MODEL") ?? stringAt(config, ["model"]),
      reasoningEffort: envValue(env, "MAPLE_CODEX_REASONING_EFFORT")
        ?? stringAt(config, ["model_reasoning_effort"])
    };
  }

  if (kind === "claude") {
    const configHome = envValue(env, "CLAUDE_CONFIG_DIR") ?? join(home, ".claude");
    const config = readStructured(join(configHome, "settings.json"));
    return {
      modelId: envValue(env, "MAPLE_CLAUDE_MODEL") ?? stringAt(config, ["model"]),
      reasoningEffort: envValue(env, "MAPLE_CLAUDE_EFFORT") ?? stringAt(config, ["effort"])
    };
  }

  if (kind === "kimi") {
    const configHome = envValue(env, "KIMI_CONFIG_DIR") ?? join(home, ".kimi-code");
    const config = readStructured(join(configHome, "config.toml"));
    return {
      modelId: envValue(env, "MAPLE_KIMI_MODEL") ?? stringAt(config, ["default_model"], ["model"]),
      reasoningEffort: null
    };
  }

  if (kind === "gemini") {
    const configHome = envValue(env, "GEMINI_CLI_HOME") ?? join(home, ".gemini");
    const config = readStructured(join(configHome, "settings.json"));
    return {
      modelId: envValue(env, "MAPLE_GEMINI_MODEL")
        ?? stringAt(config, ["model", "name"], ["model"], ["selectedModel"]),
      reasoningEffort: null
    };
  }

  if (kind === "opencode") {
    const configuredPath = envValue(env, "OPENCODE_CONFIG");
    const appData = envValue(env, "APPDATA");
    const xdgConfig = envValue(env, "XDG_CONFIG_HOME");
    const config = firstConfig([
      ...(configuredPath ? [configuredPath] : []),
      ...(appData ? [join(appData, "opencode", "opencode.json")] : []),
      ...(xdgConfig ? [join(xdgConfig, "opencode", "opencode.json")] : []),
      join(home, ".config", "opencode", "opencode.json")
    ]);
    return {
      modelId: envValue(env, "MAPLE_OPENCODE_MODEL") ?? stringAt(config, ["model"]),
      reasoningEffort: null
    };
  }

  const configHome = envValue(env, "IFLOW_CONFIG_DIR") ?? join(home, ".iflow");
  const config = firstConfig([
    join(configHome, "settings.json"),
    join(configHome, "config.json"),
    join(configHome, "config.toml")
  ]);
  return {
    modelId: envValue(env, "MAPLE_IFLOW_MODEL") ?? stringAt(config, ["model", "name"], ["model"]),
    reasoningEffort: null
  };
}

export function resolveWorkerModelIdentity(
  kind: WorkerKind,
  env: Record<string, string | undefined> = process.env
): WorkerModelIdentity {
  const resolved = resolveConfigIdentity(kind, env, homeDirectory(env));
  return {
    modelId: resolved.modelId,
    modelName: resolved.modelId ? formatWorkerModelName(kind, resolved.modelId) : null,
    reasoningEffort: resolved.reasoningEffort
  };
}

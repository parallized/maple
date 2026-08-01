import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEEPSEEK_CODEX_MODELS_JSON } from "./deepseek-models";

export interface RuntimeLayout {
  root: string;
  mcpConfigPath: string;
  mcpCommand: string;
  mcpArgs: string[];
  deepSeekModelCatalogPath: string;
}

function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
}

function removeLegacyManagedSkill(root: string): void {
  const skillsRoot = join(root, "skills");
  const mapleSkillDirectory = join(skillsRoot, "maple");
  rmSync(join(mapleSkillDirectory, "SKILL.md"), { force: true });
  for (const directory of [mapleSkillDirectory, skillsRoot]) {
    try {
      rmdirSync(directory);
    } catch {
      // Preserve non-empty directories and files that Maple does not own.
    }
  }
}

export function resolveRuntimeRoot(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.MAPLE_RUNTIME_HOME?.trim() || join(homedir(), ".maple", "runtime"));
}

export function ensureRuntimeLayout(env: Record<string, string | undefined> = process.env): RuntimeLayout {
  const root = resolveRuntimeRoot(env);
  removeLegacyManagedSkill(root);
  const mcpConfigPath = join(root, "mcp", "mcp.json");
  const mcpCommand = process.execPath;
  const mcpArgs = [resolve(process.argv[1] || import.meta.path), "mcp"];
  const deepSeekModelCatalogPath = join(root, "providers", "deepseek", "models.json");
  writeIfChanged(mcpConfigPath, `${JSON.stringify({
    mcpServers: {
      maple: { command: mcpCommand, args: mcpArgs }
    }
  }, null, 2)}\n`);
  writeIfChanged(deepSeekModelCatalogPath, DEEPSEEK_CODEX_MODELS_JSON);
  mkdirSync(join(root, "artifacts"), { recursive: true });
  return { root, mcpConfigPath, mcpCommand, mcpArgs, deepSeekModelCatalogPath };
}

export function runtimeEnvironment(layout: RuntimeLayout): Record<string, string> {
  return {
    MAPLE_RUNTIME_HOME: layout.root,
    MAPLE_MCP_CONFIG: layout.mcpConfigPath,
    MAPLE_MCP_COMMAND: layout.mcpCommand,
    MAPLE_MCP_ARGS: JSON.stringify(layout.mcpArgs),
    MAPLE_DEEPSEEK_MODEL_CATALOG: layout.deepSeekModelCatalogPath
  };
}

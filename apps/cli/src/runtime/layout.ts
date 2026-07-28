import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SKILL_CONTENT = `---
name: maple
description: Maple CLI managed PM and Worker runtime rules.
---

# Maple Runtime

Maple Server owns task state, dispatch and reports. Do not install project-local Maple files and do not call legacy task-flow tools.

- Read the repository AGENTS.md before acting.
- Project manager sessions are read-only and only return the requested dispatch JSON.
- Worker sessions implement the assigned Todo directly, preserve unrelated changes, and verify proportionately.
- Final Worker output is a concise result report. Do not expose hidden reasoning or chain-of-thought.
- Maple MCP is read-only runtime context. It never grants access beyond the current CLI process.
`;

export interface RuntimeLayout {
  root: string;
  skillPath: string;
  mcpConfigPath: string;
  mcpCommand: string;
  mcpArgs: string[];
}

function writeIfChanged(path: string, content: string): void {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
}

export function resolveRuntimeRoot(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.MAPLE_RUNTIME_HOME?.trim() || join(homedir(), ".maple", "runtime"));
}

export function ensureRuntimeLayout(env: Record<string, string | undefined> = process.env): RuntimeLayout {
  const root = resolveRuntimeRoot(env);
  const skillPath = join(root, "skills", "maple", "SKILL.md");
  const mcpConfigPath = join(root, "mcp", "mcp.json");
  const mcpCommand = process.execPath;
  const mcpArgs = [resolve(process.argv[1] || import.meta.path), "mcp"];
  writeIfChanged(skillPath, SKILL_CONTENT);
  writeIfChanged(mcpConfigPath, `${JSON.stringify({
    mcpServers: {
      maple: { command: mcpCommand, args: mcpArgs }
    }
  }, null, 2)}\n`);
  mkdirSync(join(root, "artifacts"), { recursive: true });
  return { root, skillPath, mcpConfigPath, mcpCommand, mcpArgs };
}

export function runtimeEnvironment(layout: RuntimeLayout): Record<string, string> {
  return {
    MAPLE_RUNTIME_HOME: layout.root,
    MAPLE_SKILL_PATH: layout.skillPath,
    MAPLE_MCP_CONFIG: layout.mcpConfigPath,
    MAPLE_MCP_COMMAND: layout.mcpCommand,
    MAPLE_MCP_ARGS: JSON.stringify(layout.mcpArgs)
  };
}

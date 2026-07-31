import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkerCommand } from "../src/execution/worker-command";
import { ensureRuntimeLayout, runtimeEnvironment } from "../src/runtime/layout";

describe("Maple managed runtime", () => {
  it("keeps Skill and MCP assets under one Maple runtime root", () => {
    const root = mkdtempSync(join(tmpdir(), "maple-runtime-test-"));
    try {
      const layout = ensureRuntimeLayout({ MAPLE_RUNTIME_HOME: root });
      expect(layout.skillPath.startsWith(root)).toBe(true);
      expect(layout.mcpConfigPath.startsWith(root)).toBe(true);
      expect(layout.deepSeekModelCatalogPath.startsWith(root)).toBe(true);
      expect(readFileSync(layout.skillPath, "utf8")).toContain("Do not install project-local Maple files");
      const config = JSON.parse(readFileSync(layout.mcpConfigPath, "utf8"));
      expect(config.mcpServers.maple.command).toBe(layout.mcpCommand);
      expect(config.mcpServers.maple.args).toEqual(layout.mcpArgs);
      const catalog = JSON.parse(readFileSync(layout.deepSeekModelCatalogPath, "utf8"));
      expect(catalog.models[0]?.slug).toBe("deepseek-v4-flash");
      expect(catalog.models[0]?.base_instructions).toContain("coding agent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("injects the centralized MCP into Codex and Claude per invocation", () => {
    const env = runtimeEnvironment({
      root: "C:/Users/test/.maple/runtime",
      skillPath: "C:/Users/test/.maple/runtime/skills/maple/SKILL.md",
      mcpConfigPath: "C:/Users/test/.maple/runtime/mcp/mcp.json",
      mcpCommand: "bun",
      mcpArgs: ["C:/Users/test/.maple/bin/maple-cli.js", "mcp"],
      deepSeekModelCatalogPath: "C:/Users/test/.maple/runtime/providers/deepseek/models.json"
    });
    const codex = buildWorkerCommand("codex", "task", "direct", env);
    expect(codex.args).toContain('mcp_servers.maple.command="bun"');
    expect(codex.args).toContain('mcp_servers.maple.args=["C:/Users/test/.maple/bin/maple-cli.js","mcp"]');
    const deepseek = buildWorkerCommand("deepseek", "task", "direct", env);
    expect(deepseek.args).toContain('model_catalog_json="C:/Users/test/.maple/runtime/providers/deepseek/models.json"');
    const claude = buildWorkerCommand("claude", "task", "direct", env);
    expect(claude.args).toContain("--mcp-config");
    expect(claude.args).toContain(env.MAPLE_MCP_CONFIG);
  });
});

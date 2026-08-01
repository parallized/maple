import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorkerCommand } from "../src/execution/worker-command";
import { ensureRuntimeLayout, runtimeEnvironment } from "../src/runtime/layout";

describe("Maple managed runtime", () => {
  it("keeps MCP and provider assets under one Maple runtime root", () => {
    const root = mkdtempSync(join(tmpdir(), "maple-runtime-test-"));
    try {
      const legacySkillPath = join(root, "skills", "maple", "SKILL.md");
      mkdirSync(join(root, "skills", "maple"), { recursive: true });
      writeFileSync(legacySkillPath, "legacy managed skill", "utf8");
      const layout = ensureRuntimeLayout({ MAPLE_RUNTIME_HOME: root });
      expect(existsSync(legacySkillPath)).toBe(false);
      expect(existsSync(join(root, "skills"))).toBe(false);
      expect(layout.mcpConfigPath.startsWith(root)).toBe(true);
      expect(layout.deepSeekModelCatalogPath.startsWith(root)).toBe(true);
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

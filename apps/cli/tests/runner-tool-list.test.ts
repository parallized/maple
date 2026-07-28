import { describe, expect, it } from "bun:test";
import type { CodingAgentToolStatus } from "../src/execution/tool-availability";
import { toolListRows } from "../src/tui/tool-list";

const tools: CodingAgentToolStatus[] = [
  { kind: "codex", label: "Codex", executable: "codex", available: true, modelId: null, modelName: null, reasoningEffort: null },
  { kind: "claude", label: "Claude", executable: "claude", available: false, modelId: null, modelName: null, reasoningEffort: null },
  { kind: "kimi", label: "Kimi", executable: "kimi", available: true, modelId: null, modelName: null, reasoningEffort: null },
  { kind: "glm", label: "GLM", executable: "opencode", available: false, modelId: null, modelName: null, reasoningEffort: null },
  { kind: "iflow", label: "iFlow", executable: "iflow", available: false, modelId: null, modelName: null, reasoningEffort: null },
  { kind: "gemini", label: "Gemini", executable: "gemini", available: true, modelId: null, modelName: null, reasoningEffort: null },
  { kind: "opencode", label: "OpenCode", executable: "opencode", available: true, modelId: null, modelName: null, reasoningEffort: null }
];

describe("runner tool list", () => {
  it("keeps all tools on one row when they fit", () => {
    const rows = toolListRows(tools, 80);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe(true);
    expect(rows[0]?.tools.map((tool) => tool.label)).toEqual(tools.map((tool) => tool.label));
  });

  it("continues tools on the next row without repeating the title", () => {
    const rows = toolListRows(tools, 34);

    expect(rows.map((row) => ({
      title: row.title,
      tools: row.tools.map((tool) => tool.label)
    }))).toEqual([
      { title: true, tools: ["Codex", "Claude", "Kimi", "GLM"] },
      { title: false, tools: ["iFlow", "Gemini", "OpenCode"] }
    ]);
  });
});

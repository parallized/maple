import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ensureRuntimeLayout } from "./layout";

export async function runRuntimeMcpServer(): Promise<void> {
  const runtime = ensureRuntimeLayout();
  const server = new McpServer({ name: "maple-runtime", version: "0.2.0" });
  server.tool(
    "maple_runtime_context",
    "Read the Maple-managed role, project directory and centralized Skill location for this process.",
    { includeSkillPath: z.boolean().optional().default(true) },
    async ({ includeSkillPath }) => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          role: process.env.MAPLE_AGENT_ROLE || "worker",
          projectDirectory: process.env.MAPLE_PROJECT_DIR || process.cwd(),
          skillPath: includeSkillPath ? runtime.skillPath : undefined,
          runtimeRoot: runtime.root
        })
      }]
    })
  );
  await server.connect(new StdioServerTransport());
}

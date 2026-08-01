import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureRuntimeLayout } from "./layout";

export async function runRuntimeMcpServer(): Promise<void> {
  const runtime = ensureRuntimeLayout();
  const server = new McpServer({ name: "maple-runtime", version: "0.2.0" });
  server.tool(
    "maple_runtime_context",
    "Read the Maple-managed role, project directory and runtime root for this process.",
    async () => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          role: process.env.MAPLE_AGENT_ROLE || "worker",
          projectDirectory: process.env.MAPLE_PROJECT_DIR || process.cwd(),
          runtimeRoot: runtime.root
        })
      }]
    })
  );
  await server.connect(new StdioServerTransport());
}

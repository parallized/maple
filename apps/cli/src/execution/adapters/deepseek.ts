import type { CodingAgentAdapter } from "./types";
import { CODEX_AUTOMATION_PREFIX, createCodexOutputParser } from "./codex";
import { prepareCodexWindowsSandbox } from "../windows-sandbox";

const DEFAULT_MODEL = "deepseek-v4-flash";
const PROVIDER_ID = "maple_deepseek";

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** DeepSeek 是独立 Worker；执行与 JSONL 会话协议复用 Codex CLI。 */
export const deepSeekAdapter: CodingAgentAdapter = {
  kind: "deepseek",
  label: "DeepSeek-Flash",
  buildCommand(prompt, env, options) {
    const model = env.MAPLE_DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
    const reasoningEffort = options?.reasoningEffort?.trim()
      || env.MAPLE_DEEPSEEK_REASONING_EFFORT?.trim()
      || "high";
    const catalog = env.MAPLE_DEEPSEEK_MODEL_CATALOG?.trim();
    const apiKey = env.DEEPSEEK_API_KEY?.trim();
    const mcpCommand = options?.disableMcp ? undefined : env.MAPLE_MCP_COMMAND?.trim();
    const mcpArgs = options?.disableMcp ? undefined : env.MAPLE_MCP_ARGS?.trim();
    const commandEnv: Record<string, string> = {};
    if (apiKey) commandEnv.DEEPSEEK_API_KEY = apiKey;
    if (options?.isolatedHome) commandEnv.CODEX_HOME = options.isolatedHome;
    const resume = options?.resumeSessionId
      ? ["resume", options.resumeSessionId, "-"]
      : ["-"];

    return {
      executable: env.MAPLE_DEEPSEEK_BIN?.trim() || env.MAPLE_CODEX_BIN?.trim() || "codex",
      args: [
        ...CODEX_AUTOMATION_PREFIX,
        // 保留用户的宿主沙箱配置；忽略它会让 Windows 上的 workspace-write 静默降级为 read-only。
        "--model",
        model,
        "--config",
        `model_provider=${tomlString(PROVIDER_ID)}`,
        "--config",
        `model_reasoning_effort=${tomlString(reasoningEffort)}`,
        ...(catalog ? ["--config", `model_catalog_json=${tomlString(catalog)}`] : []),
        "--config",
        `model_providers.${PROVIDER_ID}.name=${tomlString("DeepSeek")}`,
        "--config",
        `model_providers.${PROVIDER_ID}.base_url=${tomlString("https://api.deepseek.com/")}`,
        "--config",
        `model_providers.${PROVIDER_ID}.env_key=${tomlString("DEEPSEEK_API_KEY")}`,
        "--config",
        `model_providers.${PROVIDER_ID}.wire_api=${tomlString("responses")}`,
        "--config",
        `model_providers.${PROVIDER_ID}.requires_openai_auth=false`,
        "--config",
        `model_providers.${PROVIDER_ID}.supports_websockets=false`,
        ...(mcpCommand ? ["--config", `mcp_servers.maple.command=${tomlString(mcpCommand)}`] : []),
        ...(mcpCommand && mcpArgs ? ["--config", `mcp_servers.maple.args=${mcpArgs}`] : []),
        "--sandbox",
        options?.readOnly ? "read-only" : "workspace-write",
        ...(options?.additionalWritableDirectories ?? []).flatMap((directory) => ["--add-dir", directory]),
        "--skip-git-repo-check",
        "--json",
        ...resume
      ],
      ...(Object.keys(commandEnv).length > 0 ? { env: commandEnv } : {}),
      stdin: prompt
    };
  },
  async prepareRun({ cwd, readOnly, additionalWritableDirectories }) {
    return prepareCodexWindowsSandbox(cwd, { readOnly, additionalWritableDirectories });
  },
  createOutputParser: () => createCodexOutputParser("DeepSeek")
};

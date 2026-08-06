import type { CodingAgentAdapter } from "./types";
import { CODEX_AUTOMATION_PREFIX, createCodexOutputParser } from "./codex";
import { prepareCodexWindowsSandbox } from "../windows-sandbox";

const DEFAULT_MODEL = "deepseek-v4-flash";
const PROVIDER_ID = "maple_deepseek";
/** 长 Workflow 会话在任务中途也受 codex 自动压缩封顶，避免每次请求重读近百万上下文。 */
const DEFAULT_AUTO_COMPACT_TOKEN_LIMIT = 300_000;

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function autoCompactConfig(env: Record<string, string | undefined>): string[] {
  const raw = env.MAPLE_DEEPSEEK_AUTO_COMPACT_TOKEN_LIMIT?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_AUTO_COMPACT_TOKEN_LIMIT;
  // 设为 0 / 空 表示关闭自动压缩；过低的值会频繁压缩，质量风险大。
  if (!Number.isSafeInteger(parsed) || parsed < 1_000) return [];
  // codex 的 model_auto_compact_token_limit 是 i64，不能加引号，否则报
  // invalid type: string "...", expected i64。
  return ["--config", `model_auto_compact_token_limit=${parsed}`];
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
        ...autoCompactConfig(env),
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
        ...(options?.windowsSandboxBypass
          ? ["--dangerously-bypass-approvals-and-sandbox"]
          : options?.readOnly
            ? ["--sandbox", "read-only"]
            : options?.fullAccess
              ? ["--sandbox", "danger-full-access"]
              : ["--sandbox", "workspace-write"]),
        ...(options?.additionalWritableDirectories ?? []).flatMap((directory) => ["--add-dir", directory]),
        "--skip-git-repo-check",
        "--json",
        ...resume
      ],
      ...(Object.keys(commandEnv).length > 0 ? { env: commandEnv } : {}),
      stdin: prompt
    };
  },
  async prepareRun({ cwd, readOnly, additionalWritableDirectories, windowsSandboxBypass }) {
    return prepareCodexWindowsSandbox(cwd, {
      readOnly,
      additionalWritableDirectories,
      bypass: windowsSandboxBypass
    });
  },
  createOutputParser: () => createCodexOutputParser("DeepSeek")
};

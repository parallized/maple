import type { CodingAgentAdapter } from "./types";
import { createOpenCodeOutputParser } from "./opencode";

const DEFAULT_GLM_MODEL = "zai-coding-plan/glm-5.2";

/** GLM 是独立 Worker 兼容层，默认使用官方支持的 OpenCode 作为 Agent 宿主。 */
export const glmAdapter: CodingAgentAdapter = {
  kind: "glm",
  label: "GLM",
  buildCommand(prompt, env, options) {
    const model = env.MAPLE_GLM_MODEL?.trim() || DEFAULT_GLM_MODEL;
    return {
      executable: env.MAPLE_GLM_BIN?.trim() || env.MAPLE_OPENCODE_BIN?.trim() || "opencode",
      args: [
        "run",
        ...(options?.readOnly ? [] : ["--auto"]),
        "--format",
        "json",
        "--model",
        model,
        ...(options?.resumeSessionId ? ["--session", options.resumeSessionId] : []),
        prompt
      ]
    };
  },
  createOutputParser: createOpenCodeOutputParser
};

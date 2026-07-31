import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatWorkerModelName, resolveWorkerModelIdentity } from "../src/execution/model-identity";

const temporaryDirectories: string[] = [];

function temporaryHome(): string {
  const directory = mkdtempSync(join(tmpdir(), "maple-worker-model-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Worker model identity", () => {
  it("formats exact Provider model IDs without losing version or context size", () => {
    expect(formatWorkerModelName("codex", "gpt-5.6-sol")).toBe("GPT 5.6 Sol");
    expect(formatWorkerModelName("claude", "opus[1m]")).toBe("Claude Opus 1M");
    expect(formatWorkerModelName("kimi", "kimi-code/k3-256k")).toBe("Kimi K3 256K");
    expect(formatWorkerModelName("glm", "zai-coding-plan/glm-5.2")).toBe("GLM 5.2");
    expect(formatWorkerModelName("deepseek", "deepseek-v4-flash")).toBe("DeepSeek V4 Flash");
  });

  it("reads only the selected Codex and Kimi model fields from local config", () => {
    const home = temporaryHome();
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".kimi-code"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "ultra"\napi_key = "must-not-leak"\n',
      "utf8"
    );
    writeFileSync(
      join(home, ".kimi-code", "config.toml"),
      'default_model = "kimi-code/k3-256k"\n',
      "utf8"
    );

    expect(resolveWorkerModelIdentity("codex", { USERPROFILE: home })).toEqual({
      modelId: "gpt-5.6-sol",
      modelName: "GPT 5.6 Sol",
      reasoningEffort: "ultra"
    });
    expect(resolveWorkerModelIdentity("kimi", { USERPROFILE: home })).toEqual({
      modelId: "kimi-code/k3-256k",
      modelName: "Kimi K3 256K",
      reasoningEffort: null
    });
  });

  it("uses explicit Maple overrides and keeps GLM's executed default model exact", () => {
    expect(resolveWorkerModelIdentity("claude", {
      MAPLE_CLAUDE_MODEL: "claude-opus-4-1",
      MAPLE_CLAUDE_EFFORT: "max"
    })).toEqual({
      modelId: "claude-opus-4-1",
      modelName: "Claude Opus 4 1",
      reasoningEffort: "max"
    });
    expect(resolveWorkerModelIdentity("glm", {})).toEqual({
      modelId: "zai-coding-plan/glm-5.2",
      modelName: "GLM 5.2",
      reasoningEffort: null
    });
    expect(resolveWorkerModelIdentity("deepseek", {})).toEqual({
      modelId: "deepseek-v4-flash",
      modelName: "DeepSeek V4 Flash",
      reasoningEffort: "high"
    });
  });
});

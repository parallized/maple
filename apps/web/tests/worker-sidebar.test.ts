import { describe, expect, it } from "bun:test";
import { buildSidebarWorkers, type RunnerSummary } from "@maple/board-ui";
import type { Runner } from "@maple/protocol";
import { mapSnapshotToRunners } from "../src/board/snapshot-mapper";

function runner(overrides: Partial<RunnerSummary> = {}): RunnerSummary {
  return {
    id: "runner-1",
    name: "Main workstation",
    hostname: "maple-host",
    platform: "win32/x64",
    state: "online",
    lastSeenAt: "2026-07-27T12:00:00.000Z",
    supportedWorkers: ["codex", "kimi"],
    workerInventory: [{
      kind: "codex",
      available: true,
      modelId: "gpt-5.6-sol",
      modelName: "GPT 5.6 Sol",
      reasoningEffort: "ultra"
    }],
    ...overrides
  };
}

describe("Web Worker sidebar", () => {
  it("always lists every Worker type and keeps the exact model and effort visible", () => {
    const workers = buildSidebarWorkers([runner()]);

    expect(workers.map((worker) => worker.kind)).toEqual([
      "claude",
      "codex",
      "deepseek",
      "kimi",
      "glm",
      "iflow",
      "gemini",
      "opencode"
    ]);
    expect(workers.find((worker) => worker.kind === "codex")).toMatchObject({
      state: "online",
      model: "5.6 Sol Ultra",
      title: "gpt-5.6-sol"
    });
    expect(workers.find((worker) => worker.kind === "claude")).toMatchObject({
      state: "missing",
      model: "未安装"
    });
  });

  it("distinguishes an old CLI from a disconnected Runner", () => {
    expect(buildSidebarWorkers([runner({ workerInventory: undefined })])[0]).toMatchObject({
      state: "unknown",
      model: "等待 CLI 上报"
    });
    expect(buildSidebarWorkers([])[0]).toMatchObject({
      state: "no_runner",
      model: "暂无执行端"
    });
  });

  it("maps Server inventory into the shared board domain without dropping model precision", () => {
    const protocolRunner: Runner = {
      ...runner(),
      version: "0.1.7",
      createdAt: "2026-07-27T10:00:00.000Z",
      projectIds: ["project-1"],
      capabilities: ["project_manager_v1"]
    };
    const mapped = mapSnapshotToRunners({ runners: [protocolRunner] } as never);

    expect(mapped[0]?.workerInventory?.[0]).toEqual({
      kind: "codex",
      available: true,
      modelId: "gpt-5.6-sol",
      modelName: "GPT 5.6 Sol",
      reasoningEffort: "ultra"
    });
  });

  it("splits one Worker type into one row per distinct model across runners", () => {
    const workers = buildSidebarWorkers([
      runner({
        id: "runner-a",
        name: "主机 A",
        workerInventory: [
          { kind: "codex", available: true, modelId: "gpt-5.5", modelName: "GPT 5.5", reasoningEffort: "high" }
        ]
      }),
      runner({
        id: "runner-b",
        name: "主机 B",
        workerInventory: [
          { kind: "codex", available: true, modelId: "gpt-5.6-luna", modelName: "GPT 5.6 Luna", reasoningEffort: "max" }
        ]
      })
    ]);

    const codexRows = workers.filter((worker) => worker.kind === "codex");
    expect(codexRows).toHaveLength(2);
    expect(codexRows.map((worker) => worker.model)).toEqual(["5.5 High", "5.6 Luna Max"]);
    expect(codexRows.map((worker) => worker.title)).toEqual(["gpt-5.5", "gpt-5.6-luna"]);
    expect(new Set(workers.map((worker) => worker.uid)).size).toBe(workers.length);
  });
});

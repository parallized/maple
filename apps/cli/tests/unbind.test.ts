import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearRunnerBinding, unbindRunner, type RunnerUnbindApi } from "../src/auth/unbind";
import { loadConfig, saveConfig } from "../src/config/store";
import type { CliConfig } from "../src/config/types";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function connectedConfig(): CliConfig {
  return {
    version: 1,
    serverUrl: "https://maple.example.com",
    runner: {
      id: "runner-1",
      token: "runner-token",
      name: "Office CLI",
      workspaceId: "workspace-1",
      workspaceName: "Engineering"
    },
    projects: [{
      localId: "local-1",
      projectId: "project-1",
      bindingId: "binding-1",
      externalKey: "git:project-1",
      name: "Maple",
      path: "C:\\Projects\\Maple",
      repositoryUrl: null,
      defaultBranch: null,
      gitBranch: null,
      gitHead: null,
      workerKind: "codex",
      registeredAt: "2026-07-28T00:00:00.000Z"
    }]
  };
}

describe("CLI workspace unbinding", () => {
  it("revokes the remote credential and keeps only local project directories", async () => {
    const directory = mkdtempSync(join(tmpdir(), "maple-unbind-test-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "cli.json");
    saveConfig(connectedConfig(), configPath);
    let revokeCalls = 0;
    const api: RunnerUnbindApi = {
      async disconnectRunner() {
        revokeCalls += 1;
        return { revoked: true };
      }
    };

    const result = await unbindRunner(configPath, () => api);

    expect(revokeCalls).toBe(1);
    expect(result.changed).toBe(true);
    expect(result.runnerName).toBe("Office CLI");
    expect(loadConfig(configPath)).toEqual(clearRunnerBinding(connectedConfig()));
    expect(result.config.projects[0]?.path).toBe("C:\\Projects\\Maple");
  });

  it("does not clear local credentials when Server revocation fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "maple-unbind-test-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "cli.json");
    const original = connectedConfig();
    saveConfig(original, configPath);

    await expect(unbindRunner(configPath, () => ({
      async disconnectRunner() {
        throw new Error("Server unavailable");
      }
    }))).rejects.toThrow("Server unavailable");

    expect(loadConfig(configPath)).toEqual(original);
  });
});

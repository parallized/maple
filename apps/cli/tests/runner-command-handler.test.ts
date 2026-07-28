import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ClaimRunnerCommandResponse,
  CompleteRunnerCommandRequest,
  RegisterProjectRequest,
  RegisterProjectResponse,
  RunnerCommand
} from "@maple/protocol";
import { createEmptyConfig, loadConfig, saveConfig } from "../src/config/store";
import { handleRunnerCommand, type RunnerCommandApi } from "../src/runner/runner-command-handler";

const temporaryDirectories: string[] = [];
const RUNNER_ID = "runner-test";
const LEASE_TOKEN = "runner-command-lease-token-1234567890";

function runnerCommand(): RunnerCommand {
  const now = new Date().toISOString();
  return {
    id: "command-test",
    runnerId: RUNNER_ID,
    type: "select_project_directory",
    status: "claimed",
    resultProjectId: null,
    resultBindingId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    claimedAt: now,
    completedAt: null
  };
}

function claimedCommand(): ClaimRunnerCommandResponse {
  return { command: runnerCommand(), leaseToken: LEASE_TOKEN, retryAfterMs: 0 };
}

class FakeRunnerCommandApi implements RunnerCommandApi {
  readonly registrations: RegisterProjectRequest[] = [];
  readonly completions: Array<{ commandId: string; input: CompleteRunnerCommandRequest }> = [];

  async registerProject(input: RegisterProjectRequest): Promise<RegisterProjectResponse> {
    this.registrations.push(input);
    const now = new Date().toISOString();
    return {
      project: {
        id: "project-test",
        externalKey: input.externalKey,
        name: input.name,
        repositoryUrl: input.repositoryUrl ?? null,
        defaultBranch: input.defaultBranch ?? null,
        bindingCount: 1,
        onlineRunnerCount: 1,
        createdAt: now,
        updatedAt: now
      },
      binding: {
        id: "binding-test",
        projectId: "project-test",
        runnerId: RUNNER_ID,
        runnerName: "Test runner",
        workspaceLabel: input.workspaceLabel,
        gitBranch: input.gitBranch ?? null,
        gitHead: input.gitHead ?? null,
        lastSeenAt: now
      }
    };
  }

  async completeRunnerCommand(commandId: string, input: CompleteRunnerCommandRequest): Promise<RunnerCommand> {
    this.completions.push({ commandId, input });
    return {
      ...runnerCommand(),
      status: input.outcome,
      resultProjectId: input.projectId ?? null,
      resultBindingId: input.bindingId ?? null,
      error: input.error ?? null,
      completedAt: new Date().toISOString()
    };
  }
}

function createFixture(): { configPath: string; projectPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "maple-runner-command-"));
  temporaryDirectories.push(directory);
  const projectPath = join(directory, "demo-project");
  const configPath = join(directory, "cli.json");
  mkdirSync(projectPath);
  saveConfig(
    {
      ...createEmptyConfig(),
      serverUrl: "http://maple.test",
      runner: { id: RUNNER_ID, token: "runner-token", name: "Test runner" }
    },
    configPath
  );
  return { configPath, projectPath };
}

function output() {
  return { info: (_message: string) => undefined, warn: (_message: string) => undefined };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("runner directory selection command", () => {
  it("reports cancellation without changing local projects", async () => {
    const fixture = createFixture();
    const api = new FakeRunnerCommandApi();

    const config = await handleRunnerCommand({
      api,
      claim: claimedCommand(),
      configPath: fixture.configPath,
      signal: new AbortController().signal,
      output: output(),
      directoryPicker: async () => null
    });

    expect(config.projects).toHaveLength(0);
    expect(api.registrations).toHaveLength(0);
    expect(api.completions).toEqual([
      { commandId: "command-test", input: { leaseToken: LEASE_TOKEN, outcome: "cancelled" } }
    ]);
  });

  it("registers the selected directory and only returns opaque IDs to Server", async () => {
    const fixture = createFixture();
    const api = new FakeRunnerCommandApi();

    const config = await handleRunnerCommand({
      api,
      claim: claimedCommand(),
      configPath: fixture.configPath,
      signal: new AbortController().signal,
      output: output(),
      directoryPicker: async () => fixture.projectPath
    });

    expect(config.projects).toHaveLength(1);
    expect(loadConfig(fixture.configPath).projects[0]?.path).toBe(fixture.projectPath);
    expect(api.registrations).toHaveLength(1);
    expect("path" in api.registrations[0]!).toBe(false);
    expect("workerKind" in api.registrations[0]!).toBe(false);
    expect(api.completions).toEqual([
      {
        commandId: "command-test",
        input: {
          leaseToken: LEASE_TOKEN,
          outcome: "succeeded",
          projectId: "project-test",
          bindingId: "binding-test"
        }
      }
    ]);
    expect(JSON.stringify(api.completions)).not.toContain(fixture.projectPath.replaceAll("\\", "\\\\"));
  });

  it("returns a product-safe error when the native picker cannot open", async () => {
    const fixture = createFixture();
    const api = new FakeRunnerCommandApi();

    await handleRunnerCommand({
      api,
      claim: claimedCommand(),
      configPath: fixture.configPath,
      signal: new AbortController().signal,
      output: output(),
      directoryPicker: async () => {
        throw new Error(`private path: ${fixture.projectPath}`);
      }
    });

    expect(api.completions[0]?.input).toEqual({
      leaseToken: LEASE_TOKEN,
      outcome: "failed",
      error: "执行端无法打开本机目录选择器。"
    });
    expect(JSON.stringify(api.completions)).not.toContain(fixture.projectPath.replaceAll("\\", "\\\\"));
  });

  it("does not open a picker after the runner starts shutting down", async () => {
    const fixture = createFixture();
    const api = new FakeRunnerCommandApi();
    const controller = new AbortController();
    let opened = false;
    controller.abort();

    await handleRunnerCommand({
      api,
      claim: claimedCommand(),
      configPath: fixture.configPath,
      signal: controller.signal,
      output: output(),
      directoryPicker: async () => {
        opened = true;
        return fixture.projectPath;
      }
    });

    expect(opened).toBe(false);
    expect(api.registrations).toHaveLength(0);
    expect(api.completions).toHaveLength(0);
  });

  it("does not expose an invalid selected path in the failure result", async () => {
    const fixture = createFixture();
    const api = new FakeRunnerCommandApi();
    const missingPath = join(fixture.projectPath, "private-missing-project");

    await handleRunnerCommand({
      api,
      claim: claimedCommand(),
      configPath: fixture.configPath,
      signal: new AbortController().signal,
      output: output(),
      directoryPicker: async () => missingPath
    });

    expect(api.completions[0]?.input).toEqual({
      leaseToken: LEASE_TOKEN,
      outcome: "failed",
      error: "执行端未能注册所选项目目录。"
    });
    expect(JSON.stringify(api.completions)).not.toContain(missingPath.replaceAll("\\", "\\\\"));
  });
});

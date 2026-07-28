import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RegisterProjectRequest, RegisterProjectResponse } from "@maple/protocol";
import type { MapleApiClient } from "../src/api/client";
import { createEmptyConfig, loadConfig, saveConfig } from "../src/config/store";
import type { LocalProject } from "../src/config/types";
import {
  adjacentLogPane,
  appendLogText,
  createProjectManagerLogPane,
  createWorkerLogPanes,
  visibleLogPaneKeys
} from "../src/tui/log-panes";
import {
  selectAndRegisterProject,
  synchronizeProjects,
  type ProjectRegistrationApi
} from "../src/project/register";
import {
  bottomAlignLogLines,
  isAddProjectKey,
  projectManagerLineLabel,
  projectManagerStatusLabel,
  projectManagerTabLabel,
  recentProjectNames,
  taskTabLabel
} from "../src/tui/runner-view";

const temporaryDirectories: string[] = [];

class FakeProjectApi implements ProjectRegistrationApi {
  readonly registrations: RegisterProjectRequest[] = [];

  async registerProject(input: RegisterProjectRequest): Promise<RegisterProjectResponse> {
    this.registrations.push(input);
    const now = new Date().toISOString();
    return {
      project: {
        id: "project-added-from-runner",
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
        id: "binding-added-from-runner",
        projectId: "project-added-from-runner",
        runnerId: "runner-test",
        runnerName: "Test runner",
        workspaceLabel: input.workspaceLabel,
        gitBranch: input.gitBranch ?? null,
        gitHead: input.gitHead ?? null,
        lastSeenAt: now
      }
    };
  }
}

function fixture(): { configPath: string; projectPath: string } {
  const root = mkdtempSync(join(tmpdir(), "maple-runner-project-add-"));
  temporaryDirectories.push(root);
  const configPath = join(root, "cli.json");
  const projectPath = join(root, "new-project");
  mkdirSync(projectPath);
  saveConfig(createEmptyConfig(), configPath);
  return { configPath, projectPath };
}

function localProject(name: string, registeredAt: string | null): LocalProject {
  return {
    localId: `local-${name}`,
    projectId: `project-${name}`,
    bindingId: `binding-${name}`,
    externalKey: `local:${name}`,
    name,
    path: `C:\\projects\\${name}`,
    repositoryUrl: null,
    defaultBranch: null,
    gitBranch: null,
    gitHead: null,
    workerKind: "codex",
    registeredAt
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("runner project shortcut", () => {
  it("recognizes both E key variants", () => {
    expect(isAddProjectKey({ name: "char", char: "e" })).toBe(true);
    expect(isAddProjectKey({ name: "char", char: "E" })).toBe(true);
    expect(isAddProjectKey({ name: "char", char: "q" })).toBe(false);
  });

  it("shows the two most recently registered project names", () => {
    const config = {
      ...createEmptyConfig(),
      projects: [
        localProject("Old project", "2026-07-25T08:00:00.000Z"),
        localProject("Newest project", "2026-07-27T08:00:00.000Z"),
        localProject("Recent project", "2026-07-26T08:00:00.000Z")
      ]
    };

    expect(recentProjectNames(config)).toEqual(["Newest project", "Recent project"]);
  });

  it("labels tasks with sequence, project and Coding Agent", () => {
    expect(taskTabLabel(0, "Maple", "codex")).toBe("1 Maple · Codex");
    expect(taskTabLabel(1, "API", "kimi")).toBe("2 API · Kimi");
    expect(projectManagerTabLabel("Maple", "codex")).toBe("PM Maple · Codex");
    expect(projectManagerTabLabel("Maple")).toBe("PM Maple · Coding Agent");
  });

  it("places the project manager state directly after the project name", () => {
    expect(projectManagerStatusLabel()).toBe("PM待命");
    expect(projectManagerStatusLabel("diagnosing")).toBe("PM诊断中");
    expect(projectManagerStatusLabel("dispatched")).toBe("PM已派单");
    expect(projectManagerStatusLabel("failed")).toBe("PM异常");
    expect(projectManagerLineLabel("Maple", "diagnosing")).toBe("Maple PM诊断中");
    expect(projectManagerLineLabel("Maple", "diagnosing")).not.toContain("·");
  });

  it("starts Worker output at the bottom and scrolls new lines upward", () => {
    expect(bottomAlignLogLines(["first"], 4)).toEqual(["", "", "", "first"]);
    expect(bottomAlignLogLines(["first", "second"], 4)).toEqual(["", "", "first", "second"]);
    expect(bottomAlignLogLines(["first", "second", "third"], 2)).toEqual(["second", "third"]);
  });

  it("keeps PM diagnostics in a separate navigable log pane", () => {
    const manager = createProjectManagerLogPane();
    const workers = createWorkerLogPanes(2);
    manager.running = true;
    appendLogText(manager, "PM line\n", 500);
    workers[1]!.logs.push("Worker line");

    const visible = visibleLogPaneKeys(manager, workers);
    expect(visible).toEqual(["manager", 1]);
    expect(adjacentLogPane("manager", 1, visible)).toBe(1);
    expect(adjacentLogPane(1, 1, visible)).toBe("manager");
    expect(manager.logs).toEqual(["PM line"]);
  });

  it("registers the selected directory and refreshes local config", async () => {
    const { configPath, projectPath } = fixture();
    const api = new FakeProjectApi();

    const result = await selectAndRegisterProject(api, {
      configPath,
      directoryPicker: async () => projectPath
    });

    expect(result?.project.path).toBe(projectPath);
    expect(result?.project.projectId).toBe("project-added-from-runner");
    expect(loadConfig(configPath).projects[0]?.projectId).toBe("project-added-from-runner");
    expect(api.registrations).toHaveLength(1);
    expect("path" in api.registrations[0]!).toBe(false);
    expect("workerKind" in api.registrations[0]!).toBe(false);
  });

  it("does nothing when directory selection is cancelled", async () => {
    const { configPath } = fixture();
    const api = new FakeProjectApi();

    const result = await selectAndRegisterProject(api, {
      configPath,
      directoryPicker: async () => null
    });

    expect(result).toBeNull();
    expect(api.registrations).toHaveLength(0);
    expect(loadConfig(configPath).projects).toEqual([]);
  });

  it("does not recreate an already registered project during startup sync", async () => {
    const { configPath, projectPath } = fixture();
    const api = new FakeProjectApi();
    const added = await selectAndRegisterProject(api, {
      configPath,
      directoryPicker: async () => projectPath
    });

    await synchronizeProjects(api as unknown as MapleApiClient, added!.config, configPath);

    expect(api.registrations).toHaveLength(1);
    expect(loadConfig(configPath).projects[0]?.projectId).toBe("project-added-from-runner");
  });
});

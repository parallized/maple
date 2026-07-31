import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_WORKSPACE_EXECUTION_SETTINGS, type ProjectManagerJob } from "@maple/protocol";
import type { LocalProject } from "../src/config/types";
import type { WorkerExecutor } from "../src/execution/process-executor";
import {
  parseProjectManagerDecision,
  selectProjectManagerWorker,
  selectProjectManagerWorkerForJob
} from "../src/manager/decision";
import { buildProjectManagerPrompt } from "../src/manager/prompt";
import {
  runProjectManager,
  type ProjectManagerDiagnosticEvent
} from "../src/manager/project-manager";
import { buildWorkerCommand } from "../src/execution/worker-command";
import { AgentSessionStore } from "../src/session/store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function managerJob(): ProjectManagerJob {
  const now = "2026-07-27T08:00:00.000Z";
  return {
    todo: {
      id: "todo-c",
      projectId: "project-1",
      title: "Test refresh token expiry",
      details: "Continue authentication refresh handling.",
      status: "todo",
      priority: 0,
      workerKind: "codex",
      claimedByRunnerId: null,
      activeAttemptId: null,
      leaseExpiresAt: null,
      resultSummary: null,
      lastError: null,
      tags: [],
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null
    },
    project: {
      id: "project-1",
      externalKey: "local:project-1",
      name: "Managed project",
      repositoryUrl: null,
      defaultBranch: null,
      bindingCount: 1,
      onlineRunnerCount: 1,
      createdAt: now,
      updatedAt: now
    },
    binding: {
      id: "binding-1",
      projectId: "project-1",
      runnerId: "runner-1",
      runnerName: "Runner",
      workspaceLabel: "managed-project",
      gitBranch: "main",
      gitHead: "abc",
      lastSeenAt: now
    },
    workflows: [{
      id: "workflow-auth",
      projectId: "project-1",
      title: "Token refresh",
      summary: "Implement and verify token refresh.",
      createdAt: now,
      updatedAt: now
    }],
    history: [{
      todoId: "todo-a",
      title: "Implement token refresh",
      details: "Add endpoint.",
      status: "running",
      workerKind: "kimi",
      workflowId: "workflow-auth",
      resultSummary: null,
      dispatchBrief: "Implement the endpoint.",
      updatedAt: now
    }],
    availableWorkers: ["codex", "kimi"],
    attemptId: "manager-attempt-1",
    leaseToken: "manager-lease-token-123456789012345",
    leaseSeconds: 900
  };
}

describe("Project manager dispatch", () => {
  it("parses a compact decision that continues an existing Workflow", () => {
    const decision = parseProjectManagerDecision(JSON.stringify({
      workflowId: "workflow-auth",
      workflowTitle: "Token refresh",
      workflowSummary: "Finish refresh handling and its tests.",
      executionMode: "serial",
      workerKind: "kimi",
      dispatchBrief: "Continue the existing authentication context."
    }), managerJob());

    expect(decision).toEqual({
      workflowId: "workflow-auth",
      workflowTitle: "Token refresh",
      workflowSummary: "Finish refresh handling and its tests.",
      executionMode: "serial",
      selectedWorkerKind: "codex",
      dispatchBrief: "Continue the existing authentication context."
    });
  });

  it("keeps project instructions in the stable prefix and forbids implementation planning", () => {
    const prompt = buildProjectManagerPrompt(managerJob(), {
      stableContext: "AGENTS.md\nOnly read the repository.",
      workingState: "Working tree clean."
    });

    expect(prompt).toContain("只读，不修改项目，也不改派用户指定的 Worker");
    expect(prompt).toContain("不要深度分析、搜索仓库或执行任务");
    expect(prompt).toContain("不要 Markdown、解释或实施步骤");
    expect(prompt).toContain("只返回 JSON");
    expect(prompt).toContain("立即返回派单 JSON");
    expect(prompt).toContain("不改派用户指定的 Worker");
    expect(prompt.indexOf("AGENTS.md")).toBeLessThan(prompt.indexOf("新 Todo"));
  });

  it("uses one configured available Agent as the persistent project manager", () => {
    expect(selectProjectManagerWorker(["codex", "kimi"], { MAPLE_MANAGER_WORKER: "kimi" })).toBe("kimi");
    expect(selectProjectManagerWorker(["codex", "kimi"], {})).toBe("codex");
    expect(selectProjectManagerWorkerForJob({
      availableWorkers: ["codex", "kimi"],
      executionSettings: {
        ...DEFAULT_WORKSPACE_EXECUTION_SETTINGS,
        defaultWorker: "codex",
        baseWorker: "codex",
        leaderWorker: "kimi"
      }
    }, {})).toBe("kimi");
  });

  it("asks the Leader PM for a report when the required Worker is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-project-manager-blocked-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    const job = managerJob();
    job.todo.workerKind = "kimi";
    job.availableWorkers = ["codex"];
    const store = new AgentSessionStore(join(root, "cli.json"));
    store.save({
      scope: "manager",
      scopeId: job.project.id,
      workerKind: "codex",
      sessionId: "leader-pm-session"
    });
    const prompts: string[] = [];
    const executor: WorkerExecutor = async (options) => {
      prompts.push(options.prompt);
      expect(options.workerKind).toBe("codex");
      expect(options.readOnly).toBe(true);
      expect(options.summaryMode).toBe("strict-report");
      expect(options.resumeSessionId).toBe("leader-pm-session");
      return {
        success: true,
        exitCode: 0,
        summary: "Kimi 当前不可用，任务未执行。",
        error: null,
        usage: null,
        sessionId: "leader-pm-session",
        sessionUnavailable: false
      };
    };
    const project: LocalProject = {
      localId: "local-project-1",
      projectId: "project-1",
      bindingId: "binding-1",
      externalKey: "local:project-1",
      name: "Managed project",
      path: projectPath,
      repositoryUrl: null,
      defaultBranch: null,
      gitBranch: null,
      gitHead: null,
      workerKind: "codex",
      registeredAt: "2026-07-27T08:00:00.000Z"
    };

    const result = await runProjectManager(
      job,
      project,
      new AbortController().signal,
      "direct",
      projectPath,
      store,
      executor
    );

    expect(result).toEqual({
      outcome: "blocked",
      managerWorkerKind: "codex",
      report: "Kimi 当前不可用，任务未执行。"
    });
    expect(prompts[0]).toContain("不得改派、替换、调用或建议任何其他 Worker");
    expect(prompts[0]).toContain("简短标题、项目符号或有序列表");
    expect(prompts[0]).not.toContain("报告不得超过");
    expect(prompts[0]).toContain('"requiredWorkerKind":"kimi"');
    expect(prompts[0]).toContain('"availableWorkers":["codex"]');
  });

  it("launches supported manager adapters without automatic write permission", () => {
    const codexArgs = buildWorkerCommand("codex", "route", "direct", {}, { readOnly: true }).args;
    expect(codexArgs).toContain("read-only");
    expect(codexArgs.slice(0, 3)).toEqual(["--ask-for-approval", "never", "exec"]);

    const deepSeekArgs = buildWorkerCommand("deepseek", "route", "direct", {}, { readOnly: true }).args;
    expect(deepSeekArgs).toContain("read-only");
    expect(deepSeekArgs.slice(0, 3)).toEqual(["--ask-for-approval", "never", "exec"]);

    const claudeArgs = buildWorkerCommand("claude", "route", "direct", {}, { readOnly: true }).args;
    expect(claudeArgs).toContain("plan");
    expect(claudeArgs).not.toContain("auto");

    const kimiArgs = buildWorkerCommand("kimi", "route", "direct", {}, { readOnly: true }).args;
    expect(kimiArgs).toContain("--plan");
    expect(kimiArgs).not.toContain("--auto");

    expect(buildWorkerCommand("opencode", "route", "direct", {}, { readOnly: true }).args)
      .not.toContain("--auto");
  });

  it("resumes the same per-project manager session after a CLI restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-project-manager-session-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    const configPath = join(root, "cli.json");
    const project: LocalProject = {
      localId: "local-project-1",
      projectId: "project-1",
      bindingId: "binding-1",
      externalKey: "local:project-1",
      name: "Managed project",
      path: projectPath,
      repositoryUrl: null,
      defaultBranch: null,
      gitBranch: null,
      gitHead: null,
      workerKind: "codex",
      registeredAt: "2026-07-27T08:00:00.000Z"
    };
    const resumeIds: Array<string | undefined> = [];
    const reasoningEfforts: Array<string | undefined> = [];
    const prompts: string[] = [];
    const diagnostics: ProjectManagerDiagnosticEvent[] = [];
    const executor: WorkerExecutor = async (options) => {
      resumeIds.push(options.resumeSessionId);
      reasoningEfforts.push(options.reasoningEffort);
      prompts.push(options.prompt);
      await options.onLog({
        sequence: 0,
        occurredAt: "2026-07-27T08:00:01.000Z",
        stream: "stdout",
        kind: "tool",
        level: "info",
        status: "completed",
        title: "读取项目",
        content: "读取项目结构"
      });
      options.onSession?.("pm-session-1");
      return {
        success: true,
        exitCode: 0,
        summary: JSON.stringify({
          workflowId: "workflow-auth",
          workflowTitle: "Token refresh",
          workflowSummary: "Finish refresh handling and its tests.",
          executionMode: "serial",
          workerKind: "kimi",
          dispatchBrief: "Continue the existing authentication context."
        }),
        error: null,
        usage: null,
        sessionId: "pm-session-1",
        sessionUnavailable: false
      };
    };

    const firstStore = new AgentSessionStore(configPath);
    const managerWorkspace = firstStore.workspace("manager", "project-1");
    mkdirSync(managerWorkspace, { recursive: true });
    await runProjectManager(
      managerJob(),
      project,
      new AbortController().signal,
      "direct",
      managerWorkspace,
      firstStore,
      executor,
      (event) => {
        diagnostics.push(event);
      }
    );
    await runProjectManager(
      managerJob(),
      project,
      new AbortController().signal,
      "direct",
      managerWorkspace,
      new AgentSessionStore(configPath),
      executor,
      (event) => {
        diagnostics.push(event);
      }
    );

    expect(resumeIds).toEqual([undefined, "pm-session-1"]);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      managerWorkerKind: "codex",
      kind: "tool",
      title: "读取项目",
      content: "读取项目结构"
    });
    expect(prompts[0]).toContain("你是 Maple Leader，只负责快速归组和派单");
    expect(prompts[1]).toContain("续接当前项目经理会话；只处理新 Todo");
    expect(prompts.every((prompt) => !prompt.includes("受版本控制的文件（最多"))).toBe(true);
    expect(prompts.every((prompt) => !prompt.includes("只读源码摘录"))).toBe(true);
    expect(prompts.every((prompt) => prompt.length < 1_800)).toBe(true);
    expect(reasoningEfforts).toEqual(["low", "low"]);
    expect(new AgentSessionStore(configPath).read("manager", "project-1", "codex")?.sessionId)
      .toBe("pm-session-1");
  });

  it("rebuilds a missing Provider session from the project context", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-project-manager-recovery-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    const store = new AgentSessionStore(join(root, "cli.json"));
    store.save({
      scope: "manager",
      scopeId: "project-1",
      workerKind: "codex",
      sessionId: "expired-session"
    });
    const attempts: Array<string | undefined> = [];
    const executor: WorkerExecutor = async (options) => {
      attempts.push(options.resumeSessionId);
      if (options.resumeSessionId) {
        return {
          success: false,
          exitCode: 1,
          summary: "",
          error: "Session not found",
          usage: null,
          sessionId: options.resumeSessionId,
          sessionUnavailable: true
        };
      }
      options.onSession?.("replacement-session");
      return {
        success: true,
        exitCode: 0,
        summary: JSON.stringify({
          workflowId: "workflow-auth",
          workflowTitle: "Token refresh",
          workflowSummary: "Continue refresh handling.",
          executionMode: "serial",
          workerKind: "codex",
          dispatchBrief: "Recover from Maple history."
        }),
        error: null,
        usage: null,
        sessionId: "replacement-session",
        sessionUnavailable: false
      };
    };
    const project: LocalProject = {
      localId: "local-project-1",
      projectId: "project-1",
      bindingId: "binding-1",
      externalKey: "local:project-1",
      name: "Managed project",
      path: projectPath,
      repositoryUrl: null,
      defaultBranch: null,
      gitBranch: null,
      gitHead: null,
      workerKind: "codex",
      registeredAt: "2026-07-27T08:00:00.000Z"
    };
    const managerWorkspace = store.workspace("manager", "project-1");
    mkdirSync(managerWorkspace, { recursive: true });

    await runProjectManager(
      managerJob(),
      project,
      new AbortController().signal,
      "direct",
      managerWorkspace,
      store,
      executor
    );

    expect(attempts).toEqual(["expired-session", undefined]);
    expect(store.read("manager", "project-1", "codex")?.sessionId).toBe("replacement-session");
  });
});

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
import { DEFAULT_MANAGER_TIMEOUT_MS, runManagerAgentTurn } from "../src/manager/agent-turn";
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
      workerKind: "codex",
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
      workerKind: "codex",
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
  it("limits a Leader turn to 30 seconds and reports its own timeout cause", async () => {
    expect(DEFAULT_MANAGER_TIMEOUT_MS).toBe(30_000);
    const executor: WorkerExecutor = async (options) => await new Promise((resolve) => {
      const finish = () => resolve({
        success: false,
        exitCode: null,
        summary: "",
        error: typeof options.signal.reason === "string" ? options.signal.reason : "cancelled",
        usage: null,
        sessionId: null,
        sessionUnavailable: false
      });
      options.signal.addEventListener("abort", finish, { once: true });
      if (options.signal.aborted) finish();
    });

    await expect(runManagerAgentTurn({
      projectId: "project-1",
      managerWorkerKind: "codex",
      managerWorkspace: ".",
      signal: new AbortController().signal,
      shell: "direct",
      buildPrompt: () => "route",
      executor,
      timeoutMs: 5
    })).rejects.toThrow("Leader PM 执行超过 1 秒，已自动停止本次派单。");
  });

  it("keeps an external CLI stop distinct from a Leader timeout", async () => {
    const controller = new AbortController();
    const executor: WorkerExecutor = async (options) => await new Promise((resolve) => {
      const finish = () => resolve({
        success: false,
        exitCode: null,
        summary: "",
        error: typeof options.signal.reason === "string" ? options.signal.reason : "cancelled",
        usage: null,
        sessionId: null,
        sessionUnavailable: false
      });
      options.signal.addEventListener("abort", finish, { once: true });
      if (options.signal.aborted) finish();
    });
    const turn = runManagerAgentTurn({
      projectId: "project-1",
      managerWorkerKind: "codex",
      managerWorkspace: ".",
      signal: controller.signal,
      shell: "direct",
      buildPrompt: () => "route",
      executor,
      timeoutMs: 10_000
    });

    controller.abort();

    await expect(turn).rejects.toThrow("Maple CLI 已停止，Leader PM 派单已取消。");
  });

  it("runs a DeepSeek Leader with terminal completion and an isolated provider home", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-deepseek-leader-"));
    temporaryDirectories.push(root);
    let captured: {
      disableMcp?: boolean;
      completeOnTerminalEvent?: boolean;
      isolatedHome?: string;
    } | null = null;
    let capturedResumeSessionId: string | undefined;
    const executor: WorkerExecutor = async (options) => {
      captured = options;
      capturedResumeSessionId = options.resumeSessionId;
      return {
        success: true,
        exitCode: 0,
        summary: "{}",
        error: null,
        usage: null,
        sessionId: "fresh-deepseek-session",
        sessionUnavailable: false
      };
    };

    await runManagerAgentTurn({
      projectId: "project-1",
      managerWorkerKind: "deepseek",
      managerWorkspace: root,
      signal: new AbortController().signal,
      shell: "direct",
      buildPrompt: () => "route",
      executor
    });

    expect(captured).toMatchObject({
      disableMcp: true,
      completeOnTerminalEvent: true,
      isolatedHome: join(root, "deepseek-codex-home")
    });
    expect(capturedResumeSessionId).toBeUndefined();
  });

  it("parses a compact decision that continues an existing Workflow", () => {
    const decision = parseProjectManagerDecision(JSON.stringify({
      workflowId: "workflow-auth",
      workflowTitle: "Token refresh",
      workflowSummary: "Finish refresh handling and its tests.",
      workerKind: "kimi",
      dispatchBrief: "Continue the existing authentication context."
    }), managerJob());

    expect(decision).toEqual({
      workflowId: "workflow-auth",
      workflowTitle: "Token refresh",
      workflowSummary: "Finish refresh handling and its tests.",
      selectedWorkerKind: "codex",
      dispatchBrief: "Continue the existing authentication context."
    });
  });

  it("creates a new Workflow when the requested bucket belongs to another Worker", () => {
    const job = managerJob();
    job.workflows[0]!.workerKind = "kimi";

    const decision = parseProjectManagerDecision(JSON.stringify({
      workflowId: "workflow-auth",
      workflowTitle: "Token refresh",
      workflowSummary: "Finish refresh handling and its tests.",
      dispatchBrief: "Continue the existing authentication context."
    }), job);

    expect(decision.workflowId).toBeNull();
    expect(decision.selectedWorkerKind).toBe("codex");
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
    expect(prompt).toContain("只有任务彼此独立且可安全并发时才新建 Workflow");
    expect(prompt).toContain("Workflow 的 Worker 固定");
    expect(prompt).toContain('"workerKind":"codex"');
    expect(prompt).not.toContain("executionMode");
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
      expect(options.resumeSessionId).toBeUndefined();
      expect(options.disableMcp).toBe(true);
      expect(options.completeOnTerminalEvent).toBe(true);
      return {
        success: true,
        exitCode: 0,
        summary: "Kimi 当前不可用，任务未执行。",
        error: null,
        usage: {
          inputTokens: 120,
          cachedInputTokens: 40,
          outputTokens: 18,
          reasoningOutputTokens: 7
        },
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
      usage: {
        inputTokens: 120,
        cachedInputTokens: 40,
        outputTokens: 18,
        reasoningOutputTokens: 7
      },
      report: "Kimi 当前不可用，任务未执行。"
    });
    expect(prompts[0]).toContain("不得改派、替换、调用或建议任何其他 Worker");
    expect(prompts[0]).toContain("简短标题、项目符号或有序列表");
    expect(prompts[0]).not.toContain("报告不得超过");
    expect(prompts[0]).toContain('"requiredWorkerKind":"kimi"');
    expect(prompts[0]).toContain('"availableWorkers":["codex"]');
    expect(store.read("manager", job.project.id, "codex")).toBeNull();
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
    // Kimi CLI 禁止 --prompt 与 --auto / --plan 组合，非交互模式不携带权限模式参数。
    expect(kimiArgs).toContain("--prompt");
    expect(kimiArgs).not.toContain("--plan");
    expect(kimiArgs).not.toContain("--auto");

    expect(buildWorkerCommand("opencode", "route", "direct", {}, { readOnly: true }).args)
      .not.toContain("--auto");
  });

  it("starts a fresh Leader session for each Todo after a CLI restart", async () => {
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
    const terminalCompletionFlags: Array<boolean | undefined> = [];
    const mcpFlags: Array<boolean | undefined> = [];
    const prompts: string[] = [];
    const diagnostics: ProjectManagerDiagnosticEvent[] = [];
    const executor: WorkerExecutor = async (options) => {
      resumeIds.push(options.resumeSessionId);
      reasoningEfforts.push(options.reasoningEffort);
      terminalCompletionFlags.push(options.completeOnTerminalEvent);
      mcpFlags.push(options.disableMcp);
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
    firstStore.save({
      scope: "manager",
      scopeId: "project-1",
      workerKind: "codex",
      sessionId: "stale-pm-session"
    });
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

    expect(resumeIds).toEqual([undefined, undefined]);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      managerWorkerKind: "codex",
      kind: "tool",
      title: "读取项目",
      content: "读取项目结构"
    });
    expect(prompts[0]).toContain("你是 Maple Leader，只负责快速归组和任务分发");
    expect(prompts[1]).toContain("你是 Maple Leader，只负责快速归组和任务分发");
    expect(prompts.every((prompt) => !prompt.includes("续接当前项目经理会话"))).toBe(true);
    expect(prompts.every((prompt) => !prompt.includes("受版本控制的文件（最多"))).toBe(true);
    expect(prompts.every((prompt) => !prompt.includes("只读源码摘录"))).toBe(true);
    expect(prompts.every((prompt) => prompt.length < 1_800)).toBe(true);
    expect(reasoningEfforts).toEqual(["low", "low"]);
    expect(terminalCompletionFlags).toEqual([true, true]);
    expect(mcpFlags).toEqual([true, true]);
    expect(new AgentSessionStore(configPath).read("manager", "project-1", "codex")).toBeNull();
  });

  it("can rebuild a missing Provider session when reuse is explicitly enabled", async () => {
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
          workerKind: "codex",
          dispatchBrief: "Recover from Maple history."
        }),
        error: null,
        usage: null,
        sessionId: "replacement-session",
        sessionUnavailable: false
      };
    };
    const managerWorkspace = store.workspace("manager", "project-1");
    mkdirSync(managerWorkspace, { recursive: true });

    await runManagerAgentTurn({
      projectId: "project-1",
      managerWorkerKind: "codex",
      managerWorkspace,
      signal: new AbortController().signal,
      shell: "direct",
      sessionStore: store,
      executor,
      reuseSession: true,
      buildPrompt: () => "route"
    });

    expect(attempts).toEqual(["expired-session", undefined]);
    expect(store.read("manager", "project-1", "codex")?.sessionId).toBe("replacement-session");
  });
});

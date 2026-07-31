import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AppendJobLogRequest,
  AppendJobLogsRequest,
  CompleteJobRequest,
  CompleteProjectManagerJobRequest,
  ExecutionJob,
  ProjectManagerJob
} from "@maple/protocol";
import type { MapleApiClient } from "../src/api/client";
import type { CliConfig } from "../src/config/types";
import type { WorkerExecutor } from "../src/execution/process-executor";
import {
  RunnerLoop,
  type ProjectManagerActivity,
  type ProjectManagerRunEvent,
  type RunnerOutput,
  type RunnerRunEvent
} from "../src/runner/runner-loop";
import { AgentSessionStore } from "../src/session/store";

const temporaryDirectories: string[] = [];
const PNG_BYTES = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
));

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function executionJob(): ExecutionJob {
  const now = "2026-07-27T08:00:00.000Z";
  return {
    todo: {
      id: "todo-1",
      projectId: "project-1",
      title: "Run adapter",
      details: "Verify structured output.",
      status: "queued",
      priority: 0,
      workerKind: "kimi",
      claimedByRunnerId: "runner-1",
      activeAttemptId: "attempt-1",
      leaseExpiresAt: "2026-07-27T08:01:00.000Z",
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
      name: "Adapter Project",
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
      runnerName: "Test runner",
      workspaceLabel: "adapter-project",
      gitBranch: null,
      gitHead: null,
      lastSeenAt: now
    },
    attempt: {
      id: "attempt-1",
      todoId: "todo-1",
      runnerId: "runner-1",
      workerKind: "kimi",
      state: "claimed",
      exitCode: null,
      resultSummary: null,
      error: null,
      usage: null,
      startedAt: null,
      completedAt: null,
      createdAt: now
    },
    leaseToken: "job-lease-token-12345678901234567890",
    leaseSeconds: 45
  };
}

describe("Runner structured run events", () => {
  it("attributes live TUI records and persists the same structured event", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-runner-records-"));
    temporaryDirectories.push(root);
    const job = executionJob();
    const controller = new AbortController();
    const appended: AppendJobLogRequest[] = [];
    let claimed = false;
    const api = {
      serverUrl: "http://maple.test",
      heartbeat: async () => ({ id: "runner-1" }),
      claimRunnerCommand: async () => ({ command: null, leaseToken: null, retryAfterMs: 1_500 }),
      claimProjectManagerJob: async () => ({ job: null, retryAfterMs: 1_500 }),
      claim: async () => {
        if (claimed) return { job: null, retryAfterMs: 1_500 };
        claimed = true;
        return { job, retryAfterMs: 1_500 };
      },
      startJob: async () => ({ todo: job.todo, attempt: job.attempt }),
      heartbeatJob: async () => ({ ok: true as const }),
      appendLogs: async (_todoId: string, input: AppendJobLogsRequest) => {
        appended.push(...input.logs.map((log) => ({ leaseToken: input.leaseToken, ...log })));
        return { ok: true as const, accepted: input.logs.length };
      },
      completeJob: async () => {
        controller.abort();
        return { todo: job.todo, attempt: job.attempt };
      }
    };

    const config: CliConfig = {
      version: 1,
      serverUrl: api.serverUrl,
      runner: { id: "runner-1", token: "runner-token", name: "Test runner" },
      projects: [{
        localId: "local-project-1",
        projectId: "project-1",
        bindingId: "binding-1",
        externalKey: "local:project-1",
        name: "Adapter Project",
        path: join(import.meta.dir, "fixtures", "missing-adapter-project"),
        repositoryUrl: null,
        defaultBranch: null,
        gitBranch: null,
        gitHead: null,
        workerKind: "kimi",
        registeredAt: "2026-07-27T08:00:00.000Z"
      }]
    };
    const records: RunnerRunEvent[] = [];
    const finishes: Array<{ slot: number; success: boolean }> = [];
    const output: RunnerOutput = {
      info: () => undefined,
      warn: () => undefined,
      worker: () => undefined,
      record: (event) => records.push(event),
      jobFinished: (slot, _title, success) => finishes.push({ slot, success })
    };

    const runner = new RunnerLoop(api as unknown as MapleApiClient, config, 1, {
      configPath: join(root, "cli.json"),
      output
    });
    await runner.run(controller.signal);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      slot: 0,
      attemptId: "attempt-1",
      todoId: "todo-1",
      todoTitle: "Run adapter",
      projectId: "project-1",
      projectName: "Adapter Project",
      workerKind: "kimi",
      sequence: 0,
      stream: "system",
      kind: "error",
      level: "error",
      status: "failed",
      title: "项目目录不可用"
    });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      leaseToken: job.leaseToken,
      sequence: records[0]?.sequence,
      occurredAt: records[0]?.occurredAt,
      stream: records[0]?.stream,
      kind: records[0]?.kind,
      level: records[0]?.level,
      status: records[0]?.status,
      title: records[0]?.title,
      content: records[0]?.content
    });
    expect(finishes).toEqual([{ slot: 0, success: false }]);
  });

  it("uses only the Leader PM report and blocks a failed specified Worker", async () => {
    const controller = new AbortController();
    const root = mkdtempSync(join(tmpdir(), "maple-worker-failure-report-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    const job = executionJob();
    job.managerWorkerKind = "codex";
    let claimed = false;
    const completions: CompleteJobRequest[] = [];
    const api = {
      serverUrl: "http://maple.test",
      heartbeat: async () => ({ id: "runner-1" }),
      claimRunnerCommand: async () => ({ command: null, leaseToken: null, retryAfterMs: 1_500 }),
      claimProjectManagerJob: async () => ({ job: null, retryAfterMs: 1_500 }),
      claim: async () => {
        if (claimed) return { job: null, retryAfterMs: 10 };
        claimed = true;
        return { job, retryAfterMs: 0 };
      },
      startJob: async () => ({ todo: job.todo, attempt: job.attempt }),
      heartbeatJob: async () => ({ ok: true as const }),
      appendLogs: async () => ({ ok: true as const, accepted: 1 }),
      completeJob: async (_todoId: string, input: CompleteJobRequest) => {
        completions.push(input);
        controller.abort();
        return { todo: job.todo, attempt: job.attempt };
      }
    };
    const config: CliConfig = {
      version: 1,
      serverUrl: api.serverUrl,
      runner: { id: "runner-1", token: "runner-token", name: "Test runner" },
      projects: [{
        localId: "local-project-1",
        projectId: job.project.id,
        bindingId: job.binding.id,
        externalKey: job.project.externalKey,
        name: job.project.name,
        path: projectPath,
        repositoryUrl: null,
        defaultBranch: null,
        gitBranch: null,
        gitHead: null,
        workerKind: "kimi",
        registeredAt: job.todo.createdAt
      }]
    };
    const runner = new RunnerLoop(api as unknown as MapleApiClient, config, 1, {
      configPath: join(root, ".maple", "cli.json"),
      output: { info: () => undefined, warn: () => undefined, worker: () => undefined },
      workerExecutor: async () => ({
        success: false,
        exitCode: 2,
        summary: "这段 Worker 文本不能成为报告。",
        error: "unknown option --legacy-flag",
        usage: null,
        sessionId: null,
        sessionUnavailable: false
      }),
      projectManagerFailureReporter: async (options) => {
        expect(options.managerWorkerKind).toBe("codex");
        expect(options.failure.requiredWorkerKind).toBe("kimi");
        expect(options.failure.exitCode).toBe(2);
        expect(options.failure.error).toBe("unknown option --legacy-flag");
        return "Kimi 参数无效，任务未完成。";
      }
    });

    await runner.run(controller.signal);

    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      success: false,
      exitCode: 2,
      summary: "Kimi 参数无效，任务未完成。",
      error: "unknown option --legacy-flag",
      failureDisposition: "blocked"
    });
  });

  it("wakes a Worker tab after the project manager dispatches the Todo", async () => {
    const controller = new AbortController();
    const root = mkdtempSync(join(tmpdir(), "maple-manager-tab-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    const execution = executionJob();
    execution.todo.workerKind = "kimi";
    execution.attempt.workerKind = "kimi";
    const managerJob: ProjectManagerJob = {
      todo: { ...execution.todo, status: "todo", claimedByRunnerId: null, activeAttemptId: null },
      project: execution.project,
      binding: execution.binding,
      workflows: [],
      history: [],
      availableWorkers: ["codex", "kimi"],
      attemptId: "manager-attempt-1",
      leaseToken: "manager-lease-token-123456789012345",
      leaseSeconds: 900
    };
    let managerClaimed = false;
    let routed = false;
    let workerClaimed = false;
    const managerCompletions: CompleteProjectManagerJobRequest[] = [];
    const api = {
      serverUrl: "http://maple.test",
      heartbeat: async () => ({ id: "runner-1" }),
      claimRunnerCommand: async () => ({ command: null, leaseToken: null, retryAfterMs: 1_500 }),
      claimProjectManagerJob: async () => {
        if (managerClaimed) return { job: null, retryAfterMs: 1_500 };
        managerClaimed = true;
        return { job: managerJob, retryAfterMs: 0 };
      },
      completeProjectManagerJob: async (_todoId: string, input: CompleteProjectManagerJobRequest) => {
        managerCompletions.push(input);
        routed = true;
        rmSync(projectPath, { recursive: true, force: true });
        return {
          todo: execution.todo,
          workflow: {
            id: "workflow-1",
            projectId: execution.project.id,
            title: "Adapter workflow",
            summary: "Run the selected adapter.",
            createdAt: execution.todo.createdAt,
            updatedAt: execution.todo.updatedAt
          },
          selectedWorkerKind: "kimi" as const,
          executionMode: "serial" as const,
          dispatchBrief: "Use the selected adapter."
        };
      },
      claim: async () => {
        if (!routed || workerClaimed) return { job: null, retryAfterMs: 10 };
        workerClaimed = true;
        return { job: execution, retryAfterMs: 0 };
      },
      startJob: async () => ({ todo: execution.todo, attempt: execution.attempt }),
      heartbeatJob: async () => ({ ok: true as const }),
      appendLogs: async () => ({ ok: true as const, accepted: 1 }),
      completeJob: async () => {
        controller.abort();
        return { todo: execution.todo, attempt: execution.attempt };
      }
    };
    const config: CliConfig = {
      version: 1,
      serverUrl: api.serverUrl,
      runner: { id: "runner-1", token: "runner-token", name: "Test runner" },
      projects: [{
        localId: "local-project-1",
        projectId: execution.project.id,
        bindingId: execution.binding.id,
        externalKey: execution.project.externalKey,
        name: execution.project.name,
        path: projectPath,
        repositoryUrl: null,
        defaultBranch: null,
        gitBranch: null,
        gitHead: null,
        workerKind: "codex",
        registeredAt: execution.todo.createdAt
      }]
    };
    const started: Array<{ slot: number; workerKind: string }> = [];
    const managerStatuses: ProjectManagerActivity[] = [];
    const managerRecords: ProjectManagerRunEvent[] = [];
    const runner = new RunnerLoop(api as unknown as MapleApiClient, config, 1, {
      configPath: join(root, ".maple", "cli.json"),
      output: {
        info: () => undefined,
        warn: () => undefined,
        worker: () => undefined,
        jobStarted: (slot, _title, _projectName, workerKind) => started.push({ slot, workerKind }),
        managerStatus: (activity) => managerStatuses.push(activity),
        managerRecord: (event) => managerRecords.push(event)
      },
      projectManagerRunner: async (
        _job,
        _project,
        _signal,
        _shell,
        _managerWorkspace,
        _sessionStore,
        _executor,
        onDiagnostic
      ) => {
        await onDiagnostic?.({
          sequence: 0,
          occurredAt: "2026-07-27T08:00:01.000Z",
          stream: "stdout",
          kind: "command",
          level: "info",
          status: "completed",
          title: "读取项目",
          content: "rg --files",
          managerWorkerKind: "codex"
        });
        return {
          outcome: "dispatched",
          managerWorkerKind: "codex",
          decision: {
            selectedWorkerKind: "kimi",
            workflowId: null,
            workflowTitle: "Adapter workflow",
            workflowSummary: "Run the selected adapter.",
            executionMode: "serial",
            dispatchBrief: "Use the selected adapter."
          }
        };
      }
    });

    await runner.run(controller.signal);

    expect(managerCompletions).toHaveLength(1);
    expect(managerCompletions[0]?.selectedWorkerKind).toBe("kimi");
    expect(managerStatuses).toEqual([
      {
        projectId: "project-1",
        projectName: "Adapter Project",
        state: "diagnosing",
        managerWorkerKind: "codex"
      },
      {
        projectId: "project-1",
        projectName: "Adapter Project",
        state: "dispatched",
        managerWorkerKind: "codex",
        selectedWorkerKind: "kimi"
      }
    ]);
    expect(managerRecords).toEqual([{
      sequence: 0,
      occurredAt: "2026-07-27T08:00:01.000Z",
      stream: "stdout",
      kind: "command",
      level: "info",
      status: "completed",
      title: "读取项目",
      content: "rg --files",
      managerWorkerKind: "codex",
      todoId: "todo-1",
      todoTitle: "Run adapter",
      projectId: "project-1",
      projectName: "Adapter Project"
    }]);
    expect(started).toEqual([{ slot: 0, workerKind: "kimi" }]);
  });

  it("uploads enabled acceptance screenshots before completing the Todo", async () => {
    const controller = new AbortController();
    const root = mkdtempSync(join(tmpdir(), "maple-runner-screenshot-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    const mapleHome = join(root, ".maple");
    mkdirSync(projectPath, { recursive: true });
    const job = executionJob();
    job.acceptanceSettings = { backgroundPlaywrightScreenshot: true };
    job.attempt.acceptanceSettings = { backgroundPlaywrightScreenshot: true };
    let claimed = false;
    let screenshotPath = "";
    const uploadedNames: string[] = [];
    const api = {
      serverUrl: "http://maple.test",
      heartbeat: async () => ({ id: "runner-1" }),
      claimRunnerCommand: async () => ({ command: null, leaseToken: null, retryAfterMs: 1_500 }),
      claimProjectManagerJob: async () => ({ job: null, retryAfterMs: 1_500 }),
      claim: async () => {
        if (claimed) return { job: null, retryAfterMs: 10 };
        claimed = true;
        return { job, retryAfterMs: 0 };
      },
      startJob: async () => ({ todo: job.todo, attempt: job.attempt }),
      heartbeatJob: async () => ({ ok: true as const }),
      appendLogs: async () => ({ ok: true as const, accepted: 1 }),
      uploadScreenshot: async (_todoId: string, _leaseToken: string, _deliveryId: string, input: {
        fileName: string;
        mimeType: "image/png";
        bytes: Uint8Array;
      }) => {
        uploadedNames.push(input.fileName);
        expect(input.mimeType).toBe("image/png");
        expect(input.bytes).toEqual(PNG_BYTES);
        return {
          artifact: {
            id: "artifact-1",
            todoId: job.todo.id,
            attemptId: job.attempt.id,
            kind: "screenshot" as const,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            createdAt: job.todo.createdAt
          }
        };
      },
      completeJob: async () => {
        controller.abort();
        return { todo: job.todo, attempt: job.attempt };
      }
    };
    const config: CliConfig = {
      version: 1,
      serverUrl: api.serverUrl,
      runner: { id: "runner-1", token: "runner-token", name: "Test runner" },
      projects: [{
        localId: "local-project-1",
        projectId: job.project.id,
        bindingId: job.binding.id,
        externalKey: job.project.externalKey,
        name: job.project.name,
        path: projectPath,
        repositoryUrl: null,
        defaultBranch: null,
        gitBranch: null,
        gitHead: null,
        workerKind: "kimi",
        registeredAt: job.todo.createdAt
      }]
    };
    const executor: WorkerExecutor = async (options) => {
      const match = options.prompt.match(/存到 ([^；\r\n]+)/);
      expect(match?.[1]).toBeString();
      screenshotPath = join(match![1]!.trim(), "acceptance.png");
      expect(options.additionalWritableDirectories).toEqual([match![1]!.trim()]);
      writeFileSync(screenshotPath, PNG_BYTES);
      return {
        success: true,
        exitCode: 0,
        summary: "截图验收完成。",
        error: null,
        usage: null,
        sessionId: null,
        sessionUnavailable: false
      };
    };
    const runner = new RunnerLoop(api as unknown as MapleApiClient, config, 1, {
      configPath: join(mapleHome, "cli.json"),
      workerExecutor: executor,
      playwrightExecutable: "playwright",
      output: { info: () => undefined, warn: () => undefined, worker: () => undefined }
    });

    await runner.run(controller.signal);

    expect(uploadedNames).toEqual(["acceptance.png"]);
    expect(existsSync(screenshotPath)).toBe(false);
    expect(screenshotPath).toStartWith(join(mapleHome, "artifacts"));
    expect(existsSync(join(projectPath, ".maple"))).toBe(false);
  });

  it("keeps successful Worker results when optional screenshots are absent or unavailable", async () => {
    const scenarios = [
      {
        playwrightExecutable: "playwright",
        expectedLog: "未发现适用的 Playwright 验收截图，本次任务继续按 Worker 结果完成。",
        promptIncludesScreenshotInstructions: true
      },
      {
        playwrightExecutable: null,
        expectedLog: "可选截图验收暂不可用，本次任务继续按 Worker 结果执行",
        promptIncludesScreenshotInstructions: false
      }
    ] as const;

    for (const scenario of scenarios) {
      const controller = new AbortController();
      const root = mkdtempSync(join(tmpdir(), "maple-runner-optional-screenshot-"));
      temporaryDirectories.push(root);
      const projectPath = join(root, "project");
      mkdirSync(projectPath, { recursive: true });
      const job = executionJob();
      job.acceptanceSettings = { backgroundPlaywrightScreenshot: true };
      job.attempt.acceptanceSettings = { backgroundPlaywrightScreenshot: true };
      job.managerWorkerKind = "codex";
      let claimed = false;
      let workerRuns = 0;
      let failureReports = 0;
      const completions: CompleteJobRequest[] = [];
      const records: RunnerRunEvent[] = [];
      const api = {
        serverUrl: "http://maple.test",
        heartbeat: async () => ({ id: "runner-1" }),
        claimRunnerCommand: async () => ({ command: null, leaseToken: null, retryAfterMs: 1_500 }),
        claimProjectManagerJob: async () => ({ job: null, retryAfterMs: 1_500 }),
        claim: async () => {
          if (claimed) return { job: null, retryAfterMs: 10 };
          claimed = true;
          return { job, retryAfterMs: 0 };
        },
        startJob: async () => ({ todo: job.todo, attempt: job.attempt }),
        heartbeatJob: async () => ({ ok: true as const }),
        appendLogs: async () => ({ ok: true as const, accepted: 1 }),
        completeJob: async (_todoId: string, input: CompleteJobRequest) => {
          completions.push(input);
          controller.abort();
          return { todo: job.todo, attempt: job.attempt };
        }
      };
      const config: CliConfig = {
        version: 1,
        serverUrl: api.serverUrl,
        runner: { id: "runner-1", token: "runner-token", name: "Test runner" },
        projects: [{
          localId: "local-project-1",
          projectId: job.project.id,
          bindingId: job.binding.id,
          externalKey: job.project.externalKey,
          name: job.project.name,
          path: projectPath,
          repositoryUrl: null,
          defaultBranch: null,
          gitBranch: null,
          gitHead: null,
          workerKind: "kimi",
          registeredAt: job.todo.createdAt
        }]
      };
      const runner = new RunnerLoop(api as unknown as MapleApiClient, config, 1, {
        configPath: join(root, ".maple", "cli.json"),
        playwrightExecutable: scenario.playwrightExecutable,
        output: {
          info: () => undefined,
          warn: () => undefined,
          worker: () => undefined,
          record: (event) => records.push(event)
        },
        workerExecutor: async (options) => {
          workerRuns += 1;
          expect(options.prompt.includes("可选截图："))
            .toBe(scenario.promptIncludesScreenshotInstructions);
          return {
            success: true,
            exitCode: 0,
            summary: "Worker 已完成。",
            error: null,
            usage: null,
            sessionId: null,
            sessionUnavailable: false
          };
        },
        projectManagerFailureReporter: async () => {
          failureReports += 1;
          return "不应生成失败报告。";
        }
      });

      await runner.run(controller.signal);

      expect(workerRuns).toBe(1);
      expect(failureReports).toBe(0);
      expect(completions).toHaveLength(1);
      expect(completions[0]).toMatchObject({
        success: true,
        exitCode: 0,
        summary: "Worker 已完成。"
      });
      expect(records.some((record) => record.content.includes(scenario.expectedLog))).toBe(true);
    }
  });

  it("keeps the Worker running while disconnected and flushes its result after recovery", async () => {
    const controller = new AbortController();
    const root = mkdtempSync(join(tmpdir(), "maple-runner-disconnect-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    const job = executionJob();
    let claimed = false;
    let disconnected = false;
    let workerFinished = false;
    const deliveries: string[] = [];
    const api = {
      serverUrl: "http://maple.test",
      heartbeat: async () => ({ id: "runner-1" }),
      reconcile: async () => ({ attempts: [] }),
      claimRunnerCommand: async () => {
        if (disconnected) {
          disconnected = false;
          throw new Error("fetch failed");
        }
        return { command: null, leaseToken: null, retryAfterMs: 1_500 };
      },
      claimProjectManagerJob: async () => ({ job: null, retryAfterMs: 1_500 }),
      claim: async () => {
        if (claimed) return { job: null, retryAfterMs: 10 };
        claimed = true;
        disconnected = true;
        return { job, retryAfterMs: 0 };
      },
      startJob: async () => {
        if (disconnected) throw new Error("server offline");
        deliveries.push("start");
        return { todo: job.todo, attempt: job.attempt };
      },
      heartbeatJob: async () => ({ ok: true as const }),
      appendLogs: async () => {
        if (disconnected) throw new Error("server offline");
        deliveries.push("log");
        return { ok: true as const, accepted: 1 };
      },
      completeJob: async () => {
        if (disconnected) throw new Error("server offline");
        deliveries.push("complete");
        controller.abort();
        return { todo: job.todo, attempt: job.attempt };
      }
    };
    const config: CliConfig = {
      version: 1,
      serverUrl: api.serverUrl,
      runner: { id: "runner-1", token: "runner-token", name: "Test runner" },
      projects: [{
        localId: "local-project-1",
        projectId: job.project.id,
        bindingId: job.binding.id,
        externalKey: job.project.externalKey,
        name: job.project.name,
        path: projectPath,
        repositoryUrl: null,
        defaultBranch: null,
        gitBranch: null,
        gitHead: null,
        workerKind: "kimi",
        registeredAt: job.todo.createdAt
      }]
    };
    const warnings: string[] = [];
    const runner = new RunnerLoop(api as unknown as MapleApiClient, config, 1, {
      configPath: join(root, ".maple", "cli.json"),
      output: {
        info: () => undefined,
        warn: (message) => warnings.push(message),
        worker: () => undefined
      },
      workerExecutor: async (options) => {
        await options.onLog?.({
          sequence: 0,
          occurredAt: "2026-07-28T00:00:01.000Z",
          stream: "stdout",
          kind: "assistant",
          level: "info",
          content: "finished offline"
        });
        workerFinished = true;
        return {
          success: true,
          exitCode: 0,
          summary: "done",
          error: null,
          usage: null,
          sessionId: null,
          sessionUnavailable: false
        };
      }
    });

    await runner.run(controller.signal);

    expect(workerFinished).toBe(true);
    expect(deliveries).toEqual(["start", "log", "complete"]);
    expect(warnings.join("\n")).toContain("回传队列等待重试");
  });

  it("resumes a serial Workflow Worker session after restart but isolates parallel work", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-workflow-session-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    const configPath = join(root, "cli.json");
    const base = executionJob();
    base.todo.workerKind = "codex";
    base.attempt.workerKind = "codex";
    base.workflow = {
      id: "workflow-1",
      projectId: base.project.id,
      title: "Persistent workflow",
      summary: "Keep implementation context across Todos.",
      createdAt: base.todo.createdAt,
      updatedAt: base.todo.updatedAt
    };
    base.workflowExecutionMode = "serial";
    const second = structuredClone(base);
    second.todo.id = "todo-2";
    second.todo.title = "Continue adapter work";
    second.attempt.id = "attempt-2";
    second.attempt.todoId = second.todo.id;
    second.leaseToken = "job-lease-token-22345678901234567890";
    const parallel = structuredClone(second);
    parallel.todo.id = "todo-3";
    parallel.todo.title = "Independent adapter work";
    parallel.attempt.id = "attempt-3";
    parallel.attempt.todoId = parallel.todo.id;
    parallel.leaseToken = "job-lease-token-32345678901234567890";
    parallel.workflowExecutionMode = "parallel";

    const config: CliConfig = {
      version: 1,
      serverUrl: "http://maple.test",
      runner: { id: "runner-1", token: "runner-token", name: "Test runner" },
      projects: [{
        localId: "local-project-1",
        projectId: base.project.id,
        bindingId: base.binding.id,
        externalKey: base.project.externalKey,
        name: base.project.name,
        path: projectPath,
        repositoryUrl: null,
        defaultBranch: null,
        gitBranch: null,
        gitHead: null,
        workerKind: "codex",
        registeredAt: base.todo.createdAt
      }]
    };
    const resumeIds: Array<string | undefined> = [];
    const prompts: string[] = [];
    const summaryModes: Array<string | undefined> = [];
    let freshSessionId = "workflow-session-1";
    const executor: WorkerExecutor = async (options) => {
      resumeIds.push(options.resumeSessionId);
      prompts.push(options.prompt);
      summaryModes.push(options.summaryMode);
      if (options.resumeSessionId === "expired-session") {
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
      options.onSession?.(freshSessionId);
      return {
        success: true,
        exitCode: 0,
        summary: "done",
        error: null,
        usage: null,
        sessionId: options.resumeSessionId ?? freshSessionId,
        sessionUnavailable: false
      };
    };

    const runOnce = async (job: ExecutionJob) => {
      const controller = new AbortController();
      let claimed = false;
      const api = {
        serverUrl: config.serverUrl,
        heartbeat: async () => ({ id: "runner-1" }),
        claimRunnerCommand: async () => ({ command: null, leaseToken: null, retryAfterMs: 1_500 }),
        claimProjectManagerJob: async () => ({ job: null, retryAfterMs: 1_500 }),
        claim: async () => {
          if (claimed) return { job: null, retryAfterMs: 10 };
          claimed = true;
          return { job, retryAfterMs: 0 };
        },
        startJob: async () => ({ todo: job.todo, attempt: job.attempt }),
        heartbeatJob: async () => ({ ok: true as const }),
        appendLogs: async () => ({ ok: true as const, accepted: 1 }),
        completeJob: async () => {
          controller.abort();
          return { todo: job.todo, attempt: job.attempt };
        }
      };
      const runner = new RunnerLoop(api as unknown as MapleApiClient, config, 1, {
        configPath,
        workerExecutor: executor,
        output: { info: () => undefined, warn: () => undefined, worker: () => undefined }
      });
      await runner.run(controller.signal);
    };

    await runOnce(base);
    await runOnce(second);
    await runOnce(parallel);

    const recovery = structuredClone(second);
    recovery.todo.id = "todo-4";
    recovery.attempt.id = "attempt-4";
    recovery.attempt.todoId = recovery.todo.id;
    recovery.leaseToken = "job-lease-token-42345678901234567890";
    new AgentSessionStore(configPath).save({
      scope: "workflow",
      scopeId: "workflow-1",
      workerKind: "codex",
      sessionId: "expired-session"
    });
    freshSessionId = "replacement-session";
    await runOnce(recovery);

    expect(resumeIds).toEqual([
      undefined,
      "workflow-session-1",
      undefined,
      "expired-session",
      undefined
    ]);
    expect(prompts[1]).toContain("续接当前 Maple Workflow Worker 会话");
    expect(prompts[2]).not.toContain("正在续接这个 Maple Workflow 的 Worker 会话");
    expect(summaryModes).toEqual(["report", "report", "report", "report", "report"]);
    expect(prompts.every((prompt) => !prompt.includes("最终报告不得超过"))).toBe(true);
    expect(new AgentSessionStore(configPath).read("workflow", "workflow-1", "codex")?.sessionId)
      .toBe("replacement-session");
  });
});

describe("Runner force termination", () => {
  it("keeps waiting after graceful stop and releases the Worker when force termination is requested", async () => {
    const root = mkdtempSync(join(tmpdir(), "maple-runner-force-stop-"));
    temporaryDirectories.push(root);
    const projectPath = join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    const job = executionJob();
    let claimed = false;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let normalStopObserved = false;
    let forceStopObserved = false;

    const api = {
      serverUrl: "http://maple.test",
      heartbeat: async () => ({ id: "runner-1" }),
      claimRunnerCommand: async () => ({ command: null, leaseToken: null, retryAfterMs: 1_500 }),
      claimProjectManagerJob: async () => ({ job: null, retryAfterMs: 1_500 }),
      claim: async () => {
        if (claimed) return { job: null, retryAfterMs: 1_500 };
        claimed = true;
        return { job, retryAfterMs: 0 };
      },
      startJob: async () => ({ todo: job.todo, attempt: job.attempt }),
      heartbeatJob: async () => ({ ok: true as const }),
      appendLogs: async () => ({ ok: true as const, accepted: 1 }),
      completeJob: async () => ({ todo: job.todo, attempt: job.attempt })
    };
    const config: CliConfig = {
      version: 1,
      serverUrl: api.serverUrl,
      runner: { id: "runner-1", token: "runner-token", name: "Test runner" },
      projects: [{
        localId: "local-project-1",
        projectId: job.project.id,
        bindingId: job.binding.id,
        externalKey: job.project.externalKey,
        name: job.project.name,
        path: projectPath,
        repositoryUrl: null,
        defaultBranch: null,
        gitBranch: null,
        gitHead: null,
        workerKind: "kimi",
        registeredAt: job.todo.createdAt
      }]
    };
    const runner = new RunnerLoop(api as unknown as MapleApiClient, config, 1, {
      configPath: join(root, ".maple", "cli.json"),
      output: { info: () => undefined, warn: () => undefined, worker: () => undefined },
      workerExecutor: async (options) => {
        expect(options.forceSignal).toBeDefined();
        resolveStarted();
        return await new Promise((resolve) => {
          options.signal.addEventListener("abort", () => {
            normalStopObserved = true;
          }, { once: true });
          const finish = () => {
            forceStopObserved = true;
            resolve({
              success: false,
              exitCode: null,
              summary: "",
              error: "force terminated",
              usage: null,
              sessionId: null,
              sessionUnavailable: false
            });
          };
          options.forceSignal!.addEventListener("abort", finish, { once: true });
          if (options.forceSignal!.aborted) finish();
        });
      }
    });

    const controller = new AbortController();
    const runPromise = runner.run(controller.signal);
    await started;
    controller.abort();
    await Bun.sleep(20);
    let settled = false;
    void runPromise.then(() => {
      settled = true;
    });
    await Bun.sleep(20);

    expect(normalStopObserved).toBe(true);
    expect(forceStopObserved).toBe(false);
    expect(settled).toBe(false);

    runner.forceTerminate();
    await Promise.race([
      runPromise,
      Bun.sleep(2_000).then(() => {
        throw new Error("Runner did not finish after force termination");
      })
    ]);

    expect(forceStopObserved).toBe(true);
    expect(settled).toBe(true);
  });
});

import { createHash } from "node:crypto";
import type { ProjectManagerJob, RunLogEntry, TokenUsage, WorkerKind } from "@maple/protocol";
import type { LocalProject } from "../config/types";
import { executeWorker, type WorkerExecutor } from "../execution/process-executor";
import type { WorkerShell } from "../execution/shells";
import { AgentSessionStore } from "../session/store";
import { runManagerAgentTurn } from "./agent-turn";
import {
  parseProjectManagerDecision,
  selectProjectManagerWorkerForJob,
  type ProjectManagerDecision
} from "./decision";
import { runProjectManagerFailureReport } from "./failure-report";
import { buildProjectManagerPrompt } from "./prompt";
import { inspectProjectForManager } from "./project-snapshot";

export interface ProjectManagerDispatched {
  outcome: "dispatched";
  managerWorkerKind: WorkerKind;
  usage?: TokenUsage;
  decision: ProjectManagerDecision;
}

export interface ProjectManagerBlocked {
  outcome: "blocked";
  managerWorkerKind: WorkerKind;
  usage?: TokenUsage;
  report: string;
}

export type ProjectManagerDispatch = ProjectManagerDispatched | ProjectManagerBlocked;

/** 项目经理 Coding Agent 的实时结构化事件，供 CLI 独立展示诊断过程。 */
export interface ProjectManagerDiagnosticEvent extends RunLogEntry {
  managerWorkerKind: WorkerKind;
}

export type ProjectManagerDiagnosticHandler = (
  event: ProjectManagerDiagnosticEvent
) => void | Promise<void>;

export async function runProjectManager(
  job: ProjectManagerJob,
  project: LocalProject,
  signal: AbortSignal,
  shell: WorkerShell,
  managerWorkspace = project.path,
  sessionStore?: AgentSessionStore,
  executor: WorkerExecutor = executeWorker,
  onDiagnostic?: ProjectManagerDiagnosticHandler,
  forceSignal?: AbortSignal
): Promise<ProjectManagerDispatch> {
  const managerWorkerKind = selectProjectManagerWorkerForJob(job);
  const snapshot = inspectProjectForManager(project.path);
  const contextFingerprint = createHash("sha256").update(snapshot.stableContext).digest("hex");
  if (!job.availableWorkers.includes(job.todo.workerKind)) {
    let usage: TokenUsage | null = null;
    const report = await runProjectManagerFailureReport({
      projectId: job.project.id,
      managerWorkerKind,
      managerWorkspace,
      signal,
      forceSignal,
      shell,
      outputLanguage: job.executionSettings?.aiOutputLanguage,
      sessionStore,
      executor,
      onDiagnostic,
      onUsage: (reportedUsage) => {
        usage = reportedUsage;
      },
      failure: {
        stage: "dispatch",
        projectName: job.project.name,
        todo: job.todo,
        requiredWorkerKind: job.todo.workerKind,
        availableWorkers: job.availableWorkers
      }
    });
    return {
      outcome: "blocked",
      managerWorkerKind,
      ...(usage ? { usage } : {}),
      report
    };
  }

  const result = await runManagerAgentTurn({
    projectId: job.project.id,
    managerWorkerKind,
    managerWorkspace,
    signal,
    forceSignal,
    shell,
    sessionStore,
    executor,
    contextFingerprint,
    onDiagnostic,
    buildPrompt: ({ resuming, existingContextFingerprint }) => buildProjectManagerPrompt(job, snapshot, {
      resuming,
      includeStableContext: !resuming || existingContextFingerprint !== contextFingerprint
    })
  });
  return {
    outcome: "dispatched",
    managerWorkerKind,
    ...(result.usage ? { usage: result.usage } : {}),
    decision: parseProjectManagerDecision(result.summary, job)
  };
}

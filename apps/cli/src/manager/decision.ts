import {
  WORKER_KINDS,
  type CompleteProjectManagerJobRequest,
  type ProjectManagerJob,
  type WorkerKind
} from "@maple/protocol";

export type ProjectManagerDecision = Omit<
  CompleteProjectManagerJobRequest,
  "leaseToken" | "managerWorkerKind"
>;

const MANAGER_PREFERENCE: WorkerKind[] = ["codex", "claude", "gemini", "kimi", "glm", "opencode", "iflow"];

export function selectProjectManagerWorker(
  availableWorkers: WorkerKind[],
  env: Record<string, string | undefined> = process.env,
  preferredWorker?: WorkerKind
): WorkerKind {
  if (preferredWorker && availableWorkers.includes(preferredWorker)) return preferredWorker;
  const requested = env.MAPLE_MANAGER_WORKER?.trim();
  if (requested && WORKER_KINDS.includes(requested as WorkerKind) && availableWorkers.includes(requested as WorkerKind)) {
    return requested as WorkerKind;
  }
  const preferred = MANAGER_PREFERENCE.find((kind) => availableWorkers.includes(kind));
  if (preferred) return preferred;
  if (availableWorkers[0]) return availableWorkers[0];
  throw new Error("当前 CLI 没有可用于项目经理的 Coding Agent。");
}

function parseJsonObject(output: string): Record<string, unknown> | null {
  const fenced = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].at(-1)?.[1]?.trim();
  const candidates = [fenced, output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)].filter(
    (value): value is string => Boolean(value)
  );
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // 尝试下一个候选片段。
    }
  }
  return null;
}

function boundedString(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

export function parseProjectManagerDecision(output: string, job: ProjectManagerJob): ProjectManagerDecision {
  const parsed = parseJsonObject(output);
  const selectedWorkerKind = job.todo.workerKind;
  const requestedWorkflowId = parsed?.workflowId;
  const workflowId = typeof requestedWorkflowId === "string"
    && requestedWorkflowId !== "NEW"
    && job.workflows.some((workflow) => workflow.id === requestedWorkflowId)
      ? requestedWorkflowId
      : null;
  const existingWorkflow = workflowId
    ? job.workflows.find((workflow) => workflow.id === workflowId)
    : undefined;
  const workflowTitle = boundedString(
    parsed?.workflowTitle,
    existingWorkflow?.title ?? job.todo.title,
    160
  );
  const workflowSummary = boundedString(
    parsed?.workflowSummary,
    existingWorkflow?.summary ?? `${job.todo.title}：${job.todo.details || "完成当前目标"}`,
    4_000
  );
  const dispatchBrief = boundedString(
    parsed?.dispatchBrief,
    workflowId ? `延续“${workflowTitle}”工作流并完成当前 Todo。` : "完成当前 Todo，并遵守项目现有约束。",
    2_000
  );
  return {
    selectedWorkerKind,
    workflowId,
    workflowTitle,
    workflowSummary,
    executionMode: parsed?.executionMode === "parallel" ? "parallel" : "serial",
    dispatchBrief
  };
}

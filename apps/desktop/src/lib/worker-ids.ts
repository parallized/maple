import type { WorkerKind } from "../domain";

export type WorkerIdInfo = {
  kind: WorkerKind | null;
  projectId: string | null;
};

const WORKER_KINDS: WorkerKind[] = ["claude", "codex", "iflow"];

export function buildWorkerId(kind: WorkerKind, projectId?: string | null): string {
  const normalizedProjectId = (projectId ?? "").trim();
  return normalizedProjectId ? `worker-${kind}:${normalizedProjectId}` : `worker-${kind}`;
}

export function parseWorkerId(workerId: string): WorkerIdInfo {
  const raw = workerId.trim();
  if (!raw.startsWith("worker-")) return { kind: null, projectId: null };
  const rest = raw.slice("worker-".length);
  if (!rest) return { kind: null, projectId: null };
  const [kindPart, projectPart] = rest.split(":", 2);
  const kind = WORKER_KINDS.includes(kindPart as WorkerKind) ? (kindPart as WorkerKind) : null;
  const projectId = (projectPart ?? "").trim() || null;
  return { kind, projectId };
}

export function isWorkerKindId(workerId: string, kind: WorkerKind): boolean {
  const parsed = parseWorkerId(workerId);
  return parsed.kind === kind;
}


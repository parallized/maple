import type { WorkerKind } from "@maple/protocol";
import { keepSgrOnly } from "../terminal/style";

export type LogPaneKey = number | "manager";

export interface LogPane {
  running: boolean;
  logs: string[];
  pending: string;
}

export interface WorkerLogPane extends LogPane {
  projectName: string | null;
  workerKind: WorkerKind | null;
}

export interface ProjectManagerLogPane extends LogPane {
  projectId: string | null;
  projectName: string | null;
  todoTitle: string | null;
  managerWorkerKind: WorkerKind | null;
}

export function createWorkerLogPanes(count: number): WorkerLogPane[] {
  return Array.from({ length: Math.max(1, count) }, () => ({
    projectName: null,
    workerKind: null,
    running: false,
    logs: [],
    pending: ""
  }));
}

export function createProjectManagerLogPane(): ProjectManagerLogPane {
  return {
    projectId: null,
    projectName: null,
    todoTitle: null,
    managerWorkerKind: null,
    running: false,
    logs: [],
    pending: ""
  };
}

export function appendLogText(pane: LogPane, text: string, maxLines: number): void {
  pane.pending += keepSgrOnly(text);
  const parts = pane.pending.split("\n");
  pane.pending = parts.pop() ?? "";
  for (const part of parts) pane.logs.push(part.replace(/\s+$/g, ""));
  if (pane.logs.length > maxLines) pane.logs.splice(0, pane.logs.length - maxLines);
}

export function visibleLogPaneKeys(
  manager: ProjectManagerLogPane,
  workers: readonly WorkerLogPane[]
): LogPaneKey[] {
  return [
    ...(manager.running || manager.logs.length > 0 ? ["manager" as const] : []),
    ...workers
      .map((pane, index) => ({ pane, index }))
      .filter(({ pane }) => pane.running || pane.logs.length > 0)
      .map(({ index }) => index)
  ];
}

export function adjacentLogPane(
  current: LogPaneKey,
  offset: -1 | 1,
  visible: readonly LogPaneKey[]
): LogPaneKey {
  if (visible.length === 0) return current;
  const currentIndex = visible.findIndex((key) => key === current);
  const start = currentIndex >= 0 ? currentIndex : 0;
  return visible[(start + offset + visible.length) % visible.length]!;
}

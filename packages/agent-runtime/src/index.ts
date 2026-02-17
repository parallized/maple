import type { TaskCard } from "@maple/kanban-core";

export type AgentKind = "claude" | "codex" | "iflow";

export interface AgentExecutionRequest {
  task: TaskCard;
  cwd: string;
  command: string;
}

export interface AgentExecutionResult {
  summary: string;
  artifactPaths: string[];
}

export interface AgentAdapter {
  kind: AgentKind;
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}

class DryRunAdapter implements AgentAdapter {
  constructor(public readonly kind: AgentKind) {}

  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    return {
      summary: `[dry-run] ${this.kind} -> ${request.task.title}`,
      artifactPaths: []
    };
  }
}

export function createDryRunAdapter(kind: AgentKind): AgentAdapter {
  return new DryRunAdapter(kind);
}

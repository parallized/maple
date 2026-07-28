import type { WorkerKind } from "@maple/protocol";

export interface LocalProject {
  localId: string;
  projectId: string | null;
  bindingId: string | null;
  externalKey: string;
  name: string;
  path: string;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  gitBranch: string | null;
  gitHead: string | null;
  workerKind: WorkerKind;
  registeredAt: string | null;
}

export interface RunnerCredential {
  id: string;
  token: string;
  name: string;
  workspaceId?: string;
  workspaceName?: string;
}

export interface CliConfig {
  version: 1;
  serverUrl: string;
  runner: RunnerCredential | null;
  projects: LocalProject[];
}

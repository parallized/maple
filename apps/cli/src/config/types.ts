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
  /** 用户按 CTRL + P 忽略的 CLI 更新版本；再次出现更高版本时会重新提示。 */
  updateIgnoredVersion?: string;
}

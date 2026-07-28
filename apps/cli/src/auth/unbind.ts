import { MapleApiClient, MapleApiError } from "../api/client";
import { loadConfig, saveConfig } from "../config/store";
import type { CliConfig } from "../config/types";

export interface RunnerUnbindApi {
  disconnectRunner(): Promise<{ revoked: true }>;
}

export interface RunnerUnbindResult {
  changed: boolean;
  runnerName: string | null;
  workspaceName: string | null;
  config: CliConfig;
}

export function clearRunnerBinding(config: CliConfig): CliConfig {
  return {
    ...config,
    runner: null,
    projects: config.projects.map((project) => ({
      ...project,
      projectId: null,
      bindingId: null,
      registeredAt: null
    }))
  };
}

export async function unbindRunner(
  configPath: string,
  createApi: (serverUrl: string, token: string) => RunnerUnbindApi =
    (serverUrl, token) => new MapleApiClient(serverUrl, token)
): Promise<RunnerUnbindResult> {
  const config = loadConfig(configPath);
  if (!config.runner) {
    return { changed: false, runnerName: null, workspaceName: null, config };
  }
  if (!config.serverUrl) throw new Error("当前 CLI 缺少 Server 地址，无法安全解除绑定。");

  try {
    await createApi(config.serverUrl, config.runner.token).disconnectRunner();
  } catch (error) {
    // 401 表示远端凭据已经失效，本地可以直接完成清理。
    if (!(error instanceof MapleApiError && error.status === 401)) throw error;
  }

  const next = clearRunnerBinding(config);
  saveConfig(next, configPath);
  return {
    changed: true,
    runnerName: config.runner.name,
    workspaceName: config.runner.workspaceName ?? null,
    config: next
  };
}

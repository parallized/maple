import { hostname } from "node:os";
import type { StandaloneServerHandle } from "@maple/server/standalone";
import { CLI_CAPABILITIES } from "../capabilities";
import { CLI_VERSION } from "../commands";
import { loadConfig, saveConfig } from "../config/store";
import type { CliConfig } from "../config/types";
import { detectCodingAgentTools, toWorkerInventory } from "../execution/tool-availability";
import { defaultRunnerName } from "../runner/runner-name";
import { hostPlatform } from "../host-platform";

/** Provisions the in-process Runner without OAuth or a pairing endpoint. */
export function provisionStandaloneCli(
  server: StandaloneServerHandle,
  configPath: string
): CliConfig {
  const current = loadConfig(configPath);
  const localHostname = hostname();
  const tools = detectCodingAgentTools();
  const credential = server.provisionRunner({
    runnerName: defaultRunnerName(localHostname),
    hostname: localHostname,
      platform: hostPlatform(),
    version: CLI_VERSION,
    supportedWorkers: tools.filter((tool) => tool.available).map((tool) => tool.kind),
    workerInventory: toWorkerInventory(tools),
    capabilities: [...CLI_CAPABILITIES]
  });
  const sameWorkspace = current.runner?.workspaceId === server.identity.workspaceId;
  const config: CliConfig = {
    version: 1,
    serverUrl: server.url,
    runner: {
      id: credential.runner.id,
      token: credential.runnerToken,
      name: credential.runner.name,
      workspaceId: server.identity.workspaceId,
      workspaceName: server.identity.workspaceName
    },
    projects: sameWorkspace
      ? current.projects
      : current.projects.map((project) => ({
          ...project,
          projectId: null,
          bindingId: null,
          registeredAt: null
        }))
  };
  saveConfig(config, configPath);
  return config;
}

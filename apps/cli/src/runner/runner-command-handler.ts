import type {
  ClaimRunnerCommandResponse,
  CompleteRunnerCommandRequest,
  RunnerCommand
} from "@maple/protocol";
import { loadConfig } from "../config/store";
import type { CliConfig } from "../config/types";
import { selectProjectDirectory, type DirectoryPicker } from "../project/directory-picker";
import {
  registerProject,
  type ProjectRegistrationApi
} from "../project/register";

export interface RunnerCommandApi extends ProjectRegistrationApi {
  completeRunnerCommand(commandId: string, input: CompleteRunnerCommandRequest): Promise<RunnerCommand>;
}

export interface RunnerCommandOutput {
  info(message: string): void;
  warn(message: string): void;
}

export interface HandleRunnerCommandOptions {
  api: RunnerCommandApi;
  claim: ClaimRunnerCommandResponse;
  configPath: string;
  signal: AbortSignal;
  output: RunnerCommandOutput;
  directoryPicker?: DirectoryPicker;
}

async function complete(
  api: RunnerCommandApi,
  commandId: string,
  leaseToken: string,
  input: Omit<CompleteRunnerCommandRequest, "leaseToken">
): Promise<void> {
  await api.completeRunnerCommand(commandId, { leaseToken, ...input });
}

export async function handleRunnerCommand(options: HandleRunnerCommandOptions): Promise<CliConfig> {
  const { command, leaseToken } = options.claim;
  if (!command || !leaseToken) return loadConfig(options.configPath);
  if (options.signal.aborted) return loadConfig(options.configPath);

  if (command.type !== "select_project_directory") {
    await complete(options.api, command.id, leaseToken, {
      outcome: "failed",
      error: "当前 CLI 不支持这项执行端命令。"
    });
    return loadConfig(options.configPath);
  }

  options.output.info("[maple] 看板请求添加项目，请在当前 Runner 完成目录选择。");
  let selectedPath: string | null;
  try {
    selectedPath = await (options.directoryPicker ?? selectProjectDirectory)(options.signal);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    options.output.warn(`[maple] 无法完成项目目录选择：${detail}`);
    if (!options.signal.aborted) {
      await complete(options.api, command.id, leaseToken, {
        outcome: "failed",
        error: "执行端无法完成项目目录选择。"
      });
    }
    return loadConfig(options.configPath);
  }

  if (options.signal.aborted) return loadConfig(options.configPath);
  if (!selectedPath) {
    await complete(options.api, command.id, leaseToken, { outcome: "cancelled" });
    options.output.info("[maple] 已取消添加项目。");
    return loadConfig(options.configPath);
  }

  let result;
  try {
    result = await registerProject(options.api, loadConfig(options.configPath), {
      path: selectedPath,
      // Kept only until the CLI project screen removes its legacy display field.
      // The value is not sent to Server and never controls task dispatch.
      workerKind: "codex",
      configPath: options.configPath
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    options.output.warn(`[maple] 所选目录注册失败：${detail}`);
    await complete(options.api, command.id, leaseToken, {
      outcome: "failed",
      error: "执行端未能注册所选项目目录。"
    });
    return loadConfig(options.configPath);
  }

  options.output.info(`[maple] 项目已绑定：${result.project.name} → ${result.project.path}`);
  try {
    await complete(options.api, command.id, leaseToken, {
      outcome: "succeeded",
      projectId: result.project.projectId!,
      bindingId: result.project.bindingId!
    });
  } catch (error) {
    options.output.warn(`[maple] 项目已绑定，但状态回传失败：${error instanceof Error ? error.message : String(error)}`);
  }
  return result.config;
}

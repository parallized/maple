import { hostname } from "node:os";
import { resolve } from "node:path";
import {
  DEFAULT_WORKSPACE_EXECUTION_SETTINGS,
  WORKER_KINDS,
  type WorkerKind
} from "@maple/protocol";
import { MapleApiClient, MapleApiError } from "./api/client";
import { CLI_CAPABILITIES } from "./capabilities";
import { stringOption, type ParsedArgs } from "./args";
import { loadConfig, normalizeServerUrl, saveConfig } from "./config/store";
import type { CliConfig } from "./config/types";
import { isWorkerShell, WORKER_SHELLS, type WorkerShell } from "./execution/shells";
import { detectCodingAgentTools, toWorkerInventory } from "./execution/tool-availability";
import { registerProject, synchronizeProjects } from "./project/register";
import { RunnerLoop } from "./runner/runner-loop";
import { defaultRunnerName } from "./runner/runner-name";
import { authorizeRunner } from "./auth/device-authorization";

export const CLI_VERSION = "0.1.7";

function workerOption(args: ParsedArgs): WorkerKind {
  const value = stringOption(args, "worker") ?? "codex";
  if (!WORKER_KINDS.includes(value as WorkerKind)) {
    throw new Error(`不支持的 Worker：${value}。可选值：${WORKER_KINDS.join("、")}`);
  }
  return value as WorkerKind;
}

export function shellOption(args: ParsedArgs): WorkerShell {
  const value = stringOption(args, "shell") ?? process.env.MAPLE_WORKER_SHELL?.trim() ?? "direct";
  if (!isWorkerShell(value)) {
    throw new Error(`不支持的 Shell：${value}。可选值：${WORKER_SHELLS.join("、")}`);
  }
  return value;
}

export function concurrencyOption(args: ParsedArgs): number {
  const value = Number(
    stringOption(args, "concurrency") ?? String(DEFAULT_WORKSPACE_EXECUTION_SETTINGS.concurrency)
  );
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) {
    throw new Error("并发数必须是 1 到 16 之间的整数。");
  }
  return value;
}

/** 命令行显式值优先，否则读取当前工作区设置；旧 Server 缺字段时回退到默认值。 */
export async function resolveRunnerConcurrency(api: MapleApiClient, args: ParsedArgs): Promise<number> {
  if (stringOption(args, "concurrency") !== undefined) return concurrencyOption(args);
  try {
    const settings = await api.executionSettings();
    const value = settings.concurrency;
    if (Number.isSafeInteger(value) && value >= 1 && value <= 16) return value;
  } catch {
    // Server 设置暂时不可读时，仍让 Runner 以安全默认值启动。
  }
  return DEFAULT_WORKSPACE_EXECUTION_SETTINGS.concurrency;
}

function requireConnection(config: CliConfig): { serverUrl: string; token: string } {
  if (!config.serverUrl || !config.runner?.token || !config.runner.workspaceId) {
    throw new Error("CLI 尚未授权。请运行 maple connect --server <地址>，并在浏览器确认。");
  }
  return { serverUrl: config.serverUrl, token: config.runner.token };
}

export interface PreparedConnection {
  api: MapleApiClient;
  config: CliConfig;
}

export interface ConnectionPreparationOptions {
  allowBrowserAuthorization?: boolean;
}

export function requiresRunnerAuthorization(config: CliConfig, serverUrl: string): boolean {
  return !config.runner || config.serverUrl !== serverUrl || !config.runner.workspaceId;
}

export function requiresProjectRebinding(
  config: CliConfig,
  serverUrl: string,
  workspaceId: string
): boolean {
  return config.serverUrl !== serverUrl
    || !config.runner?.workspaceId
    || config.runner.workspaceId !== workspaceId;
}

/**
 * 完成浏览器授权、项目注册与同步，返回可直接跑 RunnerLoop 的连接。
 * connect 命令与 TUI 的连接向导共用这一段流程。
 */
export async function prepareConnection(
  args: ParsedArgs,
  configPath: string,
  log: (message: string) => void = console.log,
  signal?: AbortSignal,
  options: ConnectionPreparationOptions = {}
): Promise<PreparedConnection> {
  let config = loadConfig(configPath);
  const requestedServer = stringOption(args, "server") ?? process.env.MAPLE_SERVER_URL;
  const serverUrl = requestedServer ? normalizeServerUrl(requestedServer) : config.serverUrl;
  if (!serverUrl) throw new Error("缺少 Server 地址。请传入 --server http://host:45820。");

  const tools = detectCodingAgentTools();
  let needsAuthorization = requiresRunnerAuthorization(config, serverUrl);
  if (!needsAuthorization && config.runner) {
    try {
      await new MapleApiClient(serverUrl, config.runner.token).heartbeat(
        CLI_VERSION,
        tools.filter((tool) => tool.available).map((tool) => tool.kind),
        [...CLI_CAPABILITIES],
        toWorkerInventory(tools)
      );
    } catch (error) {
      if (!(error instanceof MapleApiError && error.status === 401)) throw error;
      needsAuthorization = true;
      log("[maple] CLI 授权已失效，正在重新授权。");
    }
  }

  if (needsAuthorization) {
    if (options.allowBrowserAuthorization === false) {
      throw new Error("Maple Local 的本地执行端凭据已失效，请退出后重新启动 Maple Local。");
    }
    const localHostname = hostname();
    const authorized = await authorizeRunner(new MapleApiClient(serverUrl), {
      runnerName: defaultRunnerName(localHostname),
      hostname: localHostname,
      platform: `${process.platform}/${process.arch}`,
      version: CLI_VERSION,
      supportedWorkers: tools.filter((tool) => tool.available).map((tool) => tool.kind),
      workerInventory: toWorkerInventory(tools),
      capabilities: [...CLI_CAPABILITIES]
    }, { signal, log });
    const resetProjects = requiresProjectRebinding(config, serverUrl, authorized.workspace.id);
    config = {
      ...config,
      serverUrl,
      runner: {
        id: authorized.runner.id,
        token: authorized.runnerToken,
        name: authorized.runner.name,
        workspaceId: authorized.workspace.id,
        workspaceName: authorized.workspace.name
      },
      projects: resetProjects
        ? config.projects.map((project) => ({ ...project, projectId: null, bindingId: null, registeredAt: null }))
        : config.projects
    };
    saveConfig(config, configPath);
  }

  const connection = requireConnection(config);
  const api = new MapleApiClient(connection.serverUrl, connection.token);
  const projectPath = stringOption(args, "project") ?? args.positionals[0];
  if (projectPath) {
    const result = await registerProject(api, config, {
      path: resolve(projectPath),
      name: stringOption(args, "project-name"),
      workerKind: workerOption(args),
      configPath
    });
    config = result.config;
    log(`[maple] 项目已绑定：${result.project.name} → ${result.project.path}`);
  }

  config = await synchronizeProjects(api, config, configPath);
  if (config.projects.every((project) => !project.projectId)) {
    log("[maple] 尚未绑定项目，正在等待看板添加项目。");
  }
  return { api, config };
}

export async function connectCommand(
  args: ParsedArgs,
  configPath: string,
  signal: AbortSignal,
  options: ConnectionPreparationOptions = {}
): Promise<void> {
  const { api, config } = await prepareConnection(args, configPath, console.log, signal, options);
  const runner = new RunnerLoop(api, config, await resolveRunnerConcurrency(api, args), {
    configPath,
    workerShell: shellOption(args)
  });
  await runner.run(signal);
}

/** 解除一个项目绑定：按名称、项目 ID 或本地 ID 查找，必要时同步通知 Server。 */
export async function removeProjectBinding(configPath: string, needle: string): Promise<string> {
  const config = loadConfig(configPath);
  const project = config.projects.find(
    (item) => item.projectId === needle || item.localId === needle || item.name.toLowerCase() === needle.toLowerCase()
  );
  if (!project) throw new Error(`没有找到项目：${needle}`);
  if (project.projectId && config.runner?.token && config.runner.workspaceId && config.serverUrl) {
    const api = new MapleApiClient(config.serverUrl, config.runner.token);
    try {
      await api.removeProject(project.projectId);
    } catch (error) {
      if (!(error instanceof MapleApiError && error.status === 404)) throw error;
    }
  }
  const next = { ...config, projects: config.projects.filter((item) => item.localId !== project.localId) };
  saveConfig(next, configPath);
  return project.name;
}

export async function projectCommand(args: ParsedArgs, configPath: string): Promise<void> {
  const config = loadConfig(configPath);
  if (args.subcommand === "list") {
    if (config.projects.length === 0) {
      console.log("尚未绑定项目。可在项目目录运行 maple project add .");
      return;
    }
    for (const project of config.projects) {
      const state = project.projectId ? "已同步" : "仅本地";
      console.log(`${project.name}\n  ${project.path}\n  Worker: ${project.workerKind} · ${state} · ${project.projectId ?? project.localId}`);
    }
    return;
  }

  const connection = requireConnection(config);
  const api = new MapleApiClient(connection.serverUrl, connection.token);
  if (args.subcommand === "add") {
    const path = args.positionals[0] ?? process.cwd();
    const result = await registerProject(api, config, {
      path: resolve(path),
      name: stringOption(args, "name"),
      workerKind: workerOption(args),
      configPath
    });
    console.log(`[maple] 项目已绑定：${result.project.name} → ${result.project.path}`);
    return;
  }

  if (args.subcommand === "remove") {
    const needle = args.positionals[0];
    if (!needle) throw new Error("请提供项目名称或项目 ID。");
    const name = await removeProjectBinding(configPath, needle);
    console.log(`[maple] 已解除项目绑定：${name}`);
    return;
  }

  throw new Error(`未知的 project 子命令：${args.subcommand}`);
}

export function statusCommand(configPath: string): void {
  const config = loadConfig(configPath);
  const runnerLabel = config.runner?.workspaceId ? config.runner.name : "需重新授权";
  console.log(`Server：${config.serverUrl || "未配置"}`);
  console.log(`执行端：${runnerLabel}`);
  console.log(`工作区：${config.runner?.workspaceName ?? "未记录"}`);
  console.log(`项目数：${config.projects.length}`);
  console.log(`配置文件：${configPath}`);
}

export function helpText(): string {
  return `Maple CLI · 连接项目目录与 Maple Server

用法：
  maple                       打开交互界面（等同 maple tui）
  maple tui                   打开交互界面
  maple connect --server <URL>
  maple connect --server <URL> --project .
  maple connect [--concurrency 2] [--shell bash]
  maple project add [目录] [--name 名称] [--worker codex|deepseek|claude|kimi|glm|iflow|gemini|opencode]
  maple project list
  maple project remove <名称或项目ID>
  maple status

运行界面快捷键：
  E                           选择并添加本机项目目录
  ← / →                       切换 Worker 运行记录
  Q                           终止退出

推荐首次连接：
  1. 运行 maple connect --server <URL>，CLI 会打开浏览器授权页。
  2. 登录后确认授权，当前工作区会立即获得这台 CLI。
  3. 可以追加 --project .，在连接时直接绑定当前目录。
  4. CLI 会持续领取已绑定项目的 Todo，并在对应本机目录启动 Worker。

Worker 启动 Shell（--shell / MAPLE_WORKER_SHELL）：
  direct（默认，不经 Shell）· sh · bash · zsh · fish · pwsh · powershell · cmd
  Worker 是 .cmd / .ps1 脚本或需要 Shell 环境时，选择对应 Shell 包装启动。

环境变量：
  MAPLE_SERVER_URL      Server 地址
  MAPLE_WORKER_SHELL    Worker 启动 Shell
  MAPLE_MANAGER_WORKER  项目经理使用的 Coding Agent（默认优先 Codex）
  MAPLE_CLI_CONFIG      自定义 CLI 配置文件路径
  MAPLE_CLI_HOME        自定义 CLI 数据目录
  NO_COLOR              禁用彩色输出
`;
}

export function printHelp(): void {
  console.log(helpText());
}

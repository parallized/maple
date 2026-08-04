import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ParsedArgs } from "../args";
import { unbindRunner } from "../auth/unbind";
import { CLI_VERSION, helpText, prepareConnection, resolveRunnerConcurrency } from "../commands";
import { loadConfig, normalizeServerUrl } from "../config/store";
import type { CliConfig } from "../config/types";
import { applyCliUpdate, fetchLatestCliVersion, isNewerVersion } from "../update/updater";
import { displayDashboardUrl } from "../standalone/layout";
import { detectTerminalCapabilities, isMsysPtySession, shellLabel, type TerminalCapabilities } from "../terminal/capabilities";
import { FullscreenSession } from "../terminal/fullscreen";
import { KeySource } from "../terminal/input";
import { displayWidth } from "../terminal/style";
import {
  confirm,
  createWidgetContext,
  pause,
  type SelectOption,
  type WidgetContext
} from "../terminal/widgets";
import { runRunnerView } from "./runner-view";
import { selectMainMenu } from "./main-menu";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printBanner(ctx: WidgetContext, cap: TerminalCapabilities): void {
  const { style, symbols } = ctx;
  const mode = ctx.keys ? "交互模式" : "逐行模式";
  const color = cap.color ? "彩色" : "纯文本";
  console.log(`${style.accent(symbols.dot)} ${style.strong("Maple CLI")}`);
  console.log(style.dim(`${mode} · ${shellLabel(cap.shell)} · ${color}\n`));
}

function mainMenuTitle(config: CliConfig): string {
  const server = config.serverUrl ? displayDashboardUrl(config.serverUrl) : "未配置 Server";
  const runner = config.runner?.workspaceId ? config.runner.name : "需重新授权";
  return `${server} · 执行端 ${runner} · 项目 ${config.projects.length}`;
}

/** 「连接官方服务」直接使用的官方云端地址，不再弹出地址选择。 */
const OFFICIAL_SERVER_URL = "https://maplecode.art";

export const MAIN_MENU_OPTIONS: SelectOption[] = [
  { value: "connect", label: "连接官方服务", hint: "连接 Maple 云端并领取 Todo 执行", icon: "🚀" },
  { value: "local", label: "启动本地服务", hint: "本机一体版，无需登录", icon: "🏠" },
  { value: "unbind", label: "解除绑定", hint: "撤销当前工作区授权", icon: "🔓" },
  { value: "status", label: "状态详情", hint: "连接与配置概览", icon: "📊" },
  { value: "help", label: "使用帮助", hint: "命令与快捷键说明", icon: "💡" },
  { value: "exit", label: "退出", icon: "🚪" }
];

/** 菜单选项：本地一体版不提供「启动本地服务」，连接项指向本机服务；
 *  有可用新版本时在退出前插入「更新」项。 */
export function mainMenuOptionsFor(
  options: TuiOptions,
  updateVersion: string | null = null
): SelectOption[] {
  const base = !options.standalone
    ? MAIN_MENU_OPTIONS
    : MAIN_MENU_OPTIONS
      .filter((item) => item.value !== "local" && item.value !== "unbind")
      .map((item) => item.value === "connect"
        ? { ...item, label: "连接本地服务", hint: "在本机运行 Runner" }
        : item);
  if (!updateVersion) return base;
  return [
    ...base.slice(0, -1),
    {
      value: "update",
      label: `更新到 v${updateVersion}`,
      hint: "下载最新 CLI",
      icon: "⬆️"
    },
    base[base.length - 1]!
  ];
}

export interface TuiOptions {
  fixedServerUrl?: string;
  standalone?: boolean;
  /** 本机一体版启动后直接进入 Runner，不停留在命令菜单。 */
  autoConnect?: boolean;
}

export async function runTui(configPath: string, options: TuiOptions = {}): Promise<void> {
  // Bun 在 Git Bash / MinTTY 下会把 pty 误判为 pipe，此处用同一套兜底判断。
  const stdinTTY = Boolean(process.stdin.isTTY) || isMsysPtySession(process.env, process.platform);
  if (!stdinTTY) {
    console.log("[maple] 当前终端不支持交互输入（stdin 不是 TTY）。请使用 maple help 查看命令用法。");
    return;
  }
  const cap = detectTerminalCapabilities();
  const keys = cap.interactive && KeySource.canUseRawMode() ? new KeySource() : undefined;
  const ctx = createWidgetContext(cap, keys);
  const fullscreen = new FullscreenSession(cap);
  const fullscreenActive = keys ? fullscreen.enter() : false;
  if (!fullscreenActive) printBanner(ctx, cap);

  try {
    if (options.autoConnect) {
      fullscreen.clear();
      await connectWizard(ctx, cap, configPath, options);
      return;
    }
    // 会话内只检查一次可用更新；无 Server 或读取失败时静默返回 null。
    let cachedUpdateVersion: string | null | undefined;
    const availableUpdateVersion = async (serverUrl: string): Promise<string | null> => {
      if (cachedUpdateVersion !== undefined) return cachedUpdateVersion;
      const latest = await fetchLatestCliVersion(serverUrl);
      cachedUpdateVersion = latest && isNewerVersion(CLI_VERSION, latest) ? latest : null;
      return cachedUpdateVersion;
    };
    for (;;) {
      fullscreen.clear();
      const config = loadConfig(configPath);
      const serverUrl = (options.fixedServerUrl ?? config.serverUrl ?? "").trim();
      const updateVersion = serverUrl ? await availableUpdateVersion(serverUrl) : null;
      const menuOptions = mainMenuOptionsFor(options, updateVersion);
      const choice = await selectMainMenu(ctx, mainMenuTitle(config), menuOptions, "connect");
      if (choice === null || choice === "exit") return;
      try {
        if (choice === "connect") await connectWizard(ctx, cap, configPath, options);
        else if (choice === "local") await startLocalService(ctx);
        else if (choice === "unbind") await unbindScreen(ctx, configPath);
        else if (choice === "status") await statusScreen(ctx, cap, configPath);
        else if (choice === "help") await pause(ctx, helpText().trim().split("\n"));
        else if (choice === "update") await updateScreen(ctx, configPath, serverUrl);
      } catch (error) {
        await pause(ctx, ctx.style.danger(`操作失败：${errorMessage(error)}`));
      }
    }
  } finally {
    keys?.close();
    fullscreen.leave();
  }
}

async function unbindScreen(ctx: WidgetContext, configPath: string): Promise<void> {
  const config = loadConfig(configPath);
  if (!config.runner) {
    await pause(ctx, ctx.style.dim("当前 CLI 尚未绑定工作区。"));
    return;
  }

  const workspace = config.runner.workspaceName || "当前工作区";
  const approved = await confirm(
    ctx,
    `解除 ${config.runner.name} 与 ${workspace} 的绑定？本机项目目录会保留。`,
    false
  );
  if (approved !== true) return;

  await unbindRunner(configPath);
  await pause(ctx, ctx.style.success("已解除绑定。再次连接时需要重新在浏览器授权。"));
}

async function updateScreen(ctx: WidgetContext, _configPath: string, serverUrl: string): Promise<void> {
  const result = await applyCliUpdate(serverUrl);
  await pause(
    ctx,
    result.ok ? ctx.style.success(result.message) : ctx.style.danger(result.message)
  );
}

async function connectWizard(
  ctx: WidgetContext,
  cap: TerminalCapabilities,
  configPath: string,
  options: TuiOptions
): Promise<void> {
  // 直接连接：本地一体版用固定本地地址；官方路径按环境变量覆盖，否则直连云端，不再弹出地址选项。
  const serverInput = options.fixedServerUrl ?? (process.env.MAPLE_SERVER_URL?.trim() || OFFICIAL_SERVER_URL);
  const serverUrl = normalizeServerUrl(serverInput);

  const args: ParsedArgs = {
    command: "connect",
    subcommand: null,
    positionals: [],
    options: {
      server: serverUrl,
      shell: "direct"
    }
  };
  const { api, config: prepared } = await prepareConnection(
    args,
    configPath,
    console.log,
    undefined,
    { allowBrowserAuthorization: !options.standalone }
  );
  const concurrency = await resolveRunnerConcurrency(api, args);
  await runRunnerView({
    cap,
    api,
    config: prepared,
    configPath,
    concurrency,
    workerShell: "direct",
    keys: ctx.keys
  });
}

/** 本机一体版入口：合并安装脚本会把本地服务装到 ~/.maple/local-app。 */
function localServiceEntry(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.MAPLE_CLI_HOME?.trim() ? resolve(env.MAPLE_CLI_HOME.trim()) : join(homedir(), ".maple");
  return join(root, "local-app", "maple-local.js");
}

/**
 * 启动本地服务：把终端交给本机一体版（启动 Server、打开看板并直接进入 dashboard、运行 Runner），
 * 退出本地服务后回到 shell，重新运行 maple 即可返回菜单。
 */
async function startLocalService(ctx: WidgetContext): Promise<void> {
  const entry = localServiceEntry();
  if (!existsSync(entry)) {
    await pause(ctx, ctx.style.danger("未找到本地服务（~/.maple/local-app）。请重新运行 Maple 安装脚本完成本地一体版安装。"));
    return;
  }
  const result = spawnSync(process.execPath, [entry], { stdio: "inherit" });
  if (result.error) {
    await pause(ctx, ctx.style.danger(`启动本地服务失败：${result.error.message}`));
    return;
  }
  process.exit(result.status ?? 0);
}

async function statusScreen(ctx: WidgetContext, cap: TerminalCapabilities, configPath: string): Promise<void> {
  const { style, symbols } = ctx;
  const config = loadConfig(configPath);
  const runnerLabel = config.runner?.workspaceId
    ? `${config.runner.name}（${config.runner.id}）`
    : "需重新授权";
  const rows: Array<[string, string]> = [
    ["Server", config.serverUrl || "未配置"],
    ["执行端", runnerLabel],
    ["工作区", config.runner?.workspaceName ?? "未记录"],
    ["配置文件", configPath],
    ["终端", `${shellLabel(cap.shell)} · ${ctx.keys ? "交互模式" : "逐行模式"} · ${cap.color ? "彩色" : "纯文本"}`]
  ];
  const labelWidth = Math.max(...rows.map(([label]) => displayWidth(label)));
  const lines = [
    `${style.accent(symbols.dot)} ${style.strong("状态详情")}`,
    "",
    ...rows.map(([label, value]) => `${style.dim(`${label}${" ".repeat(labelWidth - displayWidth(label))}`)}  ${value}`)
  ];
  if (config.projects.length === 0) {
    lines.push("", style.dim("尚未绑定项目。"));
  } else {
    lines.push("", `${style.accent(symbols.dot)} ${style.strong(`项目（${config.projects.length}）`)}`);
    for (const project of config.projects) {
      lines.push(`${project.name} · ${project.workerKind} · ${project.projectId ? "已同步" : "仅本地"}`);
      lines.push(style.dim(`  ${project.path}`));
    }
  }
  await pause(ctx, lines);
}

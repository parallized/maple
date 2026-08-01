import { WORKER_KINDS } from "@maple/protocol";
import { MapleApiClient } from "../api/client";
import type { ParsedArgs } from "../args";
import { unbindRunner } from "../auth/unbind";
import { helpText, prepareConnection, removeProjectBinding, resolveRunnerConcurrency } from "../commands";
import { loadConfig, normalizeServerUrl } from "../config/store";
import type { CliConfig } from "../config/types";
import { selectProjectDirectory } from "../project/directory-picker";
import { registerProject } from "../project/register";
import { displayDashboardUrl } from "../standalone/layout";
import { detectTerminalCapabilities, isMsysPtySession, shellLabel, type TerminalCapabilities } from "../terminal/capabilities";
import { FullscreenSession } from "../terminal/fullscreen";
import { KeySource } from "../terminal/input";
import { displayWidth } from "../terminal/style";
import {
  confirm,
  createWidgetContext,
  pause,
  selectOne,
  textInput,
  type SelectOption,
  type WidgetContext
} from "../terminal/widgets";
import { runRunnerView } from "./runner-view";
import { selectMainMenu } from "./main-menu";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runTerminalInputSession(
  ctx: WidgetContext,
  interaction: () => Promise<string | null>
): Promise<string | null> {
  ctx.keys?.clear();
  ctx.keys?.suspend();
  try {
    return await interaction();
  } finally {
    ctx.keys?.resume();
    ctx.keys?.clear();
  }
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

const SERVER_PRESETS: SelectOption[] = [
  { value: "https://maplecode.art", label: "官方服务", hint: "maplecode.art", icon: "🌐" },
  { value: "http://127.0.0.1:45820", label: "本地开发", hint: "127.0.0.1:45820", icon: "🏠" }
];

export const MAIN_MENU_OPTIONS: SelectOption[] = [
  { value: "connect", label: "连接并运行", hint: "领取 Todo 并在本机执行", icon: "🚀" },
  { value: "projects", label: "项目管理", hint: "本机目录绑定", icon: "📁" },
  { value: "unbind", label: "解除绑定", hint: "撤销当前工作区授权", icon: "🔓" },
  { value: "status", label: "状态详情", hint: "连接与配置概览", icon: "📊" },
  { value: "help", label: "使用帮助", hint: "命令与快捷键说明", icon: "💡" },
  { value: "exit", label: "退出", icon: "🚪" }
];

export interface TuiOptions {
  fixedServerUrl?: string;
  standalone?: boolean;
  /** 本机一体版启动后直接进入 Runner，不停留在命令菜单。 */
  autoConnect?: boolean;
}

/** Server 地址：预设直选，或进入手动输入。返回 null 表示取消。 */
async function askServerUrl(ctx: WidgetContext, config: CliConfig): Promise<string | null> {
  const current = (process.env.MAPLE_SERVER_URL ?? config.serverUrl ?? "").trim();
  const options: SelectOption[] = [...SERVER_PRESETS, { value: "__custom", label: "手动输入…", icon: "📝" }];
  const initial = SERVER_PRESETS.some((preset) => preset.value === current)
    ? current
    : current
      ? "__custom"
      : SERVER_PRESETS[0]!.value;
  const picked = await selectOne(ctx, "Server 地址", options, initial);
  if (picked === null) return null;
  if (picked !== "__custom") return picked;
  const input = await textInput(ctx, "Server 地址", {
    defaultValue: current,
    placeholder: "http://127.0.0.1:45820",
    validate: (value) => (value.trim() ? null : "请输入 Server 地址。")
  });
  return input === null ? null : input.trim();
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
    for (;;) {
      fullscreen.clear();
      const config = loadConfig(configPath);
      const menuOptions = options.standalone
        ? MAIN_MENU_OPTIONS.filter((item) => item.value !== "unbind")
        : MAIN_MENU_OPTIONS;
      const choice = await selectMainMenu(ctx, mainMenuTitle(config), menuOptions, "connect");
      if (choice === null || choice === "exit") return;
      try {
        if (choice === "connect") await connectWizard(ctx, cap, configPath, options);
        else if (choice === "projects") await projectsScreen(ctx, configPath);
        else if (choice === "unbind") await unbindScreen(ctx, configPath);
        else if (choice === "status") await statusScreen(ctx, cap, configPath);
        else if (choice === "help") await pause(ctx, helpText().trim().split("\n"));
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

async function connectWizard(
  ctx: WidgetContext,
  cap: TerminalCapabilities,
  configPath: string,
  options: TuiOptions
): Promise<void> {
  const config = loadConfig(configPath);

  const serverInput = options.fixedServerUrl ?? await askServerUrl(ctx, config);
  if (serverInput === null) return;
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

async function projectsScreen(ctx: WidgetContext, configPath: string): Promise<void> {
  for (;;) {
    const config = loadConfig(configPath);
    const options: SelectOption[] = config.projects.map((project) => ({
      value: project.localId,
      label: project.name,
      hint: `${project.workerKind} · ${project.projectId ? "已同步" : "仅本地"}`,
      icon: "📦"
    }));
    options.push({ value: "__add", label: "添加项目…", icon: "📥" }, { value: "__back", label: "返回", icon: "🔙" });
    const choice = await selectOne(ctx, `项目管理（${config.projects.length}）`, options, "__back");
    if (choice === null || choice === "__back") return;
    if (choice === "__add") {
      await addProjectFlow(ctx, configPath);
      continue;
    }
    const project = config.projects.find((item) => item.localId === choice);
    if (!project) continue;
    const approved = await confirm(ctx, `移除 ${project.name}（${project.path}）的绑定？`, false);
    if (approved !== true) continue;
    const removed = await removeProjectBinding(configPath, project.localId);
    await pause(ctx, ctx.style.success(`已解除项目绑定：${removed}`));
  }
}

async function addProjectFlow(ctx: WidgetContext, configPath: string): Promise<void> {
  const config = loadConfig(configPath);
  if (!config.runner || !config.serverUrl) throw new Error("尚未授权执行端，请先连接 Server 并在浏览器确认。");
  const path = await selectProjectDirectory(undefined, {
    terminalSession: (interaction) => runTerminalInputSession(ctx, interaction)
  });
  if (path === null) return;
  const name = await textInput(ctx, "项目名称", { placeholder: "留空使用目录名" });
  if (name === null) return;
  const worker = await selectOne(
    ctx,
    "默认 Worker",
    WORKER_KINDS.map((kind) => ({ value: kind, label: kind })),
    "codex"
  );
  if (worker === null) return;
  const api = new MapleApiClient(config.serverUrl, config.runner.token);
  const result = await registerProject(api, config, {
    path,
    name: name.trim() || undefined,
    workerKind: worker as (typeof WORKER_KINDS)[number],
    configPath
  });
  await pause(ctx, ctx.style.success(`项目已绑定：${result.project.name} → ${result.project.path}`));
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

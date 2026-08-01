import type { WorkerKind } from "@maple/protocol";
import type { MapleApiClient } from "../api/client";
import { formatCacheUsage, readCacheUsage } from "../cache/usage";
import { CLI_VERSION } from "../commands";
import { saveConfig } from "../config/store";
import type { CliConfig, LocalProject } from "../config/types";
import { workerLabel } from "../execution/adapters/registry";
import { formatRunLogEntry } from "../execution/run-log";
import type { WorkerShell } from "../execution/shells";
import { detectCodingAgentTools } from "../execution/tool-availability";
import { selectProjectDirectory, type DirectoryPicker } from "../project/directory-picker";
import { selectAndRegisterProject } from "../project/register";
import { applyCliUpdate, fetchLatestCliVersion, isNewerVersion, updateHintText } from "../update/updater";
import { displayDashboardUrl } from "../standalone/layout";
import {
  RunnerLoop,
  type ProjectManagerActivityState,
  type ProjectManagerRunEvent,
  type RunnerConnectionStatus,
  type RunnerOutput
} from "../runner/runner-loop";
import type { TerminalCapabilities } from "../terminal/capabilities";
import { KeySource } from "../terminal/input";
import type { Key } from "../terminal/keymap";
import { wrapPanel } from "../terminal/panel";
import { Screen } from "../terminal/screen";
import { createStyle, createSymbols, displayWidth } from "../terminal/style";
import {
  adjacentLogPane,
  appendLogText,
  createProjectManagerLogPane,
  createWorkerLogPanes,
  visibleLogPaneKeys,
  type LogPane,
  type LogPaneKey
} from "./log-panes";
import { TOOL_LIST_TITLE, toolListRows } from "./tool-list";

export interface RunnerViewOptions {
  cap: TerminalCapabilities;
  api: MapleApiClient;
  config: CliConfig;
  configPath: string;
  concurrency: number;
  workerShell: WorkerShell;
  directoryPicker?: DirectoryPicker;
  /** 会话共享按键源；传入时本视图不负责关闭。 */
  keys?: KeySource;
}

const MAX_LOG_LINES = 500;
const RENDER_INTERVAL_MS = 40;

const SPINNER_UNICODE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_ASCII = ["-", "\\", "|", "/"];

function spinnerFrame(unicode: boolean): string {
  const frames = unicode ? SPINNER_UNICODE : SPINNER_ASCII;
  return frames[Math.floor(Date.now() / 120) % frames.length]!;
}

function serverHost(serverUrl: string | undefined): string {
  if (!serverUrl) return "";
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

export function isAddProjectKey(key: Key): boolean {
  return key.name === "char" && key.char?.toLowerCase() === "e";
}

export function isForceTerminateKey(key: Key): boolean {
  return key.name === "char" && key.char?.toLowerCase() === "x";
}

export function runnerStoppingLabel(forceStopping: boolean): string {
  return forceStopping
    ? "正在强制终止 Worker…"
    : "正在终止，等待 Worker 收尾… 按 X 强制终止";
}

function cleanInlineLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

export function taskTabLabel(index: number, projectName: string, workerKind: WorkerKind): string {
  return `${index + 1} ${cleanInlineLabel(projectName) || "未知项目"} · ${workerLabel(workerKind)}`;
}

export function projectManagerTabLabel(projectName: string, workerKind?: WorkerKind): string {
  return `PM ${cleanInlineLabel(projectName) || "未知项目"} · ${workerKind ? workerLabel(workerKind) : "Coding Agent"}`;
}

function recentProjects(config: CliConfig, limit = 2): LocalProject[] {
  return config.projects
    .map((project, index) => ({ project, index }))
    .sort((left, right) => {
      const timeOrder = (right.project.registeredAt ?? "").localeCompare(left.project.registeredAt ?? "");
      return timeOrder || right.index - left.index;
    })
    .slice(0, Math.max(0, limit))
    .map(({ project }) => project);
}

export function recentProjectNames(config: CliConfig, limit = 2): string[] {
  return recentProjects(config, limit)
    .map((project) => cleanInlineLabel(project.name))
    .filter(Boolean);
}

export function projectManagerStatusLabel(state: ProjectManagerActivityState = "idle"): string {
  if (state === "diagnosing") return "PM诊断中";
  if (state === "dispatched") return "PM已派单";
  if (state === "failed") return "PM异常";
  return "PM待命";
}

export function projectManagerLineLabel(projectName: string, state: ProjectManagerActivityState = "idle"): string {
  return `${cleanInlineLabel(projectName) || "未知项目"} ${projectManagerStatusLabel(state)}`;
}

export function bottomAlignLogLines(lines: readonly string[], height: number): string[] {
  const available = Math.max(0, Math.floor(height));
  if (available === 0) return [];
  const visible = lines.slice(-available);
  return [...Array<string>(available - visible.length).fill(""), ...visible];
}

/** 非交互终端：沿用经典逐行输出，Ctrl+C 由本作用域处理。 */
async function runClassic(options: RunnerViewOptions): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => {
    if (!controller.signal.aborted) {
      console.log("\n[maple] 正在停止…");
      controller.abort();
    }
  };
  process.once("SIGINT", onSigint);
  try {
    const runner = new RunnerLoop(options.api, options.config, options.concurrency, {
      configPath: options.configPath,
      workerShell: options.workerShell
    });
    await runner.run(controller.signal);
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

export async function runRunnerView(options: RunnerViewOptions): Promise<void> {
  if (!options.cap.interactive || (!options.keys && !KeySource.canUseRawMode())) return runClassic(options);

  const { cap } = options;
  const style = createStyle(cap);
  const symbols = createSymbols(cap);
  const screen = new Screen(cap);
  const ownedSource = !options.keys;
  const source = options.keys ?? new KeySource();
  source.clear();
  const controller = new AbortController();

  const codingAgentTools = detectCodingAgentTools();
  const slots = createWorkerLogPanes(options.concurrency);
  const managerPane = createProjectManagerLogPane();
  let currentConfig = options.config;
  let selected: LogPaneKey = 0;
  let connection: RunnerConnectionStatus = { state: "connecting", message: "正在连接 Server…" };
  let cacheLabel = "";
  let stopping = false;
  let forceStopping = false;
  let addingProject = false;
  let terminalPromptActive = false;
  let projectNotice: { kind: "success" | "info" | "error"; message: string } | null = null;
  let latestVersion: string | null = null;
  let updateNotice: { kind: "success" | "error"; text: string } | null = null;
  let updating = false;
  let updateIgnoredVersion = options.config.updateIgnoredVersion ?? undefined;
  const managerStates = new Map<string, ProjectManagerActivityState>();
  let dirty = true;

  const feedPane = (pane: LogPane, text: string) => {
    appendLogText(pane, text, MAX_LOG_LINES);
    dirty = true;
  };

  const feed = (slotIndex: number, text: string) => {
    const slot = slots[slotIndex];
    if (slot) feedPane(slot, text);
  };

  const feedManager = (text: string) => feedPane(managerPane, text);

  const moveSelection = (offset: -1 | 1) => {
    selected = adjacentLogPane(selected, offset, visibleLogPaneKeys(managerPane, slots));
  };

  const output: RunnerOutput = {
    // 全局信息（等待 Todo 之类的历史行）不进入记录区；只有槽位消息上屏。
    info: (message, slot) => {
      if (slot === undefined) return;
      feed(slot, `${message}\n`);
    },
    warn: () => {
      // 连接类警告由状态行表达，其余不干扰 Worker 记录。
    },
    worker: (_stream, chunk, slot) => {
      if (slot === undefined) return;
      feed(slot, chunk);
    },
    record: (event) => {
      const text = formatRunLogEntry(event);
      if (!text) return;
      const line = event.kind === "assistant" || event.kind === "raw" ? text : style.dim(text);
      feed(event.slot, `${line}\n`);
    },
    managerRecord: (event: ProjectManagerRunEvent) => {
      managerPane.projectId = event.projectId;
      managerPane.projectName = event.projectName;
      managerPane.todoTitle = event.todoTitle;
      managerPane.managerWorkerKind = event.managerWorkerKind;
      const text = formatRunLogEntry(event);
      if (!text) return;
      const line = event.kind === "assistant" || event.kind === "raw" ? text : style.dim(text);
      feedManager(`${line}\n`);
    },
    connection: (status) => {
      connection = status;
      dirty = true;
    },
    jobStarted: (slot, _title, projectName, workerKind) => {
      const item = slots[slot];
      if (!item) return;
      item.projectName = projectName;
      item.workerKind = workerKind;
      item.running = true;
      item.logs = [];
      item.pending = "";
      selected = slot;
      dirty = true;
    },
    jobFinished: (slot) => {
      const item = slots[slot];
      if (!item) return;
      item.running = false;
      dirty = true;
    },
    managerStatus: (activity) => {
      managerStates.set(activity.projectId, activity.state);
      if (activity.state === "diagnosing") {
        managerPane.projectId = activity.projectId;
        managerPane.projectName = activity.projectName;
        managerPane.todoTitle = null;
        managerPane.managerWorkerKind = activity.managerWorkerKind ?? null;
        managerPane.running = true;
        managerPane.logs = [];
        managerPane.pending = "";
        selected = "manager";
      } else if (managerPane.projectId === activity.projectId) {
        managerPane.managerWorkerKind = activity.managerWorkerKind ?? managerPane.managerWorkerKind;
        managerPane.running = false;
      }
      dirty = true;
    }
  };

  const render = () => {
    const rows = Math.max(10, process.stdout.rows ?? cap.rows);
    const width = Math.max(20, process.stdout.columns ?? cap.columns);
    // 顶部品牌行 + 底部依次 Worker 标签、分割线、最近项目、连接状态、底部留白。
    const logHeight = rows - 6;
    const pane = selected === "manager" ? managerPane : slots[selected] ?? slots[0]!;
    const body: string[] = [];
    if (pane.logs.length === 0) {
      const spinner = style.accent(spinnerFrame(cap.unicode));
      const waitingLines = selected === "manager"
        ? [`${spinner} ${style.dim(managerPane.todoTitle ? `PM 正在诊断：${managerPane.todoTitle}` : "PM 正在诊断")}`]
        : [
            `${spinner} ${style.dim("等待任务派发中")}`,
            "",
            ...toolListRows(codingAgentTools, width - 12).map((row) => {
              const parts = [
                row.title ? style.white(TOOL_LIST_TITLE) : "",
                ...row.tools.map((tool) => tool.available ? style.softSuccess(tool.label) : style.muted(tool.label))
              ];
              return parts.filter(Boolean).join(" ");
            })
          ];
      const waitingPanel = wrapPanel(waitingLines, null, style, symbols);
      const panelWidth = Math.max(...waitingPanel.map(displayWidth));
      const leftPad = "  ".concat(" ".repeat(Math.max(0, Math.floor((width - 4 - panelWidth) / 2))));
      const topPad = Math.max(0, Math.floor((logHeight - waitingPanel.length) / 2));
      for (let index = 0; index < topPad; index++) body.push("");
      for (const line of waitingPanel) body.push(`${leftPad}${line}`);
    } else {
      body.push(...bottomAlignLogLines(pane.logs, logHeight));
    }
    while (body.length < logHeight) body.push("");
    // 上半区（品牌行、记录区）与底部信息区保持相同的 2 格左边距。
    const paddedBody = body.map((line) => (line ? `  ${line}` : line));

    const workspaceName = currentConfig.runner?.workspaceName?.trim() || "Maple";
    const host = serverHost(displayDashboardUrl(currentConfig.serverUrl));
    const header = `${style.accent(symbols.dot)} ${style.strong("Maple Runner")}${style.dim(` · ${workspaceName}${host ? ` · ${host}` : ""}`)}`;

    // 没有任何 Worker 活动过就不渲染标签，避免“1 空闲”这类占位噪声。
    const visible = [
      ...(managerPane.running || managerPane.logs.length > 0
        ? [{
            key: "manager" as const,
            running: managerPane.running,
            label: projectManagerTabLabel(
              managerPane.projectName ?? "未知项目",
              managerPane.managerWorkerKind ?? undefined
            )
          }]
        : []),
      ...slots
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.running || item.logs.length > 0)
        .map(({ item, index }) => ({
          key: index,
          running: item.running,
          label: item.projectName && item.workerKind
            ? taskTabLabel(index, item.projectName, item.workerKind)
            : `${index + 1} 未知项目 · Coding Agent`
        }))
    ];
    const tabs = visible
      .map(({ key, label, running }) => {
        const padded = ` ${running ? symbols.dot : symbols.ring} ${label} `;
        return key === selected ? style.inverse(padded) : style.softBlock(style.dim(padded));
      })
      .join("");
    const tabBar = visible.length > 1 ? `${tabs}${style.dim("  ← → 切换记录")}` : tabs;
    const projectBarEntries = [
      `${style.accent("E")} ${style.dim("添加项目")}`,
      ...recentProjects(currentConfig).map((project) => {
        const state = project.projectId ? managerStates.get(project.projectId) ?? "idle" : "idle";
        const name = cleanInlineLabel(project.name) || "未知项目";
        const status = projectManagerStatusLabel(state);
        const stateStyle = state === "diagnosing"
          ? style.accent
          : state === "dispatched"
            ? style.softSuccess
            : state === "failed"
              ? style.danger
              : style.muted;
        return `${style.dim(name)} ${stateStyle(status)}`;
      })
    ];
    const projectBar = projectBarEntries.join("  ");

    const dot =
      connection.state === "online"
        ? style.success(symbols.dot)
        : connection.state === "error"
          ? style.danger(symbols.dot)
          : style.dim(symbols.dot);
    const projectStatus = addingProject
      ? style.accent("正在选择并添加项目…")
      : projectNotice?.kind === "success"
        ? style.success(projectNotice.message)
        : projectNotice?.kind === "error"
          ? style.danger(projectNotice.message)
          : projectNotice
            ? style.dim(projectNotice.message)
            : "";
    const status = stopping
      ? style.warning(runnerStoppingLabel(forceStopping))
      : `${style.accent("Q")} ${style.dim("终止退出")}  ${dot} ${connection.message}${projectStatus ? ` · ${projectStatus}` : ""}`;
    // 缓存占用右对齐在状态行；宽度不足（至少留 2 格间距）时省略。
    // 左右各留 2 格边距：贴到最后一列会被部分终端吃掉末尾字符（比如缓存的 M）。
    let statusLine = `  ${status}`;
    if (cacheLabel) {
      const cacheText = style.dim(cacheLabel);
      const gap = width - 4 - displayWidth(status) - displayWidth(cacheText);
      if (gap >= 2) statusLine = `  ${status}${" ".repeat(gap)}${cacheText}  `;
    }
    // 底部信息区与记录区之间一条细分割线（左右各留 2 格），底部再留一行空行。
    const divider = style.panel(`  ${symbols.hr.repeat(Math.max(1, width - 4))}  `);
    // 末行版本条：左侧当前版本，右侧在有新版本时给出更新提示（宽度不足时省略提示）。
    const versionLabel = `Maple v${CLI_VERSION}`;
    let versionLine = `  ${style.dim(versionLabel)}`;
    if (updating) {
      versionLine = `  ${style.dim(versionLabel)}  ${style.accent("正在更新…")}`;
    } else if (updateNotice) {
      const noticeStyle = updateNotice.kind === "success" ? style.success : style.danger;
      versionLine = `  ${style.dim(versionLabel)}  ${noticeStyle(updateNotice.text)}`;
    } else if (latestVersion) {
      const hint = updateHintText(latestVersion);
      const gap = width - 4 - displayWidth(versionLabel) - displayWidth(hint);
      if (gap >= 2) versionLine = `  ${style.dim(versionLabel)}${" ".repeat(gap)}${style.accent(hint)}  `;
    }
    screen.render([
      `  ${header}`,
      ...paddedBody,
      tabBar ? `  ${tabBar}` : "",
      divider,
      `  ${projectBar}`,
      statusLine,
      versionLine,
      ""
    ]);
    dirty = false;
  };

  const painter = setInterval(() => {
    if (!terminalPromptActive && dirty) render();
  }, RENDER_INTERVAL_MS);
  // 等待中的转圈动画：选中面板为空时周期性重绘。
  const spinnerTimer = setInterval(() => {
    if (terminalPromptActive) return;
    const pane = selected === "manager" ? managerPane : slots[selected];
    if (!pane || pane.logs.length === 0) dirty = true;
  }, 150);
  // 缓存占用（Maple / Playwright 目录大小）：启动测一次，之后每分钟刷新。
  const refreshCacheUsage = async () => {
    try {
      cacheLabel = formatCacheUsage(await readCacheUsage());
      dirty = true;
    } catch {
      // 目录不可读等情况忽略，状态行不显示缓存。
    }
  };
  void refreshCacheUsage();
  // 新版本检查：启动一次，之后每 10 分钟复查；失败静默，不打扰 Runner。
  const checkForUpdate = async () => {
    const latest = await fetchLatestCliVersion(currentConfig.serverUrl);
    if (latest && isNewerVersion(CLI_VERSION, latest) && latest !== updateIgnoredVersion) {
      latestVersion = latest;
    }
    dirty = true;
  };
  void checkForUpdate();
  let updateCheckTicks = 0;
  const cacheTimer = setInterval(() => {
    void refreshCacheUsage();
    if (++updateCheckTicks % 10 === 0 && !updating) void checkForUpdate();
  }, 60_000);
  // 终端尺寸变化时按新行列数重算布局（记录区高度、居中、标签栏宽度）。
  const onResize = () => {
    dirty = true;
  };
  process.stdout.on("resize", onResize);

  let terminalSessionTail = Promise.resolve();
  const runTerminalSession = (interaction: () => Promise<string | null>): Promise<string | null> => {
    const session = terminalSessionTail.then(async () => {
      terminalPromptActive = true;
      source.clear();
      screen.suspend();
      source.suspend();
      try {
        return await interaction();
      } finally {
        source.resume();
        source.clear();
        terminalPromptActive = false;
        dirty = true;
        render();
      }
    });
    terminalSessionTail = session.then(() => undefined, () => undefined);
    return session;
  };
  const directoryPicker = options.directoryPicker ?? ((signal?: AbortSignal) => selectProjectDirectory(signal, {
    terminalSession: runTerminalSession
  }));

  const runner = new RunnerLoop(options.api, options.config, options.concurrency, {
    configPath: options.configPath,
    output,
    workerShell: options.workerShell,
    directoryPicker
  });
  const runPromise = runner
    .run(controller.signal)
    .catch((error) => {
      connection = { state: "error", message: `运行异常：${error instanceof Error ? error.message : String(error)}` };
      dirty = true;
    });

  try {
    render();
    for (;;) {
      const key = await Promise.race([source.next(), runPromise.then(() => null)]);
      if (key === null) break;
      if (stopping && isForceTerminateKey(key)) {
        if (!forceStopping) {
          forceStopping = true;
          runner.forceTerminate();
          render();
        }
        continue;
      }
      if (isAddProjectKey(key)) {
        if (addingProject || stopping) continue;
        addingProject = true;
        projectNotice = null;
        source.clear();
        dirty = true;
        render();
        try {
          const result = await selectAndRegisterProject(options.api, {
            configPath: options.configPath,
            signal: controller.signal,
            directoryPicker
          });
          if (result) {
            runner.replaceConfig(result.config);
            currentConfig = result.config;
            projectNotice = { kind: "success", message: `已添加项目 ${result.project.name}` };
          } else if (!controller.signal.aborted) {
            projectNotice = { kind: "info", message: "已取消添加项目" };
          }
        } catch (error) {
          projectNotice = {
            kind: "error",
            message: `添加项目失败：${error instanceof Error ? error.message : String(error)}`
          };
        } finally {
          addingProject = false;
          source.clear();
          dirty = true;
          render();
        }
        continue;
      }
      if (key.name === "ctrl-u") {
        if (!updating && !stopping) {
          updating = true;
          updateNotice = null;
          dirty = true;
          render();
          void (async () => {
            const result = await applyCliUpdate(currentConfig.serverUrl);
            updating = false;
            if (result.ok) {
              if (latestVersion) updateIgnoredVersion = latestVersion;
              latestVersion = null;
              try {
                saveConfig({ ...currentConfig, updateIgnoredVersion });
              } catch {
                // 忽略持久化失败，重启后若仍提示可再按 CTRL + P。
              }
            }
            updateNotice = result.ok
              ? { kind: "success", text: result.message }
              : { kind: "error", text: result.message };
            dirty = true;
          })();
        }
        continue;
      }
      if (key.name === "ctrl-p") {
        if (latestVersion) {
          updateIgnoredVersion = latestVersion;
          latestVersion = null;
          updateNotice = null;
          try {
            saveConfig({ ...currentConfig, updateIgnoredVersion });
          } catch {
            // 忽略持久化失败，仅本次会话内不再提示。
          }
          dirty = true;
          render();
        }
        continue;
      }
      if (key.name === "left") {
        moveSelection(-1);
        dirty = true;
        continue;
      }
      if (key.name === "right") {
        moveSelection(1);
        dirty = true;
        continue;
      }
      if (
        key.name === "escape" ||
        key.name === "ctrl-c" ||
        key.name === "ctrl-d" ||
        (key.name === "char" && (key.char === "q" || key.char === "Q"))
      ) {
        if (!stopping) {
          stopping = true;
          controller.abort();
          render();
        }
        continue;
      }
    }
    stopping = true;
    await runPromise;
    slots.forEach((slot, index) => {
      if (slot.pending) feed(index, "\n");
    });
    if (managerPane.pending) feedManager("\n");
    render();
    screen.commit();
  } finally {
    clearInterval(painter);
    clearInterval(spinnerTimer);
    clearInterval(cacheTimer);
    process.stdout.off("resize", onResize);
    source.clear();
    if (ownedSource) source.close();
  }
}

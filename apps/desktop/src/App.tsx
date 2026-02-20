import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect, useMemo, useRef, useState } from "react";
import { queryProjectTodos, queryRecentContext } from "@maple/mcp-tools";
import { buildWorkerArchiveReport, createWorkerExecutionPrompt, resolveMcpDecision } from "@maple/worker-skills";

import { TopNav } from "./components/TopNav";
import { TaskDetailPanel } from "./components/TaskDetailPanel";
import { ToastLayer } from "./components/ToastLayer";
import { WorkerPickerModal } from "./components/WorkerPickerModal";
import { WorkerConsoleModal } from "./components/WorkerConsoleModal";
import { OverviewView } from "./views/OverviewView";
import { BoardView } from "./views/BoardView";
import { SettingsView } from "./views/SettingsView";

import {
  DEFAULT_MCP_CONFIG,
  DEFAULT_WORKER_CONFIGS,
  STORAGE_MCP_CONFIG,
  STORAGE_PROJECTS,
  STORAGE_THEME,
  STORAGE_WORKER_CONFIGS,
  WORKER_KINDS
} from "./lib/constants";
import type { ThemeMode } from "./lib/constants";
import {
  hasTauriRuntime,
  applyTheme,
  bumpPatch,
  parseArgs,
  deriveProjectName,
  createTask,
  createTaskReport
} from "./lib/utils";
import { loadProjects, loadWorkerConfigs, loadMcpServerConfig, loadTheme } from "./lib/storage";

import type {
  DetailMode,
  McpServerConfig,
  McpServerStatus,
  Project,
  Task,
  ViewKey,
  WorkerCommandResult,
  WorkerConfig,
  WorkerDoneEvent,
  WorkerKind,
  WorkerLogEvent
} from "./domain";

export function App() {
  const isTauri = hasTauriRuntime();

  // ── Core State ──
  const [view, setView] = useState<ViewKey>("overview");
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [workerConfigs, setWorkerConfigs] = useState<Record<WorkerKind, WorkerConfig>>(() => loadWorkerConfigs());
  const [mcpConfig, setMcpConfig] = useState<McpServerConfig>(() => loadMcpServerConfig());
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus>({ running: false, pid: null, command: "" });
  const [mcpStartupError, setMcpStartupError] = useState("");
  const [mcpProjectQuery, setMcpProjectQuery] = useState("");
  const [mcpKeywordQuery, setMcpKeywordQuery] = useState("");
  const [mcpQueryResult, setMcpQueryResult] = useState("");
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null);
  const [pickerForProject, setPickerForProject] = useState<string | null>(null);
  const [releaseReport, setReleaseReport] = useState<string>("");
  const [workerLogs, setWorkerLogs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>("");
  const [detailMode, setDetailMode] = useState<DetailMode>("sidebar");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [workerConsoleOpen, setWorkerConsoleOpen] = useState(false);
  const [workerConsoleWorkerId, setWorkerConsoleWorkerId] = useState<string>(`worker-${WORKER_KINDS[0]?.kind ?? "claude"}`);
  const [runningWorkers, setRunningWorkers] = useState<Set<string>>(() => new Set());
  const [executingWorkers, setExecutingWorkers] = useState<Set<string>>(() => new Set());
  const [workerProjectMap, setWorkerProjectMap] = useState<Record<string, string>>({});
  const [permissionPrompt, setPermissionPrompt] = useState<{ workerId: string; question: string } | null>(null);
  const [theme, setThemeState] = useState<ThemeMode>(() => loadTheme());
  const [windowMaximized, setWindowMaximized] = useState(false);
  const workerLogsRef = useRef<Record<string, string>>({});
  const doneProjectIdsRef = useRef<Set<string>>(new Set());
  const doneProjectInitRef = useRef(false);

  // ── Derived ──
  const boardProject = boardProjectId ? projects.find((p) => p.id === boardProjectId) ?? null : null;
  const currentWorkerLog = workerConsoleWorkerId ? workerLogs[workerConsoleWorkerId] ?? "" : "";

  const metrics = useMemo(() => {
    const allTasks = projects.flatMap((p) => p.tasks);
    const pending = allTasks.filter((t) => t.status !== "已完成").length;
    const completedCount = allTasks.filter((t) => t.status === "已完成").length;
    const inProgressCount = allTasks.filter((t) => t.status === "进行中").length;
    const runningCount = new Set([...runningWorkers, ...executingWorkers]).size;
    const tokenUsageTotal = collectTokenUsage(projects, workerLogs);
    return { pending, completedCount, inProgressCount, runningCount, projectCount: projects.length, tokenUsageTotal };
  }, [projects, runningWorkers, executingWorkers, workerLogs]);

  const workerAvailability = useMemo(
    () =>
      WORKER_KINDS.map((worker) => {
        const executable = workerConfigs[worker.kind]?.executable?.trim() ?? "";
        return {
          kind: worker.kind,
          label: worker.label,
          executable,
          available: executable.length > 0
        };
      }),
    [workerConfigs]
  );

  const workerPoolOverview = useMemo(() => {
    const workerIds = [...new Set([...runningWorkers, ...executingWorkers])];
    return workerIds.map((workerId) => {
      const kindEntry = WORKER_KINDS.find((entry) => `worker-${entry.kind}` === workerId);
      const interactive = runningWorkers.has(workerId);
      const executing = executingWorkers.has(workerId);
      const mode: "interactive" | "task" | "mixed" = interactive && executing ? "mixed" : interactive ? "interactive" : "task";
      return {
        workerId,
        workerLabel: kindEntry?.label ?? workerId,
        mode,
        projectName: workerProjectMap[workerId] ?? "未绑定项目"
      };
    });
  }, [runningWorkers, executingWorkers, workerProjectMap]);

  // ── Persistence ──
  useEffect(() => { applyTheme(theme); localStorage.setItem(STORAGE_THEME, theme); }, [theme]);
  useEffect(() => { localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem(STORAGE_WORKER_CONFIGS, JSON.stringify(workerConfigs)); }, [workerConfigs]);
  useEffect(() => { localStorage.setItem(STORAGE_MCP_CONFIG, JSON.stringify(mcpConfig)); }, [mcpConfig]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    workerLogsRef.current = workerLogs;
  }, [workerLogs]);

  useEffect(() => {
    if (boardProjectId && !projects.some((p) => p.id === boardProjectId)) {
      setBoardProjectId(null);
      setSelectedTaskId(null);
    }
  }, [boardProjectId, projects]);

  async function notifyProjectAllDone(projectName: string) {
    const title = `${projectName} 待办已全部完成`;
    const body = "当前项目已没有待办任务。";

    if (isTauri) {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          granted = permission === "granted";
        }
        if (granted) {
          await sendNotification({ title, body });
          return;
        }
      } catch {
        // fallback to in-app notice
      }
    }

    setNotice(`项目「${projectName}」所有待办已完成。`);
  }

  useEffect(() => {
    const allDone = (project: Project) => project.tasks.length > 0 && project.tasks.every((task) => task.status === "已完成");

    if (!doneProjectInitRef.current) {
      doneProjectIdsRef.current = new Set(projects.filter(allDone).map((project) => project.id));
      doneProjectInitRef.current = true;
      return;
    }

    const currentProjectIds = new Set(projects.map((project) => project.id));
    for (const cachedId of [...doneProjectIdsRef.current]) {
      if (!currentProjectIds.has(cachedId)) {
        doneProjectIdsRef.current.delete(cachedId);
      }
    }

    for (const project of projects) {
      const completed = allDone(project);
      if (completed && !doneProjectIdsRef.current.has(project.id)) {
        doneProjectIdsRef.current.add(project.id);
        void notifyProjectAllDone(project.name);
      } else if (!completed) {
        doneProjectIdsRef.current.delete(project.id);
      }
    }
  }, [projects]);

  // ── Tauri Event Listeners ──
  useEffect(() => {
    void refreshMcpStatus();
    if (!isTauri) return;
    if (mcpConfig.autoStart) void startMcpServer(true);
    void getCurrentWindow().isMaximized().then(setWindowMaximized).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen<WorkerLogEvent>("maple://worker-log", (event) => {
      const { workerId, line } = event.payload;
      setWorkerLogs((prev) => ({ ...prev, [workerId]: `${prev[workerId] ?? ""}${line}` }));
      const permissionPattern = /\b(allow|approve|permit|confirm|accept)\b.*\?|\[y\/n\]|\[Y\/n\]|\[y\/N\]|\(yes\/no\)|\(y\/n\)/i;
      if (permissionPattern.test(line)) setPermissionPrompt({ workerId, question: line });
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen<WorkerDoneEvent>("maple://worker-done", (event) => {
      const { workerId, success, code } = event.payload;
      setRunningWorkers((prev) => { const next = new Set(prev); next.delete(workerId); return next; });
      setWorkerProjectMap((prev) => {
        if (!(workerId in prev)) return prev;
        const next = { ...prev };
        delete next[workerId];
        return next;
      });
      const kindEntry = WORKER_KINDS.find((w) => `worker-${w.kind}` === workerId);
      appendWorkerLog(workerId, `\n[exit ${code ?? "?"}] ${success ? "完成" : "失败"}\n`);
      setNotice(`${kindEntry?.label ?? workerId} 会话已结束（exit ${code ?? "?"}）`);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [isTauri]);

  // ── Worker Logs ──
  function appendWorkerLog(workerId: string, text: string) {
    setWorkerLogs((prev) => ({ ...prev, [workerId]: `${prev[workerId] ?? ""}${text}` }));
  }

  function buildDangerArgs(kind: WorkerKind, dangerMode: boolean): string[] {
    if (!dangerMode) return [];
    if (kind === "claude") return ["--dangerously-skip-permissions"];
    if (kind === "codex") return ["--dangerously-bypass-approvals-and-sandbox"];
    return [];
  }

  function buildWorkerRunArgs(kind: WorkerKind, config: WorkerConfig): string[] {
    return [...buildDangerArgs(kind, config.dangerMode), ...parseArgs(config.runArgs)];
  }

  function buildWorkerConsoleArgs(kind: WorkerKind, config: WorkerConfig): string[] {
    return [...buildDangerArgs(kind, config.dangerMode), ...parseArgs(config.consoleArgs)];
  }

  function quoteShellArg(value: string): string {
    if (value.length === 0) return "''";
    if (!/[^\w@%+=:,./-]/.test(value)) return value;
    return `'${value.replace(/'/g, "'\"'\"'")}'`;
  }

  function formatCommandForLog(executable: string, args: string[], prompt?: string): string {
    const parts = [executable, ...args];
    if (prompt && prompt.length > 0) parts.push(prompt);
    return parts.map(quoteShellArg).join(" ");
  }

  function normalizeTokenNumber(raw: string, unitRaw: string | undefined): number {
    const base = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(base)) return 0;
    const unit = (unitRaw ?? "").trim().toLowerCase();
    if (unit === "k") return base * 1_000;
    if (unit === "m") return base * 1_000_000;
    if (unit === "b") return base * 1_000_000_000;
    return base;
  }

  function extractTokenUsageFromText(text: string): number {
    if (!text) return 0;
    let total = 0;
    const tokenAfterNumber = /(\d[\d,]*(?:\.\d+)?)\s*([kmb])?\s*(?:tokens?|token)\b/gi;
    for (const match of text.matchAll(tokenAfterNumber)) {
      total += normalizeTokenNumber(match[1] ?? "", match[2]);
    }
    const tokenAfterLabel = /(?:tokens?|token)\s*[:=]\s*(\d[\d,]*(?:\.\d+)?)(?:\s*([kmb]))?/gi;
    for (const match of text.matchAll(tokenAfterLabel)) {
      total += normalizeTokenNumber(match[1] ?? "", match[2]);
    }
    return Math.round(total);
  }

  function collectTokenUsage(projectList: Project[], logs: Record<string, string>): number {
    let total = 0;
    for (const project of projectList) {
      for (const task of project.tasks) {
        for (const report of task.reports) {
          total += extractTokenUsageFromText(report.content);
        }
      }
    }
    for (const log of Object.values(logs)) {
      total += extractTokenUsageFromText(log);
    }
    return total;
  }

  function buildWorkerRunPayload(workerId: string, config: WorkerConfig, task: Task, project: Project): { args: string[]; prompt: string } {
    const kind = WORKER_KINDS.find((entry) => `worker-${entry.kind}` === workerId)?.kind;
    const args = kind ? buildWorkerRunArgs(kind, config) : parseArgs(config.runArgs);
    const prompt = createWorkerExecutionPrompt({
      projectName: project.name,
      directory: project.directory,
      taskTitle: task.title
    });
    return { args, prompt };
  }

  // ── Task CRUD ──
  function updateTask(projectId: string, taskId: string, updater: (task: Task) => Task) {
    const now = new Date().toISOString();
    setProjects((prev) =>
      prev.map((p) => p.id !== projectId ? p : {
        ...p,
        tasks: p.tasks.map((t) => t.id !== taskId ? t : { ...updater(t), updatedAt: now })
      })
    );
  }

  function addTask(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const newTask = createTask("", project.version);
    setProjects((prev) => prev.map((p) => p.id !== projectId ? p : { ...p, tasks: [newTask, ...p.tasks] }));
    setEditingTaskId(newTask.id);
  }

  function commitTaskTitle(projectId: string, taskId: string, title: string) {
    const trimmed = title.trim();
    const project = projects.find((p) => p.id === projectId);
    const existingTask = project?.tasks.find((t) => t.id === taskId);
    const hadTitle = existingTask && existingTask.title.trim().length > 0;
    if (!trimmed && !hadTitle) { deleteTask(projectId, taskId); }
    else if (trimmed) { updateTask(projectId, taskId, (t) => ({ ...t, title: trimmed })); }
    setEditingTaskId(null);
  }

  function deleteTask(projectId: string, taskId: string) {
    setProjects((prev) => prev.map((p) => p.id !== projectId ? p : { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }));
    if (selectedTaskId === taskId) setSelectedTaskId(null);
    if (editingTaskId === taskId) setEditingTaskId(null);
  }

  function assignWorkerKind(projectId: string, kind: WorkerKind) {
    setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, workerKind: kind } : p));
  }

  function createBuiltinMcpStatus(): McpServerStatus {
    return { running: true, pid: null, command: "Maple MCP（内置）" };
  }

  function cloneDefaultWorkerConfigs(): Record<WorkerKind, WorkerConfig> {
    return WORKER_KINDS.reduce((acc, item) => {
      acc[item.kind] = { ...DEFAULT_WORKER_CONFIGS[item.kind] };
      return acc;
    }, {} as Record<WorkerKind, WorkerConfig>);
  }

  function formatTime(isoTime: string): string {
    const parsed = new Date(isoTime);
    if (Number.isNaN(parsed.getTime())) return isoTime;
    return parsed.toLocaleString("zh-CN", { hour12: false });
  }

  function compactText(input: string, maxLength = 160): string {
    const plain = input.replace(/\s+/g, " ").trim();
    if (plain.length <= maxLength) return plain;
    return `${plain.slice(0, maxLength - 1)}…`;
  }

  function runMcpTodoQuery() {
    const projectName = mcpProjectQuery.trim() || (boardProject?.name ?? "");
    if (!projectName) {
      setNotice("请先输入项目名。");
      return;
    }
    const todos = queryProjectTodos(projects, projectName);
    if (todos.length === 0) {
      setMcpQueryResult([
        `query_project_todos(project="${projectName}")`,
        "",
        "未找到匹配项目，或该项目暂无未完成任务。"
      ].join("\n"));
      setMcpProjectQuery(projectName);
      return;
    }
    const lines: string[] = [`query_project_todos(project="${projectName}")`, ""];
    for (const [index, todo] of todos.entries()) {
      const tagText = todo.tags.length ? ` | 标签：${todo.tags.join("、")}` : "";
      lines.push(`${index + 1}. [${todo.status}] ${todo.title}`);
      lines.push(`   更新时间：${formatTime(todo.updatedAt)}${tagText}`);
    }
    setMcpProjectQuery(projectName);
    setMcpQueryResult(lines.join("\n"));
  }

  function runMcpRecentQuery() {
    const keyword = mcpKeywordQuery.trim();
    const items = queryRecentContext(projects, workerLogs, keyword, 10);
    const header = keyword
      ? `query_recent_context(limit=10, keyword="${keyword}")`
      : "query_recent_context(limit=10)";
    if (items.length === 0) {
      setMcpQueryResult([header, "", keyword ? "没有匹配该关键词的上下文。" : "暂无上下文记录。"].join("\n"));
      return;
    }
    const lines: string[] = [header, ""];
    for (const [index, item] of items.entries()) {
      const sourceLabel = item.source === "report" ? "任务报告" : "Worker 日志";
      lines.push(`${index + 1}. [${sourceLabel}] ${item.project} / ${item.taskTitle}`);
      lines.push(`   时间：${formatTime(item.createdAt)}`);
      lines.push(`   内容：${compactText(item.text)}`);
      lines.push("");
    }
    setMcpQueryResult(lines.join("\n").trim());
  }

  function applyRecommendedSetup() {
    setMcpConfig(() => ({ ...DEFAULT_MCP_CONFIG, autoStart: true }));
    setWorkerConfigs(cloneDefaultWorkerConfigs());
    setMcpStatus(createBuiltinMcpStatus());
    setNotice("已应用推荐配置：内置 Maple MCP 与默认 Worker 参数。");
  }

  function openWorkerConsole(preferredKind?: WorkerKind, options?: { requireActive?: boolean }) {
    const requireActive = options?.requireActive ?? false;
    const activeWorkerIds = [...runningWorkers, ...executingWorkers];
    if (requireActive && activeWorkerIds.length === 0) {
      setNotice("当前没有正在工作的 Worker 实例，无法打开控制台。");
      return;
    }

    const activePreferred = preferredKind ? `worker-${preferredKind}` : null;
    const fallbackWorkerId =
      (activePreferred && activeWorkerIds.includes(activePreferred) ? activePreferred : null)
      ?? activeWorkerIds[0]
      ?? `worker-${
        preferredKind
        ?? boardProject?.workerKind
        ?? projects.find((project) => project.workerKind)?.workerKind
        ?? WORKER_KINDS[0]?.kind
        ?? "claude"
      }`;

    setWorkerConsoleWorkerId(fallbackWorkerId);
    setWorkerConsoleOpen(true);
  }

  // ── Project Management ──
  async function pickStandaloneDirectory(): Promise<string | null> {
    if (!isTauri) { setNotice("目录选择仅支持桌面端。"); return null; }
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") { setNotice("未选择目录。"); return null; }
    return selected;
  }

  async function createProject() {
    const directory = await pickStandaloneDirectory();
    if (!directory) return;
    const id = `project-${Math.random().toString(36).slice(2, 8)}`;
    const project: Project = { id, name: deriveProjectName(directory), version: "0.1.0", directory, tasks: [] };
    setProjects((prev) => [project, ...prev]);
    setView("board");
    setBoardProjectId(id);
    setSelectedTaskId(null);
  }

  function removeProject(projectId: string) {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setBoardProjectId(null);
    setSelectedTaskId(null);
  }

  // ── MCP Guard ──
  async function ensureMcpRunning(): Promise<boolean> {
    if (!mcpConfig.executable.trim()) {
      setMcpStatus(createBuiltinMcpStatus());
      return true;
    }
    if (!isTauri) return true;
    try {
      const current = await invoke<McpServerStatus>("mcp_server_status");
      setMcpStatus(current);
      if (current.running) return true;
    } catch {
      return false;
    }
    // Attempt auto-start
    await startMcpServer(true);
    // Re-read latest status
    try {
      const status = await invoke<McpServerStatus>("mcp_server_status");
      setMcpStatus(status);
      return status.running;
    } catch {
      return false;
    }
  }

  // ── Worker Execution ──
  async function runWorkerCommand(
    workerId: string,
    config: WorkerConfig,
    task: Task,
    project: Project,
    payload?: { args: string[]; prompt: string }
  ): Promise<WorkerCommandResult> {
    if (!isTauri) return { success: false, code: null, stdout: "", stderr: "当前环境无法执行 Worker CLI。" };
    const runPayload = payload ?? buildWorkerRunPayload(workerId, config, task, project);
    return invoke<WorkerCommandResult>("run_worker", {
      workerId,
      taskTitle: task.title,
      executable: config.executable,
      args: runPayload.args,
      prompt: runPayload.prompt,
      cwd: project.directory
    });
  }

  async function probeWorker(kind: WorkerKind) {
    const config = workerConfigs[kind];
    const label = WORKER_KINDS.find((w) => w.kind === kind)?.label ?? kind;
    if (!config.executable.trim()) { setNotice(`${label} 未配置 executable。`); return; }
    if (!isTauri) { setNotice("当前环境无法探测 Worker。"); return; }
    // Gate on MCP
    const mcpOk = await ensureMcpRunning();
    if (!mcpOk) { setNotice(`MCP Server 未运行，请先在设置中启动 MCP。`); return; }
    const args = parseArgs(config.probeArgs);
    try {
      const result = await invoke<WorkerCommandResult>("probe_worker", { executable: config.executable, args, cwd: "" });
      const workerId = `worker-${kind}`;
      appendWorkerLog(workerId, `\n$ ${config.executable} ${args.join(" ")}\n`);
      if (result.stdout.trim()) appendWorkerLog(workerId, `${result.stdout.trim()}\n`);
      if (result.stderr.trim()) appendWorkerLog(workerId, `${result.stderr.trim()}\n`);
      if (result.success) {
        appendWorkerLog(workerId, "[提示] 验证通过：仅表示 CLI 可执行，未校验 MCP 挂载是否成功。\n");
      }
      setNotice(result.success ? `${label} CLI 可用（未校验 MCP 挂载）` : `${label} 不可用（exit: ${result.code ?? "?"}）`);
    } catch (error) {
      appendWorkerLog(`worker-${kind}`, `\n${label} 探测失败：${String(error)}\n`);
      setNotice(`${label} 探测失败。`);
    }
  }

  async function completePending(projectId: string, overrideKind?: WorkerKind) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const kind = overrideKind ?? project.workerKind;
    if (!kind) { setPickerForProject(projectId); return; }
    if (!project.directory) { setNotice("项目缺少目录，无法执行。"); return; }
    const config = workerConfigs[kind];
    const label = WORKER_KINDS.find((w) => w.kind === kind)?.label ?? kind;
    if (!config.executable.trim()) { setNotice(`请先在进度页配置 ${label} 命令。`); return; }
    // Gate on MCP
    const mcpOk = await ensureMcpRunning();
    if (!mcpOk) { setNotice("MCP Server 未运行，无法执行任务。请先在设置中启动 MCP。"); return; }
    const pendingTasks = project.tasks.filter((t) => t.status === "待办");
    if (pendingTasks.length === 0) { setNotice("目前没有更多待办"); return; }
    setProjects((prev) => {
      const now = new Date().toISOString();
      return prev.map((item) => item.id !== project.id ? item : {
        ...item,
        tasks: item.tasks.map((task) => (
          task.status === "待办"
            ? { ...task, status: "队列中", updatedAt: now }
            : task
        ))
      });
    });
    const nextVersion = bumpPatch(project.version);
    const workerId = `worker-${kind}`;
    setWorkerProjectMap((prev) => ({ ...prev, [workerId]: project.name }));
    setExecutingWorkers((prev) => { const next = new Set(prev); next.add(workerId); return next; });
    openWorkerConsole(kind);
    try {
      for (const task of pendingTasks) {
        try {
          const payload = buildWorkerRunPayload(workerId, config, task, project);
          appendWorkerLog(workerId, `\n$ ${formatCommandForLog(config.executable, payload.args)}\n`);
          const beforeLen = workerLogsRef.current[workerId]?.length ?? 0;
          const result = await runWorkerCommand(workerId, config, task, project, payload);
          const afterLen = workerLogsRef.current[workerId]?.length ?? 0;
          if (!isTauri || afterLen === beforeLen) {
            if (result.stdout.trim()) appendWorkerLog(workerId, `${result.stdout.trim()}\n`);
            if (result.stderr.trim()) appendWorkerLog(workerId, `${result.stderr.trim()}\n`);
          }
          const decision = resolveMcpDecision(result);
          const report = createTaskReport(label, buildWorkerArchiveReport(result, task.title));
          if (!decision) {
            updateTask(project.id, task.id, (c) => ({ ...c, status: "已阻塞", reports: [...c.reports, report] }));
            continue;
          }

          updateTask(project.id, task.id, (c) => ({
            ...c,
            status: decision.status,
            tags: decision.tags,
            version: decision.status === "已完成" ? nextVersion : c.version,
            reports: [...c.reports, report]
          }));

        } catch (error) {
          appendWorkerLog(workerId, `\n${String(error)}\n`);
          updateTask(project.id, task.id, (c) => ({ ...c, status: "已阻塞", reports: [...c.reports, createTaskReport(label, `执行异常：${String(error)}`)] }));
        }
      }
      setNotice(`已触发 ${label} 执行 ${pendingTasks.length} 个任务。`);
    } finally {
      setExecutingWorkers((prev) => {
        const next = new Set(prev);
        next.delete(workerId);
        return next;
      });
      setWorkerProjectMap((prev) => {
        if (runningWorkers.has(workerId) || !(workerId in prev)) return prev;
        const next = { ...prev };
        delete next[workerId];
        return next;
      });
    }
  }

  // ── Console ──
  async function startConsoleSession(workerId: string) {
    if (!isTauri) return;
    if (runningWorkers.has(workerId)) return;
    if (executingWorkers.has(workerId)) {
      setNotice("当前 Worker 正在执行任务，暂不可启动交互终端。");
      return;
    }

    const kindEntry = WORKER_KINDS.find((w) => `worker-${w.kind}` === workerId);
    if (!kindEntry) return;
    const config = workerConfigs[kindEntry.kind];
    if (!config.executable.trim()) { setNotice(`请先配置 ${kindEntry.label} 的 executable。`); return; }
    const project = boardProject ?? projects[0];
    const cwd = project?.directory ?? "";
    const args = buildWorkerConsoleArgs(kindEntry.kind, config);
    appendWorkerLog(workerId, `\n$ ${formatCommandForLog(config.executable, args)}\n`);
    setWorkerProjectMap((prev) => ({ ...prev, [workerId]: project?.name ?? "未绑定项目" }));
    setRunningWorkers((prev) => { const next = new Set(prev); next.add(workerId); return next; });
    try {
      await invoke<boolean>("start_interactive_worker", { workerId, taskTitle: "", executable: config.executable, args, prompt: "", cwd });
    } catch (error) {
      appendWorkerLog(workerId, `\n${String(error)}\n`);
      setRunningWorkers((prev) => { const next = new Set(prev); next.delete(workerId); return next; });
    }
  }

  async function sendConsoleRawInput(workerId: string, input: string) {
    if (!isTauri || !input) return;
    if (!runningWorkers.has(workerId)) return;
    try { await invoke<boolean>("send_worker_input", { workerId, input, appendNewline: false }); }
    catch (error) { appendWorkerLog(workerId, `\n${String(error)}\n`); }
  }

  async function stopCurrentWorker(workerId: string) {
    if (!isTauri) return;
    try { await invoke<boolean>("stop_worker_session", { workerId }); }
    catch (error) { appendWorkerLog(workerId, `\n${String(error)}\n`); }
  }

  async function answerPermission(workerId: string, answer: string) {
    setPermissionPrompt(null);
    if (!isTauri) return;
    appendWorkerLog(workerId, `> ${answer}\n`);
    try { await invoke<boolean>("send_worker_input", { workerId, input: answer, appendNewline: true }); }
    catch (error) { appendWorkerLog(workerId, `\n${String(error)}\n`); }
  }

  // ── Release ──
  function createReleaseDraft(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const nextVersion = bumpPatch(project.version);
    const candidateTasks = project.tasks.filter((t) => t.tags.includes(`v${nextVersion}`));
    const lines = [
      `# ${project.name} v${nextVersion}`, "",
      `- Worker: ${WORKER_KINDS.find((w) => w.kind === project.workerKind)?.label ?? "未分配"}`,
      `- 目录: ${project.directory}`, `- 包含任务: ${candidateTasks.length}`, "",
      "## 建议检查", "逐条确认下列任务对应的交互与结果是否符合预期：", "", "## 任务"
    ];
    for (const t of candidateTasks) lines.push(`- [ ] ${t.title}`);
    if (candidateTasks.length === 0) lines.push("- [ ] 当前无候选任务。");
    lines.push("", "## 变更列表");
    for (const t of candidateTasks) lines.push(`- ${t.title} (${t.status})`);
    setReleaseReport(lines.join("\n"));
  }

  // ── MCP Server ──
  async function refreshMcpStatus() {
    if (!mcpConfig.executable.trim()) {
      setMcpStatus(createBuiltinMcpStatus());
      return;
    }
    if (!isTauri) { setMcpStatus({ running: false, pid: null, command: "" }); return; }
    try { setMcpStatus(await invoke<McpServerStatus>("mcp_server_status")); }
    catch (error) { setNotice(`获取 MCP Server 状态失败：${String(error)}`); }
  }

  async function startMcpServer(silent = false) {
    setMcpStartupError("");
    if (!mcpConfig.executable.trim()) {
      setMcpStatus(createBuiltinMcpStatus());
      if (!silent) setNotice("内置 Maple MCP 已就绪。");
      return;
    }
    if (!isTauri) {
      const msg = "当前环境无法启动 MCP Server。";
      setMcpStartupError(msg);
      if (!silent) setNotice(msg);
      return;
    }
    try {
      const status = await invoke<McpServerStatus>("start_mcp_server", { executable: mcpConfig.executable, args: parseArgs(mcpConfig.args), cwd: mcpConfig.cwd });
      setMcpStatus(status);
      if (status.running) {
        setMcpStartupError("");
        if (!silent) setNotice(`MCP Server 已启动（PID ${status.pid ?? "?"}）`);
      } else {
        const msg = "MCP Server 启动失败，请检查配置。";
        setMcpStartupError(msg);
        if (!silent) setNotice(msg);
      }
    } catch (error) {
      const msg = `MCP Server 启动失败：${String(error)}`;
      setMcpStartupError(msg);
      if (!silent) setNotice(msg);
    }
  }

  async function stopMcpServer(silent = false) {
    setMcpStartupError("");
    if (!mcpConfig.executable.trim()) {
      setMcpStatus(createBuiltinMcpStatus());
      if (!silent) setNotice("当前使用内置 MCP，无需停止。");
      return;
    }
    if (!isTauri) {
      if (!silent) setNotice("当前环境无法停止 MCP Server。");
      return;
    }
    try {
      setMcpStatus(await invoke<McpServerStatus>("stop_mcp_server"));
      if (!silent) setNotice("MCP Server 已停止。");
    } catch (error) {
      if (!silent) setNotice(`MCP Server 停止失败：${String(error)}`);
    }
  }

  async function restartMcpServer() {
    await stopMcpServer(true);
    await startMcpServer(false);
  }

  // ── Window Controls ──
  async function minimizeWindow() {
    if (!isTauri) return;
    try { await getCurrentWindow().minimize(); }
    catch (error) { setNotice(`窗口最小化失败：${String(error)}`); }
  }

  async function toggleWindowMaximize() {
    if (!isTauri) return;
    try {
      const appWindow = getCurrentWindow();
      const maximized = await appWindow.isMaximized();
      if (maximized) await appWindow.unmaximize();
      else await appWindow.maximize();
      setWindowMaximized(!maximized);
    } catch (error) { setNotice(`窗口缩放失败：${String(error)}`); }
  }

  async function closeWindow() {
    if (!isTauri) return;
    try { await getCurrentWindow().close(); }
    catch (error) { setNotice(`窗口关闭失败：${String(error)}`); }
  }

  // ── Render ──
  return (
    <div className="app-root">
      <div className="shell">
        {isTauri ? (
          <div className="drag-strip absolute top-0 left-0 right-0 h-[46px] z-20" data-tauri-drag-region />
        ) : null}

        <TopNav
          isTauri={isTauri}
          windowMaximized={windowMaximized}
          view={view}
          projects={projects}
          boardProjectId={boardProjectId}
          runningCount={metrics.runningCount}
          inProgressCount={metrics.inProgressCount}
          workerConsoleOpen={workerConsoleOpen}
          onViewChange={setView}
          onProjectSelect={(id) => { setBoardProjectId(id); setView("board"); setSelectedTaskId(null); }}
          onCreateProject={() => void createProject()}
          onToggleConsole={() => {
            if (workerConsoleOpen) setWorkerConsoleOpen(false);
            else openWorkerConsole(undefined);
          }}
          onMinimize={minimizeWindow}
          onToggleMaximize={toggleWindowMaximize}
          onClose={closeWindow}
        />

        <div className="main-column">
          <main className="flex-1 overflow-hidden flex flex-col">
            {view === "overview" ? (
              <OverviewView
                metrics={metrics}
                mcpStatus={mcpStatus}
                workerAvailability={workerAvailability}
                workerPool={workerPoolOverview}
              />
            ) : null}

            {view === "board" ? (
              <BoardView
                boardProject={boardProject}
                selectedTaskId={selectedTaskId}
                editingTaskId={editingTaskId}
                detailMode={detailMode}
                releaseReport={releaseReport}
                onAddTask={addTask}
                onCommitTaskTitle={commitTaskTitle}
                onDeleteTask={deleteTask}
                onSelectTask={setSelectedTaskId}
                onEditTask={setEditingTaskId}
                onCompletePending={(id) => void completePending(id)}
                onCreateReleaseDraft={createReleaseDraft}
                onAssignWorkerKind={assignWorkerKind}
                onSetDetailMode={setDetailMode}
                onOpenConsole={() => openWorkerConsole(boardProject?.workerKind)}
                onRemoveProject={removeProject}
              />
            ) : null}

            {view === "progress" || view === "settings" ? (
              <div className="flex-1 overflow-auto px-0.5">
                <SettingsView
                  mcpStatus={mcpStatus}
                  mcpStartupError={mcpStartupError}
                  detailMode={detailMode}
                  theme={theme}
                  onProbeWorker={(kind) => void probeWorker(kind)}
                  onRestartMcpServer={() => void restartMcpServer()}
                  onThemeChange={setThemeState}
                  onDetailModeChange={setDetailMode}
                />
              </div>
            ) : null}
          </main>
        </div>

        {pickerForProject ? (
          <WorkerPickerModal
            onSelect={async (kind) => {
              assignWorkerKind(pickerForProject, kind);
              setPickerForProject(null);
              await completePending(pickerForProject, kind);
            }}
            onClose={() => setPickerForProject(null)}
          />
        ) : null}

        {workerConsoleOpen ? (
          <WorkerConsoleModal
            workerConsoleWorkerId={workerConsoleWorkerId}
            currentWorkerLog={currentWorkerLog}
            runningWorkers={runningWorkers}
            executingWorkers={executingWorkers}
            onClose={() => setWorkerConsoleOpen(false)}
            onStartWorker={(wId) => void startConsoleSession(wId)}
            onSendRawInput={(wId, input) => void sendConsoleRawInput(wId, input)}
            onStopWorker={(wId) => void stopCurrentWorker(wId)}
          />
        ) : null}
      </div>

      <ToastLayer
        permissionPrompt={permissionPrompt}
        notice={notice}
        onAnswerPermission={(wId, answer) => void answerPermission(wId, answer)}
        onDismissPermission={() => setPermissionPrompt(null)}
      />

      {boardProject && selectedTaskId && detailMode === "sidebar" ? (
        <div className="detail-drawer-layer" role="dialog" aria-modal="true" aria-label="任务详情抽屉">
          <button type="button" className="detail-drawer-backdrop" onClick={() => setSelectedTaskId(null)} aria-label="关闭详情抽屉" />
          <aside className="detail-drawer">
            <button
              type="button"
              className="detail-sidebar-close ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn"
              onClick={() => setSelectedTaskId(null)}
              aria-label="关闭侧边栏"
            >
              <Icon icon="mingcute:close-line" />
            </button>
            <TaskDetailPanel
              task={boardProject.tasks.find((t) => t.id === selectedTaskId)!}
              onClose={() => setSelectedTaskId(null)}
              onDelete={() => deleteTask(boardProject.id, selectedTaskId)}
            />
          </aside>
        </div>
      ) : null}

      {boardProject && selectedTaskId && detailMode === "modal" ? (
        <div className="ui-modal" role="dialog" aria-modal="true" aria-label="任务详情">
          <div className="ui-modal-backdrop" onClick={() => setSelectedTaskId(null)} />
          <div className="ui-modal-panel">
            <div className="ui-modal-body">
              <TaskDetailPanel
                task={boardProject.tasks.find((t) => t.id === selectedTaskId)!}
                onClose={() => setSelectedTaskId(null)}
                onDelete={() => deleteTask(boardProject.id, selectedTaskId)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

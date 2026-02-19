import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";

import { TopNav } from "./components/TopNav";
import { ToastLayer } from "./components/ToastLayer";
import { WorkerPickerModal } from "./components/WorkerPickerModal";
import { WorkerConsoleModal } from "./components/WorkerConsoleModal";
import { OverviewView } from "./views/OverviewView";
import { BoardView } from "./views/BoardView";
import { SettingsView } from "./views/SettingsView";

import { STORAGE_PROJECTS, STORAGE_WORKER_CONFIGS, STORAGE_MCP_CONFIG, STORAGE_THEME, WORKER_KINDS } from "./lib/constants";
import type { ThemeMode } from "./lib/constants";
import { hasTauriRuntime, applyTheme, bumpPatch, parseArgs, deriveProjectName, createTask, createTaskReport, buildConclusionReport } from "./lib/utils";
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
  const [consoleInput, setConsoleInput] = useState("");
  const [runningWorkers, setRunningWorkers] = useState<Set<string>>(() => new Set());
  const [permissionPrompt, setPermissionPrompt] = useState<{ workerId: string; question: string } | null>(null);
  const [theme, setThemeState] = useState<ThemeMode>(() => loadTheme());
  const [windowMaximized, setWindowMaximized] = useState(false);

  // ── Derived ──
  const boardProject = boardProjectId ? projects.find((p) => p.id === boardProjectId) ?? null : null;
  const currentWorkerLog = workerConsoleWorkerId ? workerLogs[workerConsoleWorkerId] ?? "" : "";

  const metrics = useMemo(() => {
    const allTasks = projects.flatMap((p) => p.tasks);
    const pending = allTasks.filter((t) => t.status !== "已完成").length;
    return { pending, runningCount: runningWorkers.size, projectCount: projects.length };
  }, [projects, runningWorkers]);

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
    if (boardProjectId && !projects.some((p) => p.id === boardProjectId)) {
      setBoardProjectId(null);
      setSelectedTaskId(null);
    }
  }, [boardProjectId, projects]);

  // ── Tauri Event Listeners ──
  useEffect(() => {
    if (!isTauri) return;
    void refreshMcpStatus();
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
      setWorkerLogs((prev) => ({ ...prev, [workerId]: `${prev[workerId] ?? ""}${line}\n` }));
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
  function clearWorkerLog(workerId: string) {
    setWorkerLogs((prev) => ({ ...prev, [workerId]: "" }));
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
    setProjects((prev) => prev.map((p) => p.id !== projectId ? p : { ...p, tasks: [...p.tasks, newTask] }));
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
    if (!isTauri) return true;
    await refreshMcpStatus();
    if (mcpStatus.running) return true;
    // Attempt auto-start
    if (mcpConfig.executable.trim()) {
      await startMcpServer(true);
      await refreshMcpStatus();
    }
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
  async function runWorkerCommand(workerId: string, config: WorkerConfig, task: Task, project: Project): Promise<WorkerCommandResult> {
    if (!isTauri) return { success: false, code: null, stdout: "", stderr: "当前环境无法执行 Worker CLI。" };
    const kind = WORKER_KINDS.find((entry) => `worker-${entry.kind}` === workerId)?.kind;
    const args = kind ? buildWorkerRunArgs(kind, config) : parseArgs(config.runArgs);
    const prompt = ["[Maple Worker Task]", `Project: ${project.name}`, `Directory: ${project.directory}`, `Task: ${task.title}`, "请执行任务并输出中文结论报告，包含：结论、变更、验证。"].join("\n");
    return invoke<WorkerCommandResult>("run_worker", { workerId, taskTitle: task.title, executable: config.executable, args, prompt, cwd: project.directory });
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
      setNotice(result.success ? `${label} 可用（MCP ✓）` : `${label} 不可用（exit: ${result.code ?? "?"}）`);
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
    const pendingTasks = project.tasks.filter((t) => t.status !== "已完成");
    if (pendingTasks.length === 0) { setNotice("没有待执行任务。"); return; }
    const nextVersion = bumpPatch(project.version);
    const workerId = `worker-${kind}`;
    setWorkerConsoleWorkerId(workerId);
    setWorkerConsoleOpen(true);

    for (const task of pendingTasks) {
      updateTask(project.id, task.id, (c) => ({ ...c, status: "进行中" }));
      try {
        const result = await runWorkerCommand(workerId, config, task, project);
        if (!isTauri) {
          if (result.stdout.trim()) appendWorkerLog(workerId, `${result.stdout.trim()}\n`);
          if (result.stderr.trim()) appendWorkerLog(workerId, `${result.stderr.trim()}\n`);
        }
        if (result.success) {
          updateTask(project.id, task.id, (c) => {
            const tags = new Set(c.tags);
            tags.add("自动完成"); tags.add(`v${nextVersion}`); tags.add(label);
            return { ...c, status: "已完成", tags: [...tags], version: nextVersion, reports: [...c.reports, createTaskReport(label, buildConclusionReport(result, task.title))] };
          });
        } else {
          updateTask(project.id, task.id, (c) => ({ ...c, status: "已阻塞", reports: [...c.reports, createTaskReport(label, buildConclusionReport(result, task.title))] }));
        }
      } catch (error) {
        appendWorkerLog(workerId, `[error] ${task.title}: ${String(error)}\n`);
        updateTask(project.id, task.id, (c) => ({ ...c, status: "已阻塞", reports: [...c.reports, createTaskReport(label, `执行异常：${String(error)}`)] }));
      }
    }
    setNotice(`已触发 ${label} 执行 ${pendingTasks.length} 个任务。`);
  }

  // ── Console ──
  async function sendConsoleCommand(workerId: string, input: string) {
    if (!isTauri || !input.trim()) return;
    const trimmed = input.trim();
    appendWorkerLog(workerId, `> ${trimmed}\n`);
    setConsoleInput("");
    if (runningWorkers.has(workerId)) {
      try { await invoke<boolean>("send_worker_input", { workerId, input: trimmed }); }
      catch (error) { appendWorkerLog(workerId, `[error] 发送失败: ${String(error)}\n`); }
      return;
    }
    const kindEntry = WORKER_KINDS.find((w) => `worker-${w.kind}` === workerId);
    if (!kindEntry) return;
    const config = workerConfigs[kindEntry.kind];
    if (!config.executable.trim()) { setNotice(`请先配置 ${kindEntry.label} 的 executable。`); return; }
    const project = boardProject ?? projects[0];
    const cwd = project?.directory ?? "";
    const args = buildWorkerConsoleArgs(kindEntry.kind, config);
    setRunningWorkers((prev) => { const next = new Set(prev); next.add(workerId); return next; });
    try {
      await invoke<boolean>("start_interactive_worker", { workerId, taskTitle: "", executable: config.executable, args, prompt: trimmed, cwd });
    } catch (error) {
      appendWorkerLog(workerId, `[error] 启动失败: ${String(error)}\n`);
      setRunningWorkers((prev) => { const next = new Set(prev); next.delete(workerId); return next; });
    }
  }

  async function stopCurrentWorker(workerId: string) {
    if (!isTauri) return;
    try { await invoke<boolean>("stop_worker_session", { workerId }); appendWorkerLog(workerId, `[系统] 已发送停止信号\n`); }
    catch (error) { appendWorkerLog(workerId, `[error] 停止失败: ${String(error)}\n`); }
  }

  async function answerPermission(workerId: string, answer: string) {
    setPermissionPrompt(null);
    if (!isTauri) return;
    appendWorkerLog(workerId, `> ${answer}\n`);
    try { await invoke<boolean>("send_worker_input", { workerId, input: answer }); }
    catch (error) { appendWorkerLog(workerId, `[error] 发送失败: ${String(error)}\n`); }
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
    if (!isTauri) { setMcpStatus({ running: false, pid: null, command: "" }); return; }
    try { setMcpStatus(await invoke<McpServerStatus>("mcp_server_status")); }
    catch (error) { setNotice(`获取 MCP Server 状态失败：${String(error)}`); }
  }

  async function startMcpServer(silent = false) {
    if (!isTauri) { if (!silent) setNotice("当前环境无法启动 MCP Server。"); return; }
    if (!mcpConfig.executable.trim()) { if (!silent) setNotice("请先填写 MCP Server executable。"); return; }
    try {
      const status = await invoke<McpServerStatus>("start_mcp_server", { executable: mcpConfig.executable, args: parseArgs(mcpConfig.args), cwd: mcpConfig.cwd });
      setMcpStatus(status);
      if (!silent) setNotice(status.running ? `MCP Server 已启动（PID ${status.pid ?? "?"}）` : "MCP Server 启动失败");
    } catch (error) { if (!silent) setNotice(`MCP Server 启动失败：${String(error)}`); }
  }

  async function stopMcpServer() {
    if (!isTauri) { setNotice("当前环境无法停止 MCP Server。"); return; }
    try { setMcpStatus(await invoke<McpServerStatus>("stop_mcp_server")); setNotice("MCP Server 已停止。"); }
    catch (error) { setNotice(`MCP Server 停止失败：${String(error)}`); }
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
          workerConsoleOpen={workerConsoleOpen}
          onViewChange={setView}
          onProjectSelect={(id) => { setBoardProjectId(id); setView("board"); setSelectedTaskId(null); }}
          onCreateProject={() => void createProject()}
          onToggleConsole={() => setWorkerConsoleOpen(!workerConsoleOpen)}
          onMinimize={minimizeWindow}
          onToggleMaximize={toggleWindowMaximize}
          onClose={closeWindow}
        />

        <div className="main-column">
          <main className="flex-1 overflow-hidden flex flex-col">
            {view === "overview" ? (
              <OverviewView metrics={metrics} mcpStatus={mcpStatus} />
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
                onOpenConsole={() => setWorkerConsoleOpen(true)}
                onRemoveProject={removeProject}
              />
            ) : null}

            {view === "progress" || view === "settings" ? (
              <SettingsView
                mcpConfig={mcpConfig}
                mcpStatus={mcpStatus}
                workerConfigs={workerConfigs}
                theme={theme}
                onMcpConfigChange={setMcpConfig}
                onWorkerConfigChange={(kind, field, value) =>
                  setWorkerConfigs((prev) => ({ ...prev, [kind]: { ...prev[kind], [field]: value } }))
                }
                onWorkerDangerModeChange={(kind, dangerMode) =>
                  setWorkerConfigs((prev) => ({ ...prev, [kind]: { ...prev[kind], dangerMode } }))
                }
                onProbeWorker={(kind) => void probeWorker(kind)}
                onStartMcpServer={() => void startMcpServer()}
                onStopMcpServer={() => void stopMcpServer()}
                onRefreshMcpStatus={() => void refreshMcpStatus()}
                onOpenConsole={() => setWorkerConsoleOpen(true)}
                onThemeChange={setThemeState}
              />
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
            consoleInput={consoleInput}
            runningWorkers={runningWorkers}
            workerLogs={workerLogs}
            onClose={() => setWorkerConsoleOpen(false)}
            onWorkerSelect={setWorkerConsoleWorkerId}
            onConsoleInputChange={setConsoleInput}
            onSendCommand={(wId, input) => void sendConsoleCommand(wId, input)}
            onStopWorker={(wId) => void stopCurrentWorker(wId)}
            onClearLog={clearWorkerLog}
            onNotice={setNotice}
          />
        ) : null}
      </div>

      <ToastLayer
        permissionPrompt={permissionPrompt}
        notice={notice}
        onAnswerPermission={(wId, answer) => void answerPermission(wId, answer)}
        onDismissPermission={() => setPermissionPrompt(null)}
      />
    </div>
  );
}

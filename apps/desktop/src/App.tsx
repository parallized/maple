import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { CountUp, FadeContent, SplitText, SpotlightCard } from "./components/ReactBits";
import { PopoverMenu, type PopoverMenuItem } from "./components/PopoverMenu";
import { TaskDetailPanel } from "./components/TaskDetailPanel";
import type {
  DetailMode,
  McpServerConfig,
  McpServerStatus,
  Project,
  Task,
  TaskReport,
  ViewKey,
  Worker,
  WorkerCommandResult,
  WorkerConfig,
  WorkerKind,
  WorkerLogEvent
} from "./domain";

const STORAGE_PROJECTS = "maple.desktop.projects";
const STORAGE_WORKER_CONFIGS = "maple.desktop.worker-configs";
const STORAGE_MCP_CONFIG = "maple.desktop.mcp-config";
const STORAGE_SIDEBAR_OPEN = "maple.desktop.sidebar-open";

const INITIAL_PROJECTS: Project[] = [];

const INITIAL_WORKERS: Worker[] = [
  { id: "worker-claude", kind: "claude", label: "Claude", busy: false },
  { id: "worker-codex", kind: "codex", label: "Codex", busy: false },
  { id: "worker-iflow", kind: "iflow", label: "iFlow", busy: false }
];

const DEFAULT_WORKER_CONFIGS: Record<WorkerKind, WorkerConfig> = {
  claude: { executable: "claude", runArgs: "-p", probeArgs: "--version" },
  codex: { executable: "codex", runArgs: "exec", probeArgs: "--version" },
  iflow: { executable: "iflow", runArgs: "run", probeArgs: "--version" }
};

const DEFAULT_MCP_CONFIG: McpServerConfig = {
  executable: "npx",
  args: "-y @modelcontextprotocol/server-filesystem .",
  cwd: "",
  autoStart: true
};

function bumpPatch(version: string): string {
  const [major, minor, patch] = version.split(".").map((part) => Number(part));
  return `${major}.${minor}.${patch + 1}`;
}

function parseArgs(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveProjectName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "新项目";
}

function createTask(taskTitle: string, projectVersion: string): Task {
  const nextVersion = bumpPatch(projectVersion);
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: taskTitle,
    status: "待办",
    tags: ["新任务", `v${nextVersion}`],
    version: nextVersion,
    createdAt: now,
    updatedAt: now,
    reports: []
  };
}

function createTaskReport(author: string, content: string): TaskReport {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author,
    content,
    createdAt: new Date().toISOString()
  };
}

function normalizeProjects(projects: Project[]): Project[] {
  const now = new Date().toISOString();
  return projects
    .map((project) => {
      const directory = (project.directory ?? "").trim();
      return {
        ...project,
        directory,
        tasks: project.tasks.map((task) => {
          const createdAt = typeof task.createdAt === "string" && task.createdAt ? task.createdAt : now;
          const updatedAt = typeof task.updatedAt === "string" && task.updatedAt ? task.updatedAt : createdAt;
          return {
            ...task,
            createdAt,
            updatedAt,
            reports: Array.isArray(task.reports) ? task.reports : []
          };
        })
      };
    })
    .filter((project) => project.directory.length > 0);
}

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS);
    if (!raw) {
      return normalizeProjects(INITIAL_PROJECTS);
    }
    const parsed = JSON.parse(raw) as Project[];
    if (!Array.isArray(parsed)) {
      return normalizeProjects(INITIAL_PROJECTS);
    }
    return normalizeProjects(parsed);
  } catch {
    return normalizeProjects(INITIAL_PROJECTS);
  }
}

function loadWorkerConfigs(): Record<WorkerKind, WorkerConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_WORKER_CONFIGS);
    if (!raw) {
      return DEFAULT_WORKER_CONFIGS;
    }
    const parsed = JSON.parse(raw) as Record<WorkerKind, WorkerConfig>;
    return {
      claude: parsed.claude ?? DEFAULT_WORKER_CONFIGS.claude,
      codex: parsed.codex ?? DEFAULT_WORKER_CONFIGS.codex,
      iflow: parsed.iflow ?? DEFAULT_WORKER_CONFIGS.iflow
    };
  } catch {
    return DEFAULT_WORKER_CONFIGS;
  }
}

function loadMcpServerConfig(): McpServerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_MCP_CONFIG);
    if (!raw) {
      return DEFAULT_MCP_CONFIG;
    }
    const parsed = JSON.parse(raw) as Partial<McpServerConfig>;
    return {
      executable: parsed.executable ?? DEFAULT_MCP_CONFIG.executable,
      args: parsed.args ?? DEFAULT_MCP_CONFIG.args,
      cwd: parsed.cwd ?? DEFAULT_MCP_CONFIG.cwd,
      autoStart: parsed.autoStart ?? DEFAULT_MCP_CONFIG.autoStart
    };
  } catch {
    return DEFAULT_MCP_CONFIG;
  }
}

function loadSidebarOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_SIDEBAR_OPEN) === "1";
  } catch {
    return false;
  }
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function buildConclusionReport(result: WorkerCommandResult, taskTitle: string): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  if (stdout) {
    return stdout;
  }

  if (stderr) {
    return [`任务：${taskTitle}`, "结论：执行完成，但未输出标准报告。", `stderr：${stderr}`].join("\n");
  }

  return [`任务：${taskTitle}`, "结论：执行完成，但未输出报告内容。"].join("\n");
}

function InlineTaskInput({ initialValue, onCommit }: { initialValue?: string; onCommit: (title: string) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue ?? "");
  const committed = useRef(false);

  useEffect(() => {
    queueMicrotask(() => ref.current?.focus());
  }, []);

  function commit() {
    if (committed.current) return;
    committed.current = true;
    onCommit(value);
  }

  return (
    <input
      ref={ref}
      className="inline-task-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="输入任务标题…"
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          committed.current = true;
          onCommit("");
        }
      }}
      onBlur={commit}
    />
  );
}

export function App() {
  const isTauri = hasTauriRuntime();

  const [view, setView] = useState<ViewKey>("overview");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => loadSidebarOpen());
  const [projects, setProjects] = useState<Project[]>(() => loadProjects());
  const [workers, setWorkers] = useState<Worker[]>(INITIAL_WORKERS);
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
  const [workerConsoleWorkerId, setWorkerConsoleWorkerId] = useState<string>(() => INITIAL_WORKERS[0]?.id ?? "");

  useEffect(() => {
    localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem(STORAGE_WORKER_CONFIGS, JSON.stringify(workerConfigs));
  }, [workerConfigs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MCP_CONFIG, JSON.stringify(mcpConfig));
  }, [mcpConfig]);

  useEffect(() => {
    localStorage.setItem(STORAGE_SIDEBAR_OPEN, sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (boardProjectId && !projects.some((project) => project.id === boardProjectId)) {
      setBoardProjectId(null);
      setSelectedTaskId(null);
    }
  }, [boardProjectId, projects]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    void refreshMcpStatus();

    if (mcpConfig.autoStart) {
      void startMcpServer(true);
    }
    // 仅在启动时自动拉起，避免编辑配置时重复触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<WorkerLogEvent>("maple://worker-log", (event) => {
        const { workerId, taskTitle, stream, line } = event.payload;
        const taskPrefix = taskTitle ? `[${taskTitle}] ` : "";
        const prefix = stream === "stderr" ? "[stderr] " : "";

        setWorkerLogs((previous) => ({
          ...previous,
          [workerId]: `${previous[workerId] ?? ""}${taskPrefix}${prefix}${line}\n`
        }));
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [isTauri]);

  const boardProject = boardProjectId ? projects.find((project) => project.id === boardProjectId) ?? null : null;
  const selectedTask = boardProject && selectedTaskId ? boardProject.tasks.find((task) => task.id === selectedTaskId) ?? null : null;

  const metrics = useMemo(() => {
    const allTasks = projects.flatMap((project) => project.tasks);
    const pending = allTasks.filter((task) => task.status !== "已完成").length;
    const busyWorkers = workers.filter((worker) => worker.busy).length;
    return { pending, busyWorkers, projectCount: projects.length };
  }, [projects, workers]);

  function appendWorkerLog(workerId: string, text: string) {
    setWorkerLogs((previous) => ({ ...previous, [workerId]: `${previous[workerId] ?? ""}${text}` }));
  }

  function clearWorkerLog(workerId: string) {
    setWorkerLogs((previous) => ({ ...previous, [workerId]: "" }));
  }

  function updateTask(projectId: string, taskId: string, updater: (task: Task) => Task) {
    const now = new Date().toISOString();
    setProjects((previous) =>
      previous.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          tasks: project.tasks.map((task) => {
            if (task.id !== taskId) {
              return task;
            }
            const next = updater(task);
            return { ...next, updatedAt: now };
          })
        };
      })
    );
  }

  function bindWorker(projectId: string, workerId: string) {
    setProjects((previous) => previous.map((project) => (project.id === projectId ? { ...project, workerId } : project)));

    setWorkers((previous) =>
      previous.map((worker) => {
        if (worker.id === workerId) {
          return { ...worker, projectId, busy: false };
        }
        if (worker.projectId === projectId && worker.id !== workerId) {
          return { ...worker, projectId: undefined, busy: false };
        }
        return worker;
      })
    );
  }

  async function pickStandaloneDirectory(): Promise<string | null> {
    if (!isTauri) {
      setNotice("目录选择仅支持桌面端。");
      return null;
    }

    const selected = await open({ directory: true, multiple: false });
    if (typeof selected !== "string") {
      setNotice("未选择目录。");
      return null;
    }

    return selected;
  }

  async function importExistingProject() {
    const directory = await pickStandaloneDirectory();
    if (!directory) {
      return;
    }

    const id = `project-${Math.random().toString(36).slice(2, 8)}`;
    const project: Project = {
      id,
      name: deriveProjectName(directory),
      version: "0.1.0",
      directory,
      tasks: []
    };

    setProjects((previous) => [project, ...previous]);
    setView("board");
    setBoardProjectId(id);
    setSelectedTaskId(null);
  }

  async function createProject() {
    const directory = await pickStandaloneDirectory();
    if (!directory) {
      return;
    }

    const id = `project-${Math.random().toString(36).slice(2, 8)}`;
    const project: Project = {
      id,
      name: deriveProjectName(directory),
      version: "0.1.0",
      directory,
      tasks: []
    };

    setProjects((previous) => [project, ...previous]);
    setView("board");
    setBoardProjectId(id);
    setSelectedTaskId(null);
  }

  function addTask(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const newTask = createTask("", project.version);
    setProjects((previous) =>
      previous.map((item) =>
        item.id !== projectId ? item : { ...item, tasks: [...item.tasks, newTask] }
      )
    );
    setEditingTaskId(newTask.id);
  }

  function commitTaskTitle(projectId: string, taskId: string, title: string) {
    const trimmed = title.trim();
    const project = projects.find((p) => p.id === projectId);
    const existingTask = project?.tasks.find((t) => t.id === taskId);
    const hadTitle = existingTask && existingTask.title.trim().length > 0;

    if (!trimmed && !hadTitle) {
      deleteTask(projectId, taskId);
    } else if (trimmed) {
      updateTask(projectId, taskId, (task) => ({ ...task, title: trimmed }));
    }
    setEditingTaskId(null);
  }

  function deleteTask(projectId: string, taskId: string) {
    setProjects((previous) =>
      previous.map((project) =>
        project.id !== projectId
          ? project
          : { ...project, tasks: project.tasks.filter((task) => task.id !== taskId) }
      )
    );
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
    if (editingTaskId === taskId) {
      setEditingTaskId(null);
    }
  }

  async function runWorkerCommand(
    worker: Worker,
    config: WorkerConfig,
    task: Task,
    project: Project
  ): Promise<WorkerCommandResult> {
    if (!isTauri) {
      return {
        success: false,
        code: null,
        stdout: "",
        stderr: "当前环境无法执行 Worker CLI。"
      };
    }

    const args = parseArgs(config.runArgs);
    const prompt = [
      "[Maple Worker Task]",
      `Project: ${project.name}`,
      `Directory: ${project.directory}`,
      `Task: ${task.title}`,
      "请执行任务并输出中文结论报告，包含：结论、变更、验证。"
    ].join("\n");

    return invoke<WorkerCommandResult>("run_worker", {
      workerId: worker.id,
      taskTitle: task.title,
      executable: config.executable,
      args,
      prompt,
      cwd: project.directory
    });
  }

  async function probeWorker(worker: Worker) {
    const config = workerConfigs[worker.kind];
    if (!config.executable.trim()) {
      setNotice(`${worker.label} 未配置 executable。`);
      return;
    }

    if (!isTauri) {
      setNotice("当前环境无法探测 Worker。");
      return;
    }

    const args = parseArgs(config.probeArgs);

    try {
      const result = await invoke<WorkerCommandResult>("probe_worker", {
        executable: config.executable,
        args,
        cwd: ""
      });

      appendWorkerLog(worker.id, `\n$ ${config.executable} ${args.join(" ")}\n`);
      if (result.stdout.trim()) {
        appendWorkerLog(worker.id, `${result.stdout.trim()}\n`);
      }
      if (result.stderr.trim()) {
        appendWorkerLog(worker.id, `[stderr] ${result.stderr.trim()}\n`);
      }
      setNotice(result.success ? `${worker.label} 可用` : `${worker.label} 不可用（exit: ${result.code ?? "?"}）`);
    } catch (error) {
      appendWorkerLog(worker.id, `\n${worker.label} 探测失败：${String(error)}\n`);
      setNotice(`${worker.label} 探测失败。`);
    }
  }

  async function completePending(projectId: string, overrideWorkerId?: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const effectiveWorkerId = overrideWorkerId ?? project.workerId;
    if (!effectiveWorkerId) {
      setPickerForProject(projectId);
      return;
    }

    if (!project.directory) {
      setNotice("项目缺少目录，无法执行。");
      return;
    }

    const worker = workers.find((item) => item.id === effectiveWorkerId);
    if (!worker) {
      setNotice("未找到绑定 Worker。");
      return;
    }

    const config = workerConfigs[worker.kind];
    if (!config.executable.trim()) {
      setNotice(`请先在进度页配置 ${worker.label} 命令。`);
      return;
    }

    const pendingTasks = project.tasks.filter((task) => task.status !== "已完成");
    if (pendingTasks.length === 0) {
      setNotice("没有待执行任务。");
      return;
    }

    const nextVersion = bumpPatch(project.version);

    setWorkers((previous) => previous.map((item) => (item.id === worker.id ? { ...item, busy: true } : item)));
    setWorkerConsoleWorkerId(worker.id);
    setWorkerConsoleOpen(true);

    for (const task of pendingTasks) {
      updateTask(project.id, task.id, (current) => ({ ...current, status: "进行中" }));

      try {
        appendWorkerLog(worker.id, `\n—— ${task.title} ——\n`);
        const result = await runWorkerCommand(worker, config, task, project);
        appendWorkerLog(worker.id, `[exit ${result.code ?? "?"}] ${result.success ? "完成" : "失败"}\n`);

        if (!isTauri) {
          if (result.stdout.trim()) {
            appendWorkerLog(worker.id, `${result.stdout.trim()}\n`);
          }
          if (result.stderr.trim()) {
            appendWorkerLog(worker.id, `[stderr] ${result.stderr.trim()}\n`);
          }
        }

        if (result.success) {
          updateTask(project.id, task.id, (current) => {
            const tags = new Set(current.tags);
            tags.add("自动完成");
            tags.add(`v${nextVersion}`);
            tags.add(worker.label);
            return {
              ...current,
              status: "已完成",
              tags: [...tags],
              version: nextVersion,
              reports: [...current.reports, createTaskReport(worker.label, buildConclusionReport(result, task.title))]
            };
          });
        } else {
          updateTask(project.id, task.id, (current) => ({
            ...current,
            status: "已阻塞",
            reports: [...current.reports, createTaskReport(worker.label, buildConclusionReport(result, task.title))]
          }));
        }
      } catch (error) {
        const report = createTaskReport(worker.label, `执行异常：${String(error)}`);
        appendWorkerLog(worker.id, `[error] ${task.title}: ${String(error)}\n`);
        updateTask(project.id, task.id, (current) => ({ ...current, status: "已阻塞", reports: [...current.reports, report] }));
      }
    }

    setWorkers((previous) => previous.map((item) => (item.id === worker.id ? { ...item, busy: false } : item)));
    setNotice(`已触发 ${worker.label} 执行 ${pendingTasks.length} 个任务。`);
  }

  function createReleaseDraft(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const nextVersion = bumpPatch(project.version);
    const candidateTasks = project.tasks.filter((task) => task.tags.includes(`v${nextVersion}`));

    const lines = [
      `# ${project.name} v${nextVersion}`,
      "",
      `- Worker: ${workers.find((worker) => worker.id === project.workerId)?.label ?? "未分配"}`,
      `- 目录: ${project.directory}`,
      `- 包含任务: ${candidateTasks.length}`,
      "",
      "## 建议检查",
      "逐条确认下列任务对应的交互与结果是否符合预期：",
      "",
      "## 任务"
    ];

    for (const task of candidateTasks) {
      lines.push(`- [ ] ${task.title}`);
    }
    if (candidateTasks.length === 0) {
      lines.push("- [ ] 当前无候选任务。");
    }

    lines.push("", "## 变更列表");

    for (const task of candidateTasks) {
      lines.push(`- ${task.title} (${task.status})`);
    }

    setReleaseReport(lines.join("\n"));
  }

  async function refreshMcpStatus() {
    if (!isTauri) {
      setMcpStatus({ running: false, pid: null, command: "" });
      return;
    }

    try {
      const status = await invoke<McpServerStatus>("mcp_server_status");
      setMcpStatus(status);
    } catch (error) {
      setNotice(`获取 MCP Server 状态失败：${String(error)}`);
    }
  }

  async function startMcpServer(silent = false) {
    if (!isTauri) {
      if (!silent) {
        setNotice("当前环境无法启动 MCP Server。");
      }
      return;
    }

    if (!mcpConfig.executable.trim()) {
      if (!silent) {
        setNotice("请先填写 MCP Server executable。");
      }
      return;
    }

    try {
      const status = await invoke<McpServerStatus>("start_mcp_server", {
        executable: mcpConfig.executable,
        args: parseArgs(mcpConfig.args),
        cwd: mcpConfig.cwd
      });
      setMcpStatus(status);
      if (!silent) {
        setNotice(status.running ? `MCP Server 已启动（PID ${status.pid ?? "?"}）` : "MCP Server 启动失败");
      }
    } catch (error) {
      if (!silent) {
        setNotice(`MCP Server 启动失败：${String(error)}`);
      }
    }
  }

  async function stopMcpServer() {
    if (!isTauri) {
      setNotice("当前环境无法停止 MCP Server。");
      return;
    }

    try {
      const status = await invoke<McpServerStatus>("stop_mcp_server");
      setMcpStatus(status);
      setNotice("MCP Server 已停止。");
    } catch (error) {
      setNotice(`MCP Server 停止失败：${String(error)}`);
    }
  }

  async function minimizeWindow() {
    if (!isTauri) {
      return;
    }

    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      setNotice(`窗口最小化失败：${String(error)}`);
    }
  }

  async function toggleWindowMaximize() {
    if (!isTauri) {
      return;
    }

    try {
      const appWindow = getCurrentWindow();
      const maximized = await appWindow.isMaximized();
      if (maximized) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
    } catch (error) {
      setNotice(`窗口缩放失败：${String(error)}`);
    }
  }

  async function closeWindow() {
    if (!isTauri) {
      return;
    }

    try {
      await getCurrentWindow().close();
    } catch (error) {
      setNotice(`窗口关闭失败：${String(error)}`);
    }
  }

  return (
    <div className="app-root">
      <div className="shell">
        {isTauri ? (
          <>
            <div className="drag-strip absolute top-0 left-0 right-0 h-[34px] z-20" data-tauri-drag-region />
            <div className="absolute top-1.5 right-2.5 z-30 flex gap-1">
              <button
                type="button"
                className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
                onClick={() => void minimizeWindow()}
                aria-label="最小化"
              >
                <Icon icon="mingcute:minus-line" />
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
                onClick={() => void toggleWindowMaximize()}
                aria-label="最大化"
              >
                <Icon icon="mingcute:square-line" />
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--sm ui-btn--ghost ui-btn--danger ui-icon-btn"
                onClick={() => void closeWindow()}
                aria-label="关闭"
              >
                <Icon icon="mingcute:close-line" />
              </button>
            </div>
          </>
        ) : null}

        <div className="topbar">
          <button
            type="button"
            className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label="菜单"
          >
            <Icon icon="mingcute:menu-line" />
          </button>
          <h1 className="m-0 flex items-center gap-1.5 text-base font-semibold">
            <Icon icon="mingcute:leaf-3-line" />
            <span>Maple</span>
          </h1>
        </div>

        {sidebarOpen ? <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} /> : null}
        <aside className={sidebarOpen ? "sidebar sidebar-open" : "sidebar"}>
        <div className="flex flex-col gap-2 flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 px-1 py-0.5">
            <h1 className="m-0 flex items-center gap-1.5 text-xl font-semibold">
              <Icon icon="mingcute:leaf-3-line" />
              <span className="brand-label">
                <SplitText text="Maple" className="inline" delay={40} />
              </span>
            </h1>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭侧边栏"
            >
              <Icon icon="mingcute:close-line" />
            </button>
          </div>

          <nav className="sidebar-nav flex flex-col gap-0.5">
            <button
              type="button"
              className={`ui-btn ui-btn--sm ui-btn--ghost gap-2 ${view === "overview" ? "active" : ""}`}
              onClick={() => { setView("overview"); setSidebarOpen(false); }}
            >
              <Icon icon="mingcute:home-4-line" />
              <span className="nav-label">概览</span>
            </button>
            <button
              type="button"
              className={`ui-btn ui-btn--sm ui-btn--ghost gap-2 ${view === "progress" ? "active" : ""}`}
              onClick={() => { setView("progress"); setSidebarOpen(false); }}
            >
              <Icon icon="mingcute:settings-3-line" />
              <span className="nav-label">设置</span>
            </button>
          </nav>

          <div className="flex flex-col gap-0.5 mt-1">
            <div className="sidebar-section-header flex items-center gap-1 px-2 py-0.5">
              <span className="nav-label flex-1 text-muted text-xs font-medium uppercase tracking-wide">项目</span>
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn sidebar-action-btn text-muted"
                onClick={() => void createProject()}
                aria-label="新建项目"
              >
                <Icon icon="mingcute:add-line" />
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn sidebar-action-btn text-muted"
                onClick={() => void importExistingProject()}
                aria-label="导入项目"
              >
                <Icon icon="mingcute:folder-transfer-line" />
              </button>
            </div>

            <div className="sidebar-project-list flex flex-col gap-0.5">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={`sidebar-project ui-btn ui-btn--sm ui-btn--ghost gap-2 w-full text-left justify-start ${boardProjectId === project.id && view === "board" ? "active" : ""}`}
                  onClick={() => {
                    setBoardProjectId(project.id);
                    setView("board");
                    setSelectedTaskId(null);
                    setSidebarOpen(false);
                  }}
                >
                  <Icon icon="mingcute:folder-open-line" />
                  <span className="nav-label flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{project.name}</span>
                </button>
              ))}
              {projects.length === 0 ? (
                <p className="nav-label text-muted text-xs px-2">还没有项目</p>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <main className="p-4 px-5 flex-1 overflow-y-auto overflow-x-hidden">
        {view === "overview" ? (
          <FadeContent duration={300}>
            <section>
              <h2 className="text-xl font-semibold m-0">概览</h2>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <SpotlightCard spotlightColor="rgba(47, 111, 179, 0.15)" className="ui-card p-4">
                  <h3 className="text-muted text-sm font-normal m-0">待处理任务</h3>
                  <p className="text-2xl font-semibold mt-1 m-0">
                    <CountUp from={0} to={metrics.pending} duration={0.6} />
                  </p>
                </SpotlightCard>
                <SpotlightCard spotlightColor="rgba(47, 111, 179, 0.15)" className="ui-card p-4">
                  <h3 className="text-muted text-sm font-normal m-0">忙碌 Worker</h3>
                  <p className="text-2xl font-semibold mt-1 m-0">
                    <CountUp from={0} to={metrics.busyWorkers} duration={0.6} />
                  </p>
                </SpotlightCard>
                <SpotlightCard spotlightColor="rgba(47, 111, 179, 0.15)" className="ui-card p-4">
                  <h3 className="text-muted text-sm font-normal m-0">项目数量</h3>
                  <p className="text-2xl font-semibold mt-1 m-0">
                    <CountUp from={0} to={metrics.projectCount} duration={0.6} />
                  </p>
                </SpotlightCard>
              </div>

              <div className="ui-card p-4 mt-3">
                <h3 className="flex items-center gap-1.5 m-0 font-semibold">
                  <Icon icon="mingcute:plug-2-line" />
                  MCP Server
                </h3>
                <p className="text-muted text-sm mt-2">
                  状态：{mcpStatus.running ? `运行中（PID ${mcpStatus.pid ?? "?"}）` : "未运行"}
                  {mcpStatus.command ? ` | ${mcpStatus.command}` : ""}
                </p>
              </div>
            </section>
          </FadeContent>
        ) : null}

        {view === "board" ? (
          <section className="max-w-full">
            {!boardProject ? (
              <FadeContent duration={300}>
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted">
                  <Icon icon="mingcute:folder-open-line" className="text-3xl" />
                  <p>从侧边栏选择一个项目</p>
                </div>
              </FadeContent>
            ) : (
              <>
                <header className="mb-3">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-xl font-semibold m-0">{boardProject.name}</h2>
                    <span className="ui-badge">v{boardProject.version}</span>
                  </div>
                  <p className="text-muted text-sm mt-0.5">{boardProject.directory}</p>
                </header>

                <div className="flex gap-2 mb-3 flex-wrap">
                  <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={() => addTask(boardProject.id)}>
                    <Icon icon="mingcute:add-line" />
                    新建
                  </button>
                  <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={() => void completePending(boardProject.id)}>
                    <Icon icon="mingcute:check-circle-line" />
                    执行待办
                  </button>
                  <button type="button" className="ui-btn ui-btn--sm ui-btn--ghost gap-1" onClick={() => setWorkerConsoleOpen(true)}>
                    <Icon icon="mingcute:terminal-box-line" />
                    控制台
                  </button>
                  <PopoverMenu
                    label="更多"
                    icon="mingcute:more-3-line"
                    items={
                      [
                        { kind: "item", key: "release-draft", label: "版本草稿", icon: "mingcute:send-plane-line", onSelect: () => createReleaseDraft(boardProject.id) },
                        { kind: "heading", label: "详情展示" },
                        { kind: "item", key: "detail-sidebar", label: "右侧边栏", icon: "mingcute:layout-right-line", checked: detailMode === "sidebar", onSelect: () => setDetailMode("sidebar") },
                        { kind: "item", key: "detail-modal", label: "弹出式", icon: "mingcute:layout-grid-line", checked: detailMode === "modal", onSelect: () => setDetailMode("modal") }
                      ] satisfies PopoverMenuItem[]
                    }
                  />
                </div>

                <div className={selectedTask && detailMode === "sidebar" ? "board-body with-detail grid gap-3" : "board-body grid gap-3"}>
                  <div className="min-w-0 overflow-hidden">
                    <table className="task-table">
                      <thead>
                        <tr>
                          <th className="col-task">任务</th>
                          <th className="col-status">状态</th>
                          <th className="col-reports">提及</th>
                          <th className="col-tags">标签</th>
                          <th className="col-version">版本</th>
                          <th className="col-actions"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {boardProject.tasks.map((task) => (
                          <tr
                            key={task.id}
                            className={[
                              "task-row",
                              task.id === selectedTaskId ? "selected" : "",
                              editingTaskId === task.id ? "editing" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() => {
                              if (editingTaskId !== task.id) {
                                setSelectedTaskId(task.id);
                              }
                            }}
                          >
                            <td className="col-task">
                              {editingTaskId === task.id ? (
                                <InlineTaskInput
                                  initialValue={task.title}
                                  onCommit={(title) => commitTaskTitle(boardProject.id, task.id, title)}
                                />
                              ) : (
                                <div className="task-title-cell flex items-center gap-1 min-w-0">
                                  <span
                                    className="task-title-text flex-1 cursor-text rounded px-0.5 overflow-hidden text-ellipsis whitespace-nowrap"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingTaskId(task.id);
                                    }}
                                  >
                                    {task.title || "(无标题)"}
                                  </span>
                                  <button
                                    type="button"
                                    className="task-open-btn ui-btn ui-btn--xs ui-btn--outline gap-0.5 shrink-0 text-[color:var(--color-primary)]"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedTaskId(task.id);
                                    }}
                                  >
                                    <Icon icon="mingcute:arrow-right-up-line" />
                                    打开
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="col-status">
                              <span className={`status-dot status-${task.status === "已完成" ? "done" : task.status === "已阻塞" ? "blocked" : task.status === "进行中" ? "active" : "pending"}`} />
                              {task.status}
                            </td>
                            <td className="col-reports">{task.reports.length > 0 ? task.reports.length : ""}</td>
                            <td className="col-tags">
                              {task.tags.slice(0, 3).map((tag) => (
                                <span key={tag} className="ui-badge mr-1">
                                  {tag}
                                </span>
                              ))}
                              {task.tags.length > 3 ? (
                                <span className="ui-badge opacity-60">+{task.tags.length - 3}</span>
                              ) : null}
                            </td>
                            <td className="col-version">{task.version}</td>
                            <td className="col-actions">
                              <button
                                type="button"
                                className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn row-delete-btn opacity-0 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteTask(boardProject.id, task.id);
                                }}
                                aria-label="删除任务"
                              >
                                <Icon icon="mingcute:delete-2-line" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {boardProject.tasks.length === 0 ? (
                      <div className="py-8 text-center">
                        <p className="text-muted text-sm">还没有任务，点击上方「新建」添加。</p>
                      </div>
                    ) : null}
                  </div>

                  {selectedTask && detailMode === "sidebar" ? (
                    <aside className="ui-card p-4 max-h-[calc(100vh-160px)] overflow-y-auto sticky top-4">
                      <TaskDetailPanel
                        task={selectedTask}
                        onClose={() => setSelectedTaskId(null)}
                        onDelete={() => deleteTask(boardProject.id, selectedTask.id)}
                      />
                    </aside>
                  ) : null}
                </div>

                {releaseReport ? (
                  <div className="ui-card p-4 mt-3">
                    <h3 className="font-semibold m-0">版本草稿</h3>
                    <textarea className="ui-textarea w-full mt-2" value={releaseReport} readOnly rows={14} />
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {view === "progress" ? (
          <FadeContent duration={300}>
            <section>
              <h2 className="text-xl font-semibold m-0">设置</h2>
              <div className="ui-card p-4 mt-3">
                <h3 className="flex items-center gap-1.5 m-0 font-semibold">
                  <Icon icon="mingcute:plug-2-line" />
                  MCP Server
                </h3>
                <div className="grid gap-2 mt-3">
                  <input
                    className="ui-input ui-input--sm w-full"
                    value={mcpConfig.executable}
                    onChange={(event) => setMcpConfig((previous) => ({ ...previous, executable: event.target.value }))}
                    placeholder="启动命令（例如：npx）"
                  />
                  <input
                    className="ui-input ui-input--sm w-full"
                    value={mcpConfig.args}
                    onChange={(event) => setMcpConfig((previous) => ({ ...previous, args: event.target.value }))}
                    placeholder="启动参数（例如：-y @modelcontextprotocol/server-filesystem .）"
                  />
                  <input
                    className="ui-input ui-input--sm w-full"
                    value={mcpConfig.cwd}
                    onChange={(event) => setMcpConfig((previous) => ({ ...previous, cwd: event.target.value }))}
                    placeholder="工作目录（可选）"
                  />
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="ui-checkbox"
                      checked={mcpConfig.autoStart}
                      onChange={(event) => setMcpConfig((previous) => ({ ...previous, autoStart: event.target.checked }))}
                    />
                    启动 Maple 时自动拉起 MCP Server
                  </label>
                </div>
                <div className="flex gap-2 flex-wrap mt-3">
                  <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={() => void startMcpServer()}>
                    <Icon icon="mingcute:play-circle-line" />
                    启动
                  </button>
                  <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={() => void stopMcpServer()}>
                    <Icon icon="mingcute:stop-circle-line" />
                    停止
                  </button>
                  <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={() => void refreshMcpStatus()}>
                    <Icon icon="mingcute:refresh-2-line" />
                    刷新状态
                  </button>
                </div>
                <p className="text-muted text-sm mt-2">
                  当前状态：{mcpStatus.running ? `运行中（PID ${mcpStatus.pid ?? "?"}）` : "未运行"}
                  {mcpStatus.command ? ` | ${mcpStatus.command}` : ""}
                </p>
              </div>

              <div className="ui-card p-4 mt-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 m-0 font-semibold">
                    <Icon icon="mingcute:ai-line" />
                    Worker 接入
                  </h3>
                  <button
                    type="button"
                    className="ui-btn ui-btn--sm ui-btn--ghost gap-1"
                    onClick={() => setWorkerConsoleOpen(true)}
                  >
                    <Icon icon="mingcute:terminal-box-line" />
                    控制台
                  </button>
                </div>
                <div className="overflow-x-auto mt-3">
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Worker</th>
                        <th>状态</th>
                        <th>绑定项目</th>
                        <th>CLI 配置</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workers.map((worker) => {
                        const config = workerConfigs[worker.kind];
                        const boundProject = projects.find((project) => project.id === worker.projectId);

                        return (
                          <tr key={worker.id}>
                            <td className="font-medium">{worker.label}</td>
                            <td>
                              <span className={worker.busy ? "ui-badge ui-badge--warning" : "ui-badge ui-badge--success"}>
                                {worker.busy ? "忙碌" : "空闲"}
                              </span>
                            </td>
                            <td>{boundProject?.name ?? "-"}</td>
                            <td>
                              <div className="grid gap-1.5">
                                <input
                                  className="ui-input ui-input--xs w-full"
                                  value={config.executable}
                                  onChange={(event) =>
                                    setWorkerConfigs((previous) => ({
                                      ...previous,
                                      [worker.kind]: { ...previous[worker.kind], executable: event.target.value }
                                    }))
                                  }
                                  placeholder="命令（例如：codex / claude）"
                                />
                                <input
                                  className="ui-input ui-input--xs w-full"
                                  value={config.runArgs}
                                  onChange={(event) =>
                                    setWorkerConfigs((previous) => ({
                                      ...previous,
                                      [worker.kind]: { ...previous[worker.kind], runArgs: event.target.value }
                                    }))
                                  }
                                  placeholder="执行参数（例如：exec 或 -p）"
                                />
                                <input
                                  className="ui-input ui-input--xs w-full"
                                  value={config.probeArgs}
                                  onChange={(event) =>
                                    setWorkerConfigs((previous) => ({
                                      ...previous,
                                      [worker.kind]: { ...previous[worker.kind], probeArgs: event.target.value }
                                    }))
                                  }
                                  placeholder="探测参数（例如：--version）"
                                />
                              </div>
                            </td>
                            <td>
                              <button type="button" className="ui-btn ui-btn--xs ui-btn--outline gap-1" onClick={() => void probeWorker(worker)}>
                                <Icon icon="mingcute:search-line" />
                                验证
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ui-card p-4 mt-3">
                <h3 className="m-0 font-semibold">Worker 日志</h3>
                {workers.map((worker) => (
                  <details key={worker.id} className="ui-details mt-2">
                    <summary className="text-sm font-medium">{worker.label}</summary>
                    <div className="p-3">
                      <pre className="bg-[color:var(--color-base-200)] rounded-lg p-3 text-xs whitespace-pre-wrap break-words m-0 border-0">
                        {workerLogs[worker.id] || "暂无日志"}
                      </pre>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          </FadeContent>
        ) : null}
      </main>

      {pickerForProject ? (
        <div className="ui-modal" role="dialog" aria-modal="true" aria-label="选择 Worker">
          <div className="ui-modal-backdrop" onClick={() => setPickerForProject(null)} />
          <div className="ui-modal-panel">
            <div className="ui-modal-body">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold m-0">选择 Worker</h3>
                  <p className="text-muted text-sm mt-1">绑定后会执行当前项目的待办任务。</p>
                </div>
                <button
                  type="button"
                  className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
                  onClick={() => setPickerForProject(null)}
                  aria-label="关闭"
                >
                  <Icon icon="mingcute:close-line" />
                </button>
              </div>

              <div className="flex gap-2 flex-wrap mt-4">
                {workers.map((worker) => (
                  <button
                    key={worker.id}
                    type="button"
                    className="ui-btn ui-btn--sm ui-btn--outline gap-1"
                    onClick={async () => {
                      bindWorker(pickerForProject, worker.id);
                      setPickerForProject(null);
                      await completePending(pickerForProject, worker.id);
                    }}
                  >
                    <Icon icon="mingcute:ai-line" />
                    {worker.label}
                  </button>
                ))}
              </div>

              <div className="flex justify-end mt-4">
                <button type="button" className="ui-btn ui-btn--sm ui-btn--ghost" onClick={() => setPickerForProject(null)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {workerConsoleOpen ? (
        <div className="ui-modal" role="dialog" aria-modal="true" aria-label="Worker 控制台">
          <div className="ui-modal-backdrop" onClick={() => setWorkerConsoleOpen(false)} />
          <div className="ui-modal-panel">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[color:var(--color-base-200)]">
              <h3 className="m-0 font-semibold">Worker 控制台</h3>
              <button
                type="button"
                className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
                onClick={() => setWorkerConsoleOpen(false)}
                aria-label="关闭"
              >
                <Icon icon="mingcute:close-line" />
              </button>
            </div>
            <div className="ui-modal-body">
              <div className="grid grid-cols-[180px_1fr] gap-3">
                <div className="flex flex-col gap-1">
                  {workers.map((worker) => (
                    <button
                      key={worker.id}
                      type="button"
                      className={`ui-btn ui-btn--sm ui-btn--ghost justify-start gap-2 ${workerConsoleWorkerId === worker.id ? "bg-[color:var(--sidebar-active)]" : ""}`}
                      onClick={() => setWorkerConsoleWorkerId(worker.id)}
                    >
                      <span className={worker.busy ? "ui-badge ui-badge--warning" : "ui-badge ui-badge--success"}>
                        {worker.busy ? "忙碌" : "空闲"}
                      </span>
                      <span className="flex-1 text-left">{worker.label}</span>
                    </button>
                  ))}
                </div>

                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="m-0 text-muted text-xs">
                      {workerConsoleWorkerId ? `当前：${workers.find((worker) => worker.id === workerConsoleWorkerId)?.label ?? workerConsoleWorkerId}` : "当前：-"}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="ui-btn ui-btn--xs ui-btn--outline gap-1"
                        onClick={() => clearWorkerLog(workerConsoleWorkerId)}
                        disabled={!workerConsoleWorkerId}
                      >
                        <Icon icon="mingcute:delete-2-line" />
                        清空
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn--xs ui-btn--outline gap-1"
                        onClick={async () => {
                          const text = workerConsoleWorkerId ? workerLogs[workerConsoleWorkerId] ?? "" : "";
                          if (!text.trim()) {
                            setNotice("当前没有可复制的日志。");
                            return;
                          }
                          try {
                            await navigator.clipboard.writeText(text);
                            setNotice("已复制到剪贴板。");
                          } catch {
                            setNotice("复制失败，请稍后重试。");
                          }
                        }}
                        disabled={!workerConsoleWorkerId}
                      >
                        <Icon icon="mingcute:copy-2-line" />
                        复制
                      </button>
                    </div>
                  </div>
                  <pre className="mt-2 bg-[color:var(--color-base-200)] rounded-lg p-3 text-xs whitespace-pre-wrap break-words m-0 border-0 max-h-[56vh] overflow-auto">
                    {(workerConsoleWorkerId ? workerLogs[workerConsoleWorkerId] : "") || "暂无日志"}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detailMode === "modal" && selectedTask && boardProject ? (
        <div className="ui-modal" role="dialog" aria-modal="true" aria-label="任务详情">
          <div className="ui-modal-backdrop" onClick={() => setSelectedTaskId(null)} />
          <div className="ui-modal-panel">
            <div className="ui-modal-body">
              <TaskDetailPanel
                task={selectedTask}
                onClose={() => setSelectedTaskId(null)}
                onDelete={() => deleteTask(boardProject.id, selectedTask.id)}
              />
            </div>
          </div>
        </div>
      ) : null}
      </div>

      {notice ? (
        <div className="toast-container" role="alert">
          <div className="toast">
            <Icon icon="mingcute:information-line" />
            <span>{notice}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

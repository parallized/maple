import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { PopoverMenu, type PopoverMenuItem } from "./components/PopoverMenu";

type ViewKey = "overview" | "board" | "progress";
type WorkerKind = "claude" | "codex" | "iflow";
type TaskStatus = "待办" | "队列中" | "进行中" | "已完成" | "已阻塞";
type DetailMode = "sidebar" | "modal";

type Worker = {
  id: string;
  kind: WorkerKind;
  label: string;
  busy: boolean;
  projectId?: string;
};

type WorkerConfig = {
  executable: string;
  runArgs: string;
  probeArgs: string;
};

type McpServerConfig = {
  executable: string;
  args: string;
  cwd: string;
  autoStart: boolean;
};

type WorkerCommandResult = {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

type McpServerStatus = {
  running: boolean;
  pid: number | null;
  command: string;
};

type TaskReport = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  tags: string[];
  version: string;
  reports: TaskReport[];
};

type Project = {
  id: string;
  name: string;
  version: string;
  directory: string;
  workerId?: string;
  tasks: Task[];
};

const STORAGE_PROJECTS = "maple.desktop.projects";
const STORAGE_WORKER_CONFIGS = "maple.desktop.worker-configs";
const STORAGE_MCP_CONFIG = "maple.desktop.mcp-config";

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
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: taskTitle,
    status: "待办",
    tags: ["新任务", `v${nextVersion}`],
    version: nextVersion,
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
  return projects
    .map((project) => {
      const directory = (project.directory ?? "").trim();
      return {
        ...project,
        directory,
        tasks: project.tasks.map((task) => ({
          ...task,
          reports: Array.isArray(task.reports) ? task.reports : []
        }))
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

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatReportTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
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

type TaskDetailPanelProps = {
  task: Task;
  onClose?: () => void;
};

function TaskDetailPanel({ task, onClose }: TaskDetailPanelProps) {
  return (
    <section className="task-detail">
      <header>
        <h3>
          {task.title}
          <span className="mention-badge">提及 {task.reports.length}</span>
        </h3>
        {onClose ? (
          <button className="icon-button" onClick={onClose} aria-label="关闭详情">
            <Icon icon="mingcute:close-line" />
          </button>
        ) : null}
      </header>

      <p className="detail-meta">状态：{task.status}</p>
      <p className="detail-meta">标签：{task.tags.join("、") || "无"}</p>
      <p className="detail-meta">版本：{task.version}</p>

      <div className="report-list">
        {task.reports.length === 0 ? <p className="hint">暂无结论报告。</p> : null}

        {task.reports.map((report) => (
          <article key={report.id} className="report-item">
            <div className="report-head">
              <strong>{report.author}</strong>
              <span>{formatReportTime(report.createdAt)}</span>
            </div>
            <pre>{report.content}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const isTauri = hasTauriRuntime();

  const [view, setView] = useState<ViewKey>("overview");
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

  const boardProject = boardProjectId ? projects.find((project) => project.id === boardProjectId) ?? null : null;
  const selectedTask = boardProject && selectedTaskId ? boardProject.tasks.find((task) => task.id === selectedTaskId) ?? null : null;

  const metrics = useMemo(() => {
    const allTasks = projects.flatMap((project) => project.tasks);
    const pending = allTasks.filter((task) => task.status !== "已完成").length;
    const busyWorkers = workers.filter((worker) => worker.busy).length;
    return { pending, busyWorkers, projectCount: projects.length };
  }, [projects, workers]);

  function appendWorkerLog(workerId: string, text: string) {
    setWorkerLogs((previous) => ({ ...previous, [workerId]: text }));
  }

  function updateTask(projectId: string, taskId: string, updater: (task: Task) => Task) {
    setProjects((previous) =>
      previous.map((project) => {
        if (project.id !== projectId) {
          return project;
        }
        return {
          ...project,
          tasks: project.tasks.map((task) => (task.id === taskId ? updater(task) : task))
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
    if (!project) {
      return;
    }

    const taskTitle = globalThis.prompt("任务标题", "新任务");
    if (!taskTitle) {
      return;
    }

    const nextTask = createTask(taskTitle, project.version);
    setProjects((previous) =>
      previous.map((item) => {
        if (item.id !== projectId) {
          return item;
        }
        return {
          ...item,
          tasks: [nextTask, ...item.tasks]
        };
      })
    );
    setSelectedTaskId(nextTask.id);
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

      appendWorkerLog(worker.id, `${worker.label} probe\nstdout: ${result.stdout || "(empty)"}\nstderr: ${result.stderr || "(empty)"}`);
      setNotice(result.success ? `${worker.label} 可用` : `${worker.label} 不可用（exit: ${result.code ?? "?"}）`);
    } catch (error) {
      appendWorkerLog(worker.id, `${worker.label} probe error: ${String(error)}`);
      setNotice(`${worker.label} 探测失败。`);
    }
  }

  async function completePending(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    if (!project.workerId) {
      setPickerForProject(projectId);
      return;
    }

    if (!project.directory) {
      setNotice("项目缺少目录，无法执行。");
      return;
    }

    const worker = workers.find((item) => item.id === project.workerId);
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

    for (const task of pendingTasks) {
      updateTask(project.id, task.id, (current) => ({ ...current, status: "进行中" }));

      try {
        const result = await runWorkerCommand(worker, config, task, project);
        appendWorkerLog(worker.id, `${worker.label} -> ${task.title}\nstdout: ${result.stdout || "(empty)"}\nstderr: ${result.stderr || "(empty)"}`);

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
        appendWorkerLog(worker.id, `${worker.label} -> ${task.title}\nerror: ${String(error)}`);
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
      "## 检查清单",
      "- [ ] 核心功能通过",
      "- [ ] 回归验证通过",
      "",
      "## 任务"
    ];

    for (const task of candidateTasks) {
      lines.push(`- ${task.title} (${task.status})`);
    }

    if (candidateTasks.length === 0) {
      lines.push("- 当前无候选任务。");
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
    <div className="shell">
      {isTauri ? (
        <>
          <div className="drag-strip" data-tauri-drag-region />
          <div className="window-controls">
            <button className="icon-button" onClick={() => void minimizeWindow()} aria-label="最小化">
              <Icon icon="mingcute:minus-line" />
            </button>
            <button className="icon-button" onClick={() => void toggleWindowMaximize()} aria-label="全屏">
              <Icon icon="mingcute:square-line" />
            </button>
            <button className="icon-button danger" onClick={() => void closeWindow()} aria-label="关闭">
              <Icon icon="mingcute:close-line" />
            </button>
          </div>
        </>
      ) : null}

      <aside className="sidebar">
        <div className="sidebar-main">
          <h1>
            <Icon icon="mingcute:leaf-3-line" />
            Maple
          </h1>
          <p className="subtitle">项目工作台</p>

          <nav>
            <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>
              <Icon icon="mingcute:home-4-line" />
              概览
            </button>
            <button className={view === "board" ? "active" : ""} onClick={() => setView("board")}>
              <Icon icon="mingcute:tree-line" />
              看板
            </button>
            <button className={view === "progress" ? "active" : ""} onClick={() => setView("progress")}>
              <Icon icon="mingcute:chart-bar-line" />
              进度
            </button>
          </nav>

          <section className="project-tree">
            <header>
              <Icon icon="mingcute:folder-2-line" />
              <strong>项目目录树</strong>
            </header>
            <ul className="tree-list">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    className={project.id === boardProjectId ? "tree-node active" : "tree-node"}
                    onClick={() => {
                      setView("board");
                      setBoardProjectId(project.id);
                      setSelectedTaskId(null);
                    }}
                  >
                    <Icon icon="mingcute:folder-open-line" />
                    <span>{project.name}</span>
                    <small>{project.version}</small>
                  </button>
                </li>
              ))}
            </ul>
            <div className="tree-tools">
              <button onClick={() => void createProject()}>
                <Icon icon="mingcute:add-line" />
                新建项目
              </button>
              <button onClick={() => void importExistingProject()}>
                <Icon icon="mingcute:folder-transfer-line" />
                导入项目
              </button>
            </div>
          </section>
        </div>

        <div className="sidebar-footer">
          {notice ? <p className="notice">{notice}</p> : null}
        </div>
      </aside>

      <main className="content">
        {view === "overview" ? (
          <section>
            <h2>概览</h2>
            <div className="cards">
              <article>
                <h3>待处理任务</h3>
                <p>{metrics.pending}</p>
              </article>
              <article>
                <h3>忙碌 Worker</h3>
                <p>{metrics.busyWorkers}</p>
              </article>
              <article>
                <h3>项目数量</h3>
                <p>{metrics.projectCount}</p>
              </article>
            </div>

            <div className="panel">
              <h3>
                <Icon icon="mingcute:plug-2-line" />
                MCP Server
              </h3>
              <p className="hint">
                状态：{mcpStatus.running ? `运行中（PID ${mcpStatus.pid ?? "?"}）` : "未运行"}
                {mcpStatus.command ? ` | ${mcpStatus.command}` : ""}
              </p>
            </div>
          </section>
        ) : null}

        {view === "board" ? (
          <section>
            <h2>看板</h2>
            {!boardProject ? (
              <div className="panel">
                <h3>请选择项目</h3>
                <p className="hint">从左侧目录树选择一个项目进入任务表。</p>
              </div>
            ) : (
              <>
                <header className="board-header">
                  <div>
                    <h3>{boardProject.name}</h3>
                    <p>版本：{boardProject.version}</p>
                    <p>目录：{boardProject.directory}</p>
                  </div>
                  <div className="row-actions">
                    <button onClick={() => addTask(boardProject.id)}>
                      <Icon icon="mingcute:add-line" />
                      新建任务
                    </button>
                    <button onClick={() => void completePending(boardProject.id)}>
                      <Icon icon="mingcute:check-circle-line" />
                      完成待办
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
                </header>

                <div className={detailMode === "sidebar" ? "board-layout with-side" : "board-layout"}>
                  <div className="panel board-main">
                    <table>
                      <thead>
                        <tr>
                          <th>任务</th>
                          <th>状态</th>
                          <th>提及</th>
                          <th>标签</th>
                          <th>版本</th>
                        </tr>
                      </thead>
                      <tbody>
                        {boardProject.tasks.map((task) => (
                          <tr key={task.id}>
                            <td>
                              <button className={task.id === selectedTaskId ? "task-link active" : "task-link"} onClick={() => setSelectedTaskId(task.id)}>
                                {task.title}
                              </button>
                            </td>
                            <td>{task.status}</td>
                            <td>{task.reports.length}</td>
                            <td>{task.tags.join(", ")}</td>
                            <td>{task.version}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {detailMode === "sidebar" && selectedTask ? (
                    <aside className="panel board-side">
                      <TaskDetailPanel task={selectedTask} />
                    </aside>
                  ) : null}
                </div>

                {releaseReport ? (
                  <div className="panel release-panel">
                    <h3>版本草稿</h3>
                    <textarea value={releaseReport} readOnly rows={14} />
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {view === "progress" ? (
          <section>
            <h2>进度</h2>
            <div className="panel">
              <h3>
                <Icon icon="mingcute:plug-2-line" />
                MCP Server
              </h3>
              <div className="stack-input">
                <input
                  value={mcpConfig.executable}
                  onChange={(event) => setMcpConfig((previous) => ({ ...previous, executable: event.target.value }))}
                  placeholder="启动命令（例如：npx）"
                />
                <input
                  value={mcpConfig.args}
                  onChange={(event) => setMcpConfig((previous) => ({ ...previous, args: event.target.value }))}
                  placeholder="启动参数（例如：-y @modelcontextprotocol/server-filesystem .）"
                />
                <input
                  value={mcpConfig.cwd}
                  onChange={(event) => setMcpConfig((previous) => ({ ...previous, cwd: event.target.value }))}
                  placeholder="工作目录（可选）"
                />
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={mcpConfig.autoStart}
                    onChange={(event) => setMcpConfig((previous) => ({ ...previous, autoStart: event.target.checked }))}
                  />
                  启动 Maple 时自动拉起 MCP Server
                </label>
              </div>
              <div className="row-actions">
                <button onClick={() => void startMcpServer()}>
                  <Icon icon="mingcute:play-circle-line" />
                  启动
                </button>
                <button onClick={() => void stopMcpServer()}>
                  <Icon icon="mingcute:stop-circle-line" />
                  停止
                </button>
                <button onClick={() => void refreshMcpStatus()}>
                  <Icon icon="mingcute:refresh-2-line" />
                  刷新状态
                </button>
              </div>
              <p className="hint">
                当前状态：{mcpStatus.running ? `运行中（PID ${mcpStatus.pid ?? "?"}）` : "未运行"}
                {mcpStatus.command ? ` | ${mcpStatus.command}` : ""}
              </p>
            </div>

            <div className="panel">
              <h3>
                <Icon icon="mingcute:ai-line" />
                Worker 接入
              </h3>
              <table>
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
                        <td>{worker.label}</td>
                        <td>{worker.busy ? "忙碌" : "空闲"}</td>
                        <td>{boundProject?.name ?? "-"}</td>
                        <td>
                          <div className="stack-input">
                            <input
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
                          <button onClick={() => void probeWorker(worker)}>
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

            <div className="panel">
              <h3>Worker 日志</h3>
              {workers.map((worker) => (
                <details key={worker.id}>
                  <summary>{worker.label}</summary>
                  <pre>{workerLogs[worker.id] || "暂无日志"}</pre>
                </details>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      {pickerForProject ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>选择 Worker</h3>
            <p>绑定后会执行当前项目的待办任务。</p>
            <div className="row-actions">
              {workers.map((worker) => (
                <button
                  key={worker.id}
                  onClick={async () => {
                    bindWorker(pickerForProject, worker.id);
                    setPickerForProject(null);
                    await completePending(pickerForProject);
                  }}
                >
                  <Icon icon="mingcute:ai-line" />
                  {worker.label}
                </button>
              ))}
            </div>
            <button className="ghost" onClick={() => setPickerForProject(null)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {detailMode === "modal" && selectedTask ? (
        <div className="modal-backdrop">
          <div className="modal task-modal">
            <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTaskId(null)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

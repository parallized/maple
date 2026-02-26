import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect, useMemo, useRef, useState } from "react";

import { buildWorkerArchiveReport, createWorkerExecutionPrompt, resolveMcpDecision } from "@maple/worker-skills";

import { TopNav } from "./components/TopNav";
import { TaskDetailPanel } from "./components/TaskDetailPanel";
import { ToastLayer } from "./components/ToastLayer";
import { WorkerPickerModal } from "./components/WorkerPickerModal";
import { WorkerConsoleModal } from "./components/WorkerConsoleModal";
import ColorBends from "./components/reactbits/ColorBends";
import { OverviewView } from "./views/OverviewView";
import { BoardView } from "./views/BoardView";
import { SettingsView } from "./views/SettingsView";

import {
  DEFAULT_WORKER_CONFIGS,
  STORAGE_AI_LANGUAGE,
  STORAGE_EDITOR_APP,
  STORAGE_PROJECTS,
  STORAGE_THEME,
  STORAGE_UI_LANGUAGE,
  WORKER_KINDS
} from "./lib/constants";
import type { AiLanguage, ExternalEditorApp, ThemeMode, UiLanguage } from "./lib/constants";
import {
  hasTauriRuntime,
  applyTheme,
  bumpPatch,
  parseArgs,
  deriveProjectName,
  createTask,
  createTaskReport,
  normalizeProjects
} from "./lib/utils";
import { windowsPathToWslMntPath } from "./lib/wsl-path";
import { collectTokenUsage } from "./lib/token-usage";
import { generatePrStyleTags } from "./lib/pr-tags";
import { buildVersionTag, mergeTaskTags } from "./lib/task-tags";
import { normalizeTagsForAiLanguage } from "./lib/tag-language";
import { buildWorkerId, isWorkerKindId, parseWorkerId } from "./lib/worker-ids";
import { loadAiLanguage, loadExternalEditorApp, loadProjects, loadTheme, loadUiLanguage } from "./lib/storage";
import { buildTrayTaskSnapshot } from "./lib/task-tray";
import { buildTrayTaskPalette } from "./lib/tray-palette";
import { normalizeTagCatalog } from "./lib/tag-catalog";


import type {
  DetailMode,
  McpTaskUpdatedEvent,
  McpTagCatalogUpdatedEvent,
  McpWorkerFinishedEvent,
  McpServerStatus,
  Project,
  Task,
  ViewKey,
  WorkerCommandResult,
  WorkerConfig,
  WorkerDoneEvent,
  WorkerKind,
  WorkerLogEvent,
} from "./domain";
import type { WorkerProbe } from "./components/WorkerConfigCard";
import type { InstallTargetId } from "./lib/install-targets";

function areTagListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type WorkerRuntime = "unknown" | "native" | "wsl" | "missing";

export function App() {
  const isTauri = hasTauriRuntime();
  const isWindows = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");

  // ── Core State ──
  const [view, setView] = useState<ViewKey>("overview");
  const [projects, setProjects] = useState<Project[]>(() => isTauri ? normalizeProjects([]) : loadProjects());
  const [stateBootstrapped, setStateBootstrapped] = useState(() => !isTauri);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => loadUiLanguage());
  const [aiLanguage, setAiLanguage] = useState<AiLanguage>(() => loadAiLanguage());
  const [externalEditorApp, setExternalEditorApp] = useState<ExternalEditorApp>(() => loadExternalEditorApp());
  const [workerConfigs, setWorkerConfigs] = useState<Record<WorkerKind, WorkerConfig>>(() => cloneDefaultWorkerConfigs());
  const [workerRuntimeByKind, setWorkerRuntimeByKind] = useState<Record<WorkerKind, WorkerRuntime>>(() => ({
    claude: "unknown",
    codex: "unknown",
    iflow: "unknown",
  }));
  const [installProbes, setInstallProbes] = useState<Partial<Record<InstallTargetId, WorkerProbe>>>({});
  const [installProbeToken, setInstallProbeToken] = useState(0);
  const [mcpStatus, setMcpStatus] = useState<McpServerStatus>({ running: false, pid: null, command: "" });
  const [mcpStartupError, setMcpStartupError] = useState("");
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null);
  const [pickerForProject, setPickerForProject] = useState<string | null>(null);
  const [workerLogs, setWorkerLogs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>("");
  const [detailMode, setDetailMode] = useState<DetailMode>("sidebar");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [workerConsoleOpen, setWorkerConsoleOpen] = useState(false);
  const [workerConsoleWorkerId, setWorkerConsoleWorkerId] = useState<string>(() => buildWorkerId(WORKER_KINDS[0]?.kind ?? "claude"));
  const [executingWorkers, setExecutingWorkers] = useState<Set<string>>(() => new Set());
  const [permissionPrompt, setPermissionPrompt] = useState<{ workerId: string; question: string } | null>(null);
  const [theme, setThemeState] = useState<ThemeMode>(() => loadTheme());
  const [windowMaximized, setWindowMaximized] = useState(false);
  const workerLogsRef = useRef<Record<string, string>>({});
  const projectsRef = useRef<Project[]>(projects);
  const doneProjectIdsRef = useRef<Set<string>>(new Set());
  const doneProjectInitRef = useRef(false);

  // ── Derived ──
  const effectiveAiLanguage = aiLanguage === "follow_ui" ? uiLanguage : aiLanguage;
  const boardProject = boardProjectId ? projects.find((p) => p.id === boardProjectId) ?? null : null;
  const currentWorkerLog = workerConsoleWorkerId ? workerLogs[workerConsoleWorkerId] ?? "" : "";

  useEffect(() => {
    setProjects((prev) => {
      let changed = false;
      const next = prev.map((project) => {
        let projectChanged = false;
        const nextCatalog = normalizeTagCatalog(project.tagCatalog);

        const tasks = project.tasks.map((task) => {
          const localizedTags = normalizeTagsForAiLanguage({
            tags: task.tags,
            language: effectiveAiLanguage,
            tagCatalog: nextCatalog,
            max: 6
          });

          // Never drop raw tags during language normalization.
          const normalizedTags: string[] = [];
          const seen = new Set<string>();
          for (const tag of localizedTags) {
            const trimmed = tag.trim();
            if (!trimmed) continue;
            const key = trimmed.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            normalizedTags.push(trimmed);
          }
          for (const tag of task.tags) {
            const trimmed = tag.trim();
            if (!trimmed) continue;
            const key = trimmed.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            normalizedTags.push(trimmed);
            if (normalizedTags.length >= 6) break;
          }

          if (areTagListsEqual(task.tags, normalizedTags)) return task;
          projectChanged = true;
          return { ...task, tags: normalizedTags };
        });

        if (!projectChanged) return project;
        changed = true;
        return { ...project, tasks, tagCatalog: nextCatalog };
      });
      return changed ? next : prev;
    });
  }, [effectiveAiLanguage]);

  const metrics = useMemo(() => {
    const allTasks = projects.flatMap((p) => p.tasks);
    const pending = allTasks.filter((t) => t.status !== "已完成").length;
    const completedCount = allTasks.filter((t) => t.status === "已完成").length;
    const inProgressCount = allTasks.filter((t) => t.status === "进行中" || t.status === "队列中").length;
    const runningCount = executingWorkers.size;
    
    const statusDistribution: Record<string, number> = {};
    allTasks.forEach(t => {
      statusDistribution[t.status] = (statusDistribution[t.status] || 0) + 1;
    });

    return { 
      pending, 
      completedCount, 
      inProgressCount, 
      runningCount, 
      projectCount: projects.length,
      allCount: allTasks.length,
      statusDistribution
    };
  }, [projects, executingWorkers]);

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

  // ── Install target probing ──
  async function probeInstallTargets() {
    if (!isTauri) return;
    try {
      const probes = await invoke<WorkerProbe[]>("probe_install_targets");
      const byId: Partial<Record<InstallTargetId, WorkerProbe>> = {};
      for (const probe of probes) {
        byId[probe.id] = probe;
      }
      setInstallProbes(byId);
    } catch {
      // silently ignore
    }
  }

  useEffect(() => {
    void probeInstallTargets();
  }, [isTauri, installProbeToken]);

  type WorkerPoolMode = "task";
  type WorkerPoolEntry = { workerId: string; workerLabel: string; projectName: string; mode: WorkerPoolMode; kind: WorkerKind | null };

  const workerPool = useMemo<WorkerPoolEntry[]>(() => {
    const entries: WorkerPoolEntry[] = [];
    const activeWorkerIds = [...executingWorkers];

    for (const kindEntry of WORKER_KINDS) {
      const matchingProjects = projects
        .filter((project) => project.workerKind === kindEntry.kind)
        .sort((a, b) => a.name.localeCompare(b.name));

      let activeIndex = 0;
      for (const project of matchingProjects) {
        const workerId = buildWorkerId(kindEntry.kind, project.id);
        const executing = executingWorkers.has(workerId);
        if (!executing) continue;
        activeIndex += 1;
        const mode: WorkerPoolMode = "task";
        entries.push({
          workerId,
          workerLabel: `${kindEntry.label} ${activeIndex}`,
          projectName: project.name,
          mode,
          kind: kindEntry.kind
        });
      }
    }

    const knownWorkerIds = new Set(entries.map((entry) => entry.workerId));
    for (const workerId of activeWorkerIds) {
      if (knownWorkerIds.has(workerId)) continue;
      const parsed = parseWorkerId(workerId);
      const kindLabel = parsed.kind ? WORKER_KINDS.find((entry) => entry.kind === parsed.kind)?.label : null;
      const projectName = parsed.projectId ? projects.find((project) => project.id === parsed.projectId)?.name ?? "未绑定项目" : "未绑定项目";
      const mode: WorkerPoolMode = "task";
      entries.push({
        workerId,
        workerLabel: kindLabel ?? workerId,
        projectName,
        mode,
        kind: parsed.kind
      });
    }

    return entries;
  }, [projects, executingWorkers]);

  // ── Persistence ──
  useEffect(() => { applyTheme(theme); localStorage.setItem(STORAGE_THEME, theme); }, [theme]);
  useEffect(() => {
    if (isTauri) return;
    localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
  }, [isTauri, projects]);
  useEffect(() => { localStorage.setItem(STORAGE_UI_LANGUAGE, uiLanguage); }, [uiLanguage]);
  useEffect(() => { localStorage.setItem(STORAGE_AI_LANGUAGE, aiLanguage); }, [aiLanguage]);
  useEffect(() => { localStorage.setItem(STORAGE_EDITOR_APP, externalEditorApp); }, [externalEditorApp]);
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    invoke<string>("read_state_file")
      .then((raw) => {
        if (cancelled) return;
        const trimmed = raw.trim();
        if (!trimmed) return;
        const parsed = JSON.parse(trimmed) as Project[];
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        setProjects(normalizeProjects(parsed));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setStateBootstrapped(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isTauri) return;
    if (!stateBootstrapped) return;
    invoke("write_state_file", { json: JSON.stringify(projects) }).catch(() => {});
  }, [isTauri, stateBootstrapped, projects]);
  useEffect(() => {
    if (!isTauri) return;
    const palette = buildTrayTaskPalette();
    const snapshot = buildTrayTaskSnapshot(projects, palette);
    invoke("sync_tray_task_badge", { snapshot }).catch(() => {});
  }, [isTauri, projects, theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    workerLogsRef.current = workerLogs;
  }, [workerLogs]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    if (boardProjectId && !projects.some((p) => p.id === boardProjectId)) {
      setBoardProjectId(null);
      setSelectedTaskId(null);
    }
  }, [boardProjectId, projects]);

  useEffect(() => {
    if (!selectedTaskId) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      const panel = document.querySelector(".task-detail-panel");
      const activeElement = document.activeElement;
      if (panel && activeElement instanceof HTMLElement && panel.contains(activeElement)) {
        const isEditable =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement.isContentEditable;
        if (isEditable) {
          activeElement.blur();
          event.preventDefault();
          return;
        }
      }
      setSelectedTaskId(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTaskId]);

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
    void getCurrentWindow().isMaximized().then(setWindowMaximized).catch(() => undefined);

    let disposed = false;
    let resizeUnlisten: (() => void) | undefined;
    void getCurrentWindow().onResized(async () => {
      if (disposed) return;
      try {
        const maximized = await getCurrentWindow().isMaximized();
        setWindowMaximized(maximized);
      } catch { /* ignore */ }
    }).then((unlisten) => {
      if (disposed) { unlisten(); } else { resizeUnlisten = unlisten; }
    });
    return () => {
      disposed = true;
      resizeUnlisten?.();
    };
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
    void listen<McpTaskUpdatedEvent>("maple://task-updated", (event) => {
      const { projectName, task } = event.payload;
      const needle = projectName.trim().toLowerCase();
      if (!needle || !task?.id) return;
      setProjects((prev) => {
        let changed = false;
        const next = prev.map((project) => {
          const normalized = project.name.toLowerCase();
          const matches = normalized === needle || normalized.includes(needle);
          if (!matches) return project;
          const index = project.tasks.findIndex((item) => item.id === task.id);
          if (index < 0) return project;
          const tasks = [...project.tasks];
          const existing = tasks[index];
          const shouldMarkConfirm =
            existing.status !== "已完成" && task.status === "已完成";
          tasks[index] = {
            ...existing,
            ...task,
            needsConfirmation: shouldMarkConfirm
              ? true
              : existing.needsConfirmation,
          };
          changed = true;
          return { ...project, tasks };
        });
        return changed ? next : prev;
      });
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
    void listen<McpTagCatalogUpdatedEvent>("maple://tag-catalog-updated", (event) => {
      const { projectName, tagCatalog } = event.payload;
      const needle = projectName.trim().toLowerCase();
      if (!needle) return;
      setProjects((prev) => {
        let changed = false;
        const next = prev.map((project) => {
          const normalized = project.name.toLowerCase();
          const matches = normalized === needle || normalized.includes(needle);
          if (!matches) return project;
          changed = true;
          return { ...project, tagCatalog: normalizeTagCatalog(tagCatalog) };
        });
        return changed ? next : prev;
      });
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
    void listen<McpWorkerFinishedEvent>("maple://worker-finished", (event) => {
      const { project, summary } = event.payload;
      const detail = summary.trim();
      setNotice(detail ? `项目「${project}」执行完成：${detail}` : `项目「${project}」执行完成。`);
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
      const parsed = parseWorkerId(workerId);
      const kindLabel = parsed.kind ? WORKER_KINDS.find((w) => w.kind === parsed.kind)?.label : null;
      const projectName = parsed.projectId ? projectsRef.current.find((p) => p.id === parsed.projectId)?.name : null;
      const label = kindLabel && projectName ? `${kindLabel} · ${projectName}` : kindLabel ?? workerId;
      appendWorkerLog(workerId, `\n[exit ${code ?? "?"}] ${success ? "完成" : "失败"}\n`);
      setNotice(`${label} 会话已结束（exit ${code ?? "?"}）`);
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

  // Prompt flag markers — the prompt arg is inserted right after this flag.
  const PROMPT_FLAG_BY_KIND: Record<WorkerKind, string> = {
    claude: "--print",
    codex: "e",
    iflow: "-p",
  };

  function buildWorkerRunPayload(
    workerId: string,
    config: WorkerConfig,
    task: Task,
    project: Project
  ): { args: string[]; prompt: string } {
    const kind = parseWorkerId(workerId).kind;
    const args = kind ? buildWorkerRunArgs(kind, config) : parseArgs(config.runArgs);
    const directoryForPrompt =
      kind && workerRuntimeByKind[kind] === "wsl"
        ? windowsPathToWslMntPath(project.directory) ?? project.directory
        : project.directory;
    const promptText = [
      createWorkerExecutionPrompt({
        projectName: project.name,
        directory: directoryForPrompt,
        taskTitle: task.title
      }),
      effectiveAiLanguage === "en"
        ? "You must output `mcp_decision.tags` in English only. No Chinese tags and no mixed-language fallback."
        : "你必须仅使用中文输出 `mcp_decision.tags`，禁止英文或中英混写标签，不允许任何兜底。"
    ].join("\n\n");

    // Insert prompt into CLI args after the prompt flag (e.g. --print, e, -p).
    // If the flag isn't found, fall back to stdin piping (backward compat).
    if (kind) {
      const flag = PROMPT_FLAG_BY_KIND[kind];
      if (flag) {
        const flagIndex = args.indexOf(flag);
        if (flagIndex >= 0) {
          args.splice(flagIndex + 1, 0, promptText);
          return { args, prompt: "" };
        }
      }
    }

    return { args, prompt: promptText };
  }

  function isLikelyWindowsCliNotFound(result: WorkerCommandResult): boolean {
    if (result.code === 9009) return true;
    const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
    return message.includes("not recognized")
      || message.includes("系统找不到")
      || message.includes("找不到")
      || message.includes("no such file")
      || message.includes("not found");
  }

  function isLikelyWslCliNotFound(result: WorkerCommandResult): boolean {
    if (result.code === 9009) return true; // wsl.exe not found
    if (result.code === 127) return true;
    const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
    return message.includes("command not found") || message.includes("not found");
  }

  async function resolveWorkerRuntime(kind: WorkerKind, config: WorkerConfig): Promise<WorkerRuntime> {
    const existing = workerRuntimeByKind[kind];
    if (existing !== "unknown") return existing;
    if (!isTauri) return "missing";

    const probeArgs = (() => {
      const parsed = parseArgs(config.probeArgs);
      return parsed.length > 0 ? parsed : ["--version"];
    })();

    try {
      const nativeProbe = await invoke<WorkerCommandResult>("probe_worker", { executable: config.executable, args: probeArgs, cwd: "" });
      if (nativeProbe.success || !isLikelyWindowsCliNotFound(nativeProbe) || !isWindows) {
        setWorkerRuntimeByKind((prev) => ({ ...prev, [kind]: "native" }));
        return "native";
      }
    } catch (error) {
      if (!isWindows) {
        setWorkerRuntimeByKind((prev) => ({ ...prev, [kind]: "native" }));
        return "native";
      }
      const message = String(error).toLowerCase();
      const notFound =
        message.includes("not found")
        || message.includes("系统找不到")
        || message.includes("找不到")
        || message.includes("os error 2");
      if (!notFound) {
        setWorkerRuntimeByKind((prev) => ({ ...prev, [kind]: "native" }));
        return "native";
      }
    }

    if (!isWindows) {
      setWorkerRuntimeByKind((prev) => ({ ...prev, [kind]: "missing" }));
      return "missing";
    }

    try {
      // Use "bash -lic" to source ~/.bashrc so that nvm-managed binaries are on PATH.
      const probeCommand = [config.executable, ...probeArgs].map(quoteShellArg).join(" ");
      const wslProbeArgs = ["-e", "bash", "-lic", probeCommand];
      const wslProbe = await invoke<WorkerCommandResult>("probe_worker", { executable: "wsl", args: wslProbeArgs, cwd: "" });
      if (wslProbe.success || !isLikelyWslCliNotFound(wslProbe)) {
        setWorkerRuntimeByKind((prev) => ({ ...prev, [kind]: "wsl" }));
        return "wsl";
      }
    } catch (error) {
      console.warn("WSL probe failed:", error);
    }

    setWorkerRuntimeByKind((prev) => ({ ...prev, [kind]: "missing" }));
    return "missing";
  }

  function buildWslRunArgs(cliExecutable: string, cliArgs: string[], windowsCwd: string): string[] | null {
    const wslCwd = windowsPathToWslMntPath(windowsCwd);
    if (!wslCwd) return null;
    // Use "bash -lic" instead of "sh -lc" so that ~/.bashrc is sourced
    // (nvm and other version managers are configured there, not ~/.profile).
    const command = `cd ${quoteShellArg(wslCwd)} && exec ${[cliExecutable, ...cliArgs].map(quoteShellArg).join(" ")}`;
    return ["-e", "bash", "-lic", command];
  }

  // ── Task CRUD ──
  function updateTask(
    projectId: string,
    taskId: string,
    updater: (task: Task) => Task,
    options?: { touchUpdatedAt?: boolean }
  ) {
    const now = new Date().toISOString();
    const touchUpdatedAt = options?.touchUpdatedAt ?? true;
    setProjects((prev) =>
      prev.map((p) => p.id !== projectId ? p : {
        ...p,
        tasks: p.tasks.map((t) =>
          t.id !== taskId
            ? t
            : { ...updater(t), updatedAt: touchUpdatedAt ? now : t.updatedAt }
        )
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

  function addDraftTask(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const newTask = createTask("", project.version, "草稿");
    setProjects((prev) => prev.map((p) => p.id !== projectId ? p : { ...p, tasks: [newTask, ...p.tasks] }));
    setEditingTaskId(newTask.id);
  }

  function selectTask(taskId: string | null) {
    setSelectedTaskId(taskId);
    if (!taskId || !boardProjectId) return;
    const project = projectsRef.current.find((p) => p.id === boardProjectId);
    const task = project?.tasks.find((t) => t.id === taskId);
    if (!project || !task?.needsConfirmation) return;
    updateTask(project.id, taskId, (t) => ({ ...t, needsConfirmation: false }), { touchUpdatedAt: false });
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

  function createUnifiedMcpStatus(): McpServerStatus {
    return { running: true, pid: null, command: "Maple MCP" };
  }

  function cloneDefaultWorkerConfigs(): Record<WorkerKind, WorkerConfig> {
    return WORKER_KINDS.reduce((acc, item) => {
      acc[item.kind] = { ...DEFAULT_WORKER_CONFIGS[item.kind] };
      return acc;
    }, {} as Record<WorkerKind, WorkerConfig>);
  }

  function openWorkerConsole(preferredKind?: WorkerKind, options?: { requireActive?: boolean; projectId?: string | null }) {
    const requireActive = options?.requireActive ?? false;
    const activeWorkerIds = [...executingWorkers];

    const preferredProjectId = options?.projectId ?? null;
    const preferredWorkerId = preferredKind && preferredProjectId ? buildWorkerId(preferredKind, preferredProjectId) : null;
    if (requireActive && preferredWorkerId && !activeWorkerIds.includes(preferredWorkerId)) {
      setNotice("该项目当前没有正在工作的 Worker 实例，无法打开控制台。");
      return;
    }

    const fallbackWorkerId =
      (preferredWorkerId && (!requireActive || activeWorkerIds.includes(preferredWorkerId)) ? preferredWorkerId : null)
      ?? (preferredKind ? activeWorkerIds.find((workerId) => isWorkerKindId(workerId, preferredKind)) ?? null : null)
      ?? activeWorkerIds[0]
      ?? (boardProject?.workerKind ? buildWorkerId(boardProject.workerKind, boardProject.id) : null)
      ?? (() => {
        const first = projects.find((project) => project.workerKind);
        return first?.workerKind ? buildWorkerId(first.workerKind, first.id) : null;
      })()
      ?? buildWorkerId(preferredKind ?? WORKER_KINDS[0]?.kind ?? "claude");

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
    const project: Project = {
      id,
      name: deriveProjectName(directory),
      version: "0.1.0",
      directory,
      tasks: [],
      tagCatalog: {}
    };
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

  function reorderProjects(nextProjectIds: string[]) {
    setProjects((prev) => {
      if (nextProjectIds.length !== prev.length) {
        return prev;
      }
      const projectById = new Map(prev.map((project) => [project.id, project]));
      const reordered: Project[] = [];
      for (const projectId of nextProjectIds) {
        const project = projectById.get(projectId);
        if (!project) return prev;
        reordered.push(project);
      }
      return reordered;
    });
  }

  // ── MCP Guard ──
  async function ensureMcpRunning(): Promise<boolean> {
    if (!isTauri) return true;
    setMcpStatus(createUnifiedMcpStatus());
    return true;
  }

  // ── Worker Execution ──
  async function runWorkerCommand(
    runtime: WorkerRuntime,
    workerId: string,
    config: WorkerConfig,
    task: Task,
    project: Project,
    payload?: { args: string[]; prompt: string }
  ): Promise<WorkerCommandResult> {
    if (!isTauri) return { success: false, code: null, stdout: "", stderr: "当前环境无法执行 Worker CLI。" };
    const runPayload = payload ?? buildWorkerRunPayload(workerId, config, task, project);
    if (runtime === "wsl") {
      if (!isWindows) return { success: false, code: null, stdout: "", stderr: "当前平台不支持 WSL 执行。" };
      const wslArgs = buildWslRunArgs(config.executable, runPayload.args, project.directory);
      if (!wslArgs) {
        return { success: false, code: null, stdout: "", stderr: `无法将项目目录转换为 WSL 路径：${project.directory}` };
      }
      return invoke<WorkerCommandResult>("run_worker", {
        workerId,
        taskTitle: task.title,
        executable: "wsl",
        args: wslArgs,
        prompt: runPayload.prompt,
        cwd: project.directory
      });
    }
    return invoke<WorkerCommandResult>("run_worker", {
      workerId,
      taskTitle: task.title,
      executable: config.executable,
      args: runPayload.args,
      prompt: runPayload.prompt,
      cwd: project.directory
    });
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

    const runtime = await resolveWorkerRuntime(kind, config);
    if (runtime === "missing") {
      setNotice(`${label} CLI 未检测到，请先安装或配置（Windows/WSL）。`);
      return;
    }
    if (runtime === "wsl" && !windowsPathToWslMntPath(project.directory)) {
      setNotice(`项目目录无法转换为 WSL 路径，请使用 Windows 盘符目录：${project.directory}`);
      return;
    }

    const pendingTasks = project.tasks.filter((t) => t.status === "待办" || t.status === "待返工");
    if (pendingTasks.length === 0) { setNotice("目前没有更多待办"); return; }
    setProjects((prev) => {
      const now = new Date().toISOString();
      return prev.map((item) => item.id !== project.id ? item : {
        ...item,
        tasks: item.tasks.map((task) => (
          task.status === "待办" || task.status === "待返工"
            ? { ...task, status: "队列中", updatedAt: now }
            : task
        ))
      });
    });
    const nextVersion = bumpPatch(project.version);
    const workerId = buildWorkerId(kind, project.id);
    setExecutingWorkers((prev) => {
      const next = new Set(prev);
      next.add(workerId);
      return next;
    });
    try {
      for (const task of pendingTasks) {
        // Check if user deleted this task while worker was running
        const currentProject = projectsRef.current.find((p) => p.id === projectId);
        if (!currentProject || !currentProject.tasks.some((t) => t.id === task.id)) {
          const hasActive = currentProject?.tasks.some((t) => t.status === "队列中" || t.status === "进行中");
          if (!hasActive) {
            appendWorkerLog(workerId, "\n[中止] 已无队列中或进行中的任务，终止 Worker。\n");
            break;
          }
          continue;
        }
        try {
          const payload = buildWorkerRunPayload(workerId, config, task, project);
          const wslArgs = runtime === "wsl" ? buildWslRunArgs(config.executable, payload.args, project.directory) : null;
          const commandExecutable = runtime === "wsl" ? "wsl" : config.executable;
          const commandArgs = runtime === "wsl" ? (wslArgs ?? ["-e", config.executable, ...payload.args]) : payload.args;
          appendWorkerLog(workerId, `\n$ ${formatCommandForLog(commandExecutable, commandArgs)}\n`);
          const beforeLen = workerLogsRef.current[workerId]?.length ?? 0;
          const result = await runWorkerCommand(runtime, workerId, config, task, project, payload);
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
          const localizedDecisionTags = normalizeTagsForAiLanguage({
            tags: decision.tags,
            language: effectiveAiLanguage,
            tagCatalog: project.tagCatalog,
            max: 5
          });
          const generatedTags = generatePrStyleTags({
            title: task.title,
            status: decision.status,
            decisionTags: localizedDecisionTags,
            reportContent: report.content,
            language: effectiveAiLanguage
          });
          const workerAndSystemTags = [...localizedDecisionTags, ...generatedTags];

          updateTask(project.id, task.id, (c) => ({
            ...c,
            status: decision.status,
            needsConfirmation: decision.status === "已完成" ? true : c.needsConfirmation,
            tags: mergeTaskTags({
              existing: c.tags,
              generated: workerAndSystemTags,
              versionTag: decision.status === "已完成" ? buildVersionTag(nextVersion) : null,
              max: 6
            }),
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
    }
  }

  async function answerPermission(workerId: string, answer: string) {
    setPermissionPrompt(null);
    if (!isTauri) return;
    appendWorkerLog(workerId, `> ${answer}\n`);
    try { await invoke<boolean>("send_worker_input", { workerId, input: answer, appendNewline: true }); }
    catch (error) { appendWorkerLog(workerId, `\n${String(error)}\n`); }
  }

  // ── MCP Server ──
  async function refreshMcpStatus() {
    if (!isTauri) { setMcpStatus({ running: false, pid: null, command: "" }); return; }
    setMcpStatus(createUnifiedMcpStatus());
    setMcpStartupError("");
  }

  async function startMcpServer(silent = false) {
    setMcpStartupError("");
    if (!isTauri) {
      const msg = "当前环境无法启动 MCP Server。";
      setMcpStartupError(msg);
      if (!silent) setNotice(msg);
      return;
    }
    setMcpStatus(createUnifiedMcpStatus());
    if (!silent) setNotice("MCP Server 已就绪。");
  }

  async function stopMcpServer(silent = false) {
    setMcpStartupError("");
    if (!isTauri) {
      if (!silent) setNotice("当前环境无法停止 MCP Server。");
      return;
    }
    setMcpStatus(createUnifiedMcpStatus());
    if (!silent) setNotice("Maple MCP 为单实例服务，无需停止。");
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
    <div className={`app-root${windowMaximized ? " maximized" : ""}`}>
      <ColorBends
        className="app-bg"
        colors={["#f2723c", "#ff9a5c", "#1c1c1e", "#2c2c2e"]}
        speed={0.08}
        noise={0.06}
        scale={1.2}
        frequency={0.8}
        warpStrength={0.6}
        mouseInfluence={0.3}
        parallax={0.2}
        transparent={false}
      />
      <div className="shell">
        <TopNav
          isTauri={isTauri}
          windowMaximized={windowMaximized}
          view={view}
          projects={projects}
          boardProjectId={boardProjectId}
          runningCount={metrics.runningCount}
          inProgressCount={metrics.inProgressCount}
          workerConsoleOpen={workerConsoleOpen}
          uiLanguage={uiLanguage}
          onViewChange={setView}
          onProjectSelect={(id) => { setBoardProjectId(id); setView("board"); setSelectedTaskId(null); }}
          onReorderProjects={reorderProjects}
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
          <main className="flex-1 overflow-hidden flex flex-col relative bg-transparent">
            <AnimatePresence mode="wait">
              {view === "overview" ? (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="flex-1 overflow-hidden flex flex-col min-h-0"
                >
                  <OverviewView
                    uiLanguage={uiLanguage}
                    metrics={metrics}
                    mcpStatus={mcpStatus}
                    workerAvailability={workerAvailability}
                    installProbes={installProbes}
                    workerPool={workerPool}
                    onRefreshMcp={() => void refreshMcpStatus()}
                  />
                </motion.div>
              ) : null}

              {view === "board" ? (
                <motion.div
                  key="board"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="flex-1 overflow-hidden flex flex-col min-h-0"
                >
                  <BoardView
                    boardProject={boardProject}
                    selectedTaskId={selectedTaskId}
                    editingTaskId={editingTaskId}
                    detailMode={detailMode}
                    externalEditorApp={externalEditorApp}
                    uiLanguage={uiLanguage}
                    tagLanguage={effectiveAiLanguage}
                    onAddTask={addTask}
                    onAddDraftTask={addDraftTask}
                    onCommitTaskTitle={commitTaskTitle}
                    onDeleteTask={deleteTask}
                    onSelectTask={selectTask}
                    onEditTask={setEditingTaskId}
                    onCompletePending={(id) => void completePending(id)}
                    onAssignWorkerKind={assignWorkerKind}
                    onSetDetailMode={setDetailMode}
                    onOpenConsole={() => openWorkerConsole(boardProject?.workerKind, { requireActive: true, projectId: boardProject?.id })}
                    onRemoveProject={removeProject}
                  />
                </motion.div>
              ) : null}

              {view === "progress" || view === "settings" ? (
                <motion.div
                  key="settings"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="flex-1 overflow-auto px-0.5"
                >
                  <SettingsView
                    mcpStatus={mcpStatus}
                    mcpStartupError={mcpStartupError}
                    detailMode={detailMode}
                    theme={theme}
                    uiLanguage={uiLanguage}
                    aiLanguage={aiLanguage}
                    externalEditorApp={externalEditorApp}
                    workerAvailability={workerAvailability}
                    installProbes={installProbes}
                    onRestartMcpServer={() => void restartMcpServer()}
                    onThemeChange={setThemeState}
                    onUiLanguageChange={setUiLanguage}
                    onAiLanguageChange={setAiLanguage}
                    onExternalEditorAppChange={setExternalEditorApp}
                    onDetailModeChange={setDetailMode}
                    onRefreshProbes={() => setInstallProbeToken((n) => n + 1)}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
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

        {workerConsoleOpen && (
          <WorkerConsoleModal
            workerConsoleWorkerId={workerConsoleWorkerId}
            currentWorkerLog={currentWorkerLog}
            executingWorkers={executingWorkers}
            workerPool={workerPool}
            theme={theme}
            onClose={() => setWorkerConsoleOpen(false)}
            onSelectWorker={(wId) => setWorkerConsoleWorkerId(wId)}
          />
        )}
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
	              tagLanguage={effectiveAiLanguage}
	              tagCatalog={boardProject.tagCatalog}
	              onClose={() => setSelectedTaskId(null)}
	              onUpdateTitle={(nextTitle) => updateTask(boardProject.id, selectedTaskId, (t) => ({ ...t, title: nextTitle }))}
	              onUpdateDetails={(nextDetails, nextDetailsDoc) => updateTask(boardProject.id, selectedTaskId, (t) => ({ ...t, details: nextDetails, detailsDoc: nextDetailsDoc }))}
	              onMarkAsDone={() => updateTask(boardProject.id, selectedTaskId, (t) => ({
	                ...t,
	                status: "已完成",
	                needsConfirmation: false,
	              }))}
	              onReworkToDraft={() => updateTask(boardProject.id, selectedTaskId, (t) => ({
	                ...t,
	                status: "草稿",
	                needsConfirmation: false,
	              }))}
	              onSetAsTodo={() => updateTask(boardProject.id, selectedTaskId, (t) => ({
	                ...t,
	                status: "待办",
	                needsConfirmation: false,
	              }))}
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
	                tagLanguage={effectiveAiLanguage}
	                tagCatalog={boardProject.tagCatalog}
	                onClose={() => setSelectedTaskId(null)}
	                onUpdateTitle={(nextTitle) => updateTask(boardProject.id, selectedTaskId, (t) => ({ ...t, title: nextTitle }))}
	                onUpdateDetails={(nextDetails, nextDetailsDoc) => updateTask(boardProject.id, selectedTaskId, (t) => ({ ...t, details: nextDetails, detailsDoc: nextDetailsDoc }))}
	                onMarkAsDone={() => updateTask(boardProject.id, selectedTaskId, (t) => ({
	                  ...t,
	                  status: "已完成",
	                  needsConfirmation: false,
	                }))}
	                onReworkToDraft={() => updateTask(boardProject.id, selectedTaskId, (t) => ({
	                  ...t,
	                  status: "草稿",
	                  needsConfirmation: false,
	                }))}
	                onSetAsTodo={() => updateTask(boardProject.id, selectedTaskId, (t) => ({
	                  ...t,
	                  status: "待办",
	                  needsConfirmation: false,
	                }))}
	                onDelete={() => deleteTask(boardProject.id, selectedTaskId)}
	              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

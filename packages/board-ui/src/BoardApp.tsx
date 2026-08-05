import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@iconify/react";
import { startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { buildWorkerArchiveReport, createWorkerExecutionPrompt } from "@maple/worker-skills";

import { AppSidebar } from "./components/AppSidebar";
import { TaskDetailPanel } from "./components/TaskDetailPanel";
import { ToastLayer } from "./components/ToastLayer";
import { WorkerConsoleModal } from "./components/WorkerConsoleModal";
import { AppBackground } from "./components/AppBackground";
import { OverviewView } from "./views/OverviewView";
import { BoardView } from "./views/BoardView";
import { SettingsView, type SettingsExtraTab } from "./views/SettingsView";

import {
  DEFAULT_BASE_WORKER,
  DEFAULT_WORKER_RETRY_CONFIG,
  DEFAULT_WORKER_CONFIGS,
  STORAGE_AI_LANGUAGE,
  STORAGE_BASE_WORKER,
  STORAGE_CONSTITUTION,
  STORAGE_LEADER_CONSTITUTION,
  STORAGE_EDITOR_APP,
  STORAGE_THEME,
  STORAGE_UI_FONT,
  STORAGE_UI_LANGUAGE,
  STORAGE_WORKER_RETRY_INTERVAL_SECONDS,
  STORAGE_WORKER_RETRY_MAX_ATTEMPTS,
  WORKER_KINDS
} from "./lib/constants";
import type { AiLanguage, ExternalEditorApp, ThemeMode, UiFont, UiLanguage, WorkerRetryConfig } from "./lib/constants";
import {
  applyTheme,
    parseArgs,
    createTask,
    createTaskReport,
    isTaskInFlight,
    normalizeProjects,
    sessionSid,
    taskWaitingKind
  } from "./lib/utils";
import { applyUiFont } from "./lib/ui-font";
import { collectTokenUsage } from "./lib/token-usage";
import { estimateTokenCostUsd, USD_TO_CNY_RATE } from "./lib/token-cost";
import { normalizeTagsForAiLanguage } from "./lib/tag-language";
import { buildWorkerId, isWorkerKindId, parseWorkerId } from "./lib/worker-ids";
import { buildSidebarWorkers } from "./lib/worker-sidebar";
import {
  loadAiLanguage,
  loadBaseWorker,
  loadConstitution,
  loadExternalEditorApp,
  loadLeaderConstitution,
  loadTheme,
  loadUiFont,
  loadUiLanguage,
  loadWorkerRetryConfig
} from "./lib/storage";
import { normalizeTagCatalog } from "./lib/tag-catalog";
import {
  REMINDER_AUDIO_MAX_BYTES,
  fileToReminderDataUrl,
  loadLocalReminderAudio,
  loadLocalReminderPlayCli,
  loadLocalReminderPlayMaple,
  removeLocalReminderAudio,
  saveLocalReminderAudio,
  saveLocalReminderPlayCli,
  saveLocalReminderPlayMaple
} from "./lib/reminder-storage";


import type {
  BoardDisplayType,
  DetailMode,
  McpTaskUpdatedEvent,
  McpTagCatalogUpdatedEvent,
  McpWorkerFinishedEvent,
  Project,
  RunnerSummary,
  Task,
  TaskStatus,
  ViewKey,
  WorkerCommandResult,
  WorkerConfig,
  WorkerDoneEvent,
  WorkerKind,
  WorkerLogEvent,
} from "./domain";
import type { BoardPlatform, ModelPriceQuote, WorkerProbe } from "./platform/types";
import { PlatformProvider } from "./platform/context";
import type { InstallTargetId } from "./lib/install-targets";

function areTagListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type WorkerRuntime = "unknown" | "native" | "missing";

type PromptPlacementStrategy = {
  flag: string;
  mode: "after_flag" | "append_tail";
};

const PROMPT_PLACEMENT_BY_KIND: Record<WorkerKind, PromptPlacementStrategy> = {
  claude: { flag: "--print", mode: "append_tail" },
  codex: { flag: "e", mode: "append_tail" },
  deepseek: { flag: "exec", mode: "append_tail" },
  kimi: { flag: "--prompt", mode: "after_flag" },
  glm: { flag: "run", mode: "append_tail" },
  iflow: { flag: "-p", mode: "after_flag" },
  gemini: { flag: "-p", mode: "after_flag" },
  opencode: { flag: "run", mode: "append_tail" },
};

const PERMISSION_OPTION_PATTERN = /\[(?:y\/n|Y\/n|y\/N)\]|\((?:yes\/no|y\/n)\)|\b(?:yes\/no|y\/n)\b/i;
const PERMISSION_QUESTION_PATTERN = /\b(?:allow|approve|permission|confirm|accept|continue|proceed)\b/i;
const PERMISSION_CODE_HINT_PATTERN = /(::|=>|;\s*$|\bfn\b|\bstruct\b|\bpub\b|\bconst\b|\bimport\b|\bexport\b)/i;
const INTERRUPTED_EXECUTION_REPORT = "执行已中断：Worker 被手动停止，相关任务已重置为待办。";

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeWorkerRetryConfig(input: WorkerRetryConfig): WorkerRetryConfig {
  return {
    intervalSeconds: clampInteger(input.intervalSeconds, 1, 600),
    maxAttempts: clampInteger(input.maxAttempts, 1, 20),
  };
}

function detectPermissionPromptLine(chunk: string): string | null {
  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!;
    if (line.length > 220) continue;
    if (PERMISSION_CODE_HINT_PATTERN.test(line)) continue;
    if (PERMISSION_OPTION_PATTERN.test(line)) return line;
    if (line.includes("?") && PERMISSION_QUESTION_PATTERN.test(line)) return line;
  }
  return null;
}

export type BoardAppProps = {
  platform: BoardPlatform;
  sidebarFooter?: ReactNode | ((actions: { openSettings: () => void }) => ReactNode);
  /** 平台层注入的额外设置页签(Web 端:账户 / 工作区 / 安全)。 */
  settingsExtraTabs?: SettingsExtraTab[];
  /** 应用版本号，由平台层注入，显示在侧栏最底部。 */
  version?: string;
  /** 点按侧栏品牌区回主页，仅 Web 端注入。 */
  onBrandClick?: () => void;
};

function mergeExternalProjects(prev: Project[], incoming: Project[], preserveTaskIds: ReadonlySet<string>): Project[] {
  const prevById = new Map(prev.map((project) => [project.id, project]));
  let changed = false;

  const next = incoming.map((incomingProject) => {
    const local = prevById.get(incomingProject.id);
    if (!local) {
      changed = true;
      return incomingProject;
    }

    const localTaskById = new Map(local.tasks.map((task) => [task.id, task]));
    const incomingTaskIds = new Set(incomingProject.tasks.map((task) => task.id));

    // 本地新建但尚未同步到远端的任务(被 preserve 且 incoming 中不存在)保留在 tasks 头部。
    const preservedLocalTasks = local.tasks.filter(
      (task) => preserveTaskIds.has(task.id) && !incomingTaskIds.has(task.id)
    );
    const mergedTasks = [
      ...preservedLocalTasks,
      ...incomingProject.tasks.map((incomingTask) => {
        const localTask = localTaskById.get(incomingTask.id);
        if (localTask && preserveTaskIds.has(incomingTask.id)) return localTask;
        if (!localTask) return incomingTask;
        // 任务刚变成「已完成」（且本地未确认过）→ 标记待确认，用于显示黄色感叹号；
        // 已确认过的保持已读状态，不被远端快照重置。
        const becameDone = localTask.status !== "已完成" && incomingTask.status === "已完成";
        const confirm = becameDone ? true : (localTask.needsConfirmation ?? false);
        return confirm ? { ...incomingTask, needsConfirmation: true } : incomingTask;
      })
    ];

    // 项目级字段以 incoming 为准;内容无变化时保留本地引用,避免多余渲染。
    const mergedProject: Project = { ...incomingProject, tasks: mergedTasks };
    if (JSON.stringify(local) === JSON.stringify(mergedProject)) return local;
    changed = true;
    return mergedProject;
  });

  if (changed) return next;
  if (next.length === prev.length && next.every((project, index) => project === prev[index])) return prev;
  return next;
}

export function BoardApp({ platform, sidebarFooter, settingsExtraTabs, version, onBrandClick }: BoardAppProps) {
  const { capabilities } = platform;
  const isTauri = capabilities.isDesktop;
  const isWindows = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");

  // ── Core State ──
  const [view, setView] = useState<ViewKey>("overview");
  const [projects, setProjects] = useState<Project[]>(() => normalizeProjects([]));
  const [stateBootstrapped, setStateBootstrapped] = useState(false);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() => isTauri ? loadUiLanguage() : "zh");
  const [aiLanguage, setAiLanguage] = useState<AiLanguage>(() => isTauri ? loadAiLanguage() : "follow_ui");
  const [externalEditorApp, setExternalEditorApp] = useState<ExternalEditorApp>(() => loadExternalEditorApp());
  const [constitution, setConstitution] = useState<string>(() => isTauri ? loadConstitution() : "");
  const [leaderConstitution, setLeaderConstitution] = useState<string>(() => isTauri ? loadLeaderConstitution() : "");
  const [workerConfigs, setWorkerConfigs] = useState<Record<WorkerKind, WorkerConfig>>(() => cloneDefaultWorkerConfigs());
  const [workerRuntimeByKind, setWorkerRuntimeByKind] = useState<Record<WorkerKind, WorkerRuntime>>(() =>
    WORKER_KINDS.reduce((acc, worker) => {
      acc[worker.kind] = "unknown";
      return acc;
    }, {} as Record<WorkerKind, WorkerRuntime>)
  );
  const [installProbes, setInstallProbes] = useState<Partial<Record<InstallTargetId, WorkerProbe>>>({});
  const [installProbeToken, setInstallProbeToken] = useState(0);
  const [runners, setRunners] = useState<RunnerSummary[]>([]);
  const [boardProjectId, setBoardProjectId] = useState<string | null>(null);
  const [workerLogs, setWorkerLogs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>("");
  const [detailMode, setDetailMode] = useState<DetailMode>("sidebar");
  const [boardDisplayType, setBoardDisplayType] = useState<BoardDisplayType>("list");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workerConsoleOpen, setWorkerConsoleOpen] = useState(false);
  const [workerConsoleWorkerId, setWorkerConsoleWorkerId] = useState<string>(() => buildWorkerId(WORKER_KINDS[0]?.kind ?? "claude"));
  const [executingWorkers, setExecutingWorkers] = useState<Set<string>>(() => new Set());
  const [permissionPrompt, setPermissionPrompt] = useState<{ workerId: string; question: string } | null>(null);
  const [workerRetryConfig, setWorkerRetryConfigState] = useState<WorkerRetryConfig>(() =>
    normalizeWorkerRetryConfig(isTauri ? loadWorkerRetryConfig() : DEFAULT_WORKER_RETRY_CONFIG)
  );
  const [workerConcurrency, setWorkerConcurrency] = useState(4);
  const [theme, setThemeState] = useState<ThemeMode>(() => isTauri ? loadTheme() : "system");
  const [uiFont, setUiFont] = useState<UiFont>(() => isTauri ? loadUiFont() : "chill-round");
  const [baseWorker, setBaseWorker] = useState<WorkerKind>(() => isTauri ? loadBaseWorker() : DEFAULT_BASE_WORKER);
  const [leaderWorker, setLeaderWorker] = useState<WorkerKind>(DEFAULT_BASE_WORKER);
  // 完成提醒：音频 URL / 名称 + CLI / Maple 两个播放开关（可全选、全不选或单选）。
  const [reminderAudioUrl, setReminderAudioUrl] = useState<string | null>(null);
  const [reminderAudioName, setReminderAudioName] = useState<string | null>(null);
  const [reminderPlayCli, setReminderPlayCli] = useState(false);
  const [reminderPlayMaple, setReminderPlayMaple] = useState(false);
  // 外部请求设置页切到指定页签(如看板 Leader 状态条 →「模型和工具」)。
  const [settingsTabRequest, setSettingsTabRequest] = useState<{ tab: string; nonce: number } | null>(null);

  function openSettingsTab(tab: string) {
    setSettingsTabRequest({ tab, nonce: Date.now() });
    setView("settings");
  }
  const [userPreferencesReady, setUserPreferencesReady] = useState(false);
  const [executionSettingsReady, setExecutionSettingsReady] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const workerLogsRef = useRef<Record<string, string>>({});
  const projectsRef = useRef<Project[]>(projects);
  const editingTaskIdRef = useRef<string | null>(editingTaskId);
  const taskMutationQueueRef = useRef<Record<string, Promise<void>>>({});
  const taskMutationVersionRef = useRef<Record<string, number>>({});
  const creatingTaskIdsRef = useRef<Set<string>>(new Set());
  const deletingTaskIdsRef = useRef<Set<string>>(new Set());
  const deletingProjectIdsRef = useRef<Set<string>>(new Set());
  const executingWorkersRef = useRef<Set<string>>(executingWorkers);
  const retryTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const retryAttemptRef = useRef<Record<string, number>>({});
  const permissionAnsweredAtRef = useRef<Record<string, number>>({});
  const doneProjectIdsRef = useRef<Set<string>>(new Set());
  const doneProjectInitRef = useRef(false);
  const activeWorkerRunIdRef = useRef<Record<string, string>>({});
  const interruptedWorkerRunIdsRef = useRef<Set<string>>(new Set());

  // ── Derived ──
  const effectiveAiLanguage = aiLanguage === "follow_ui" ? uiLanguage : aiLanguage;
  const boardProject = boardProjectId ? projects.find((p) => p.id === boardProjectId) ?? null : null;
  const currentWorkerLog = workerConsoleWorkerId ? workerLogs[workerConsoleWorkerId] ?? "" : "";
  const sidebarWorkers = useMemo(() => buildSidebarWorkers(runners), [runners]);
  // 侧栏只展示已获取模型配置的 Worker;未获取的仅在被任务指定时出现。
  const usedSidebarWorkerKinds = useMemo(
    () => new Set(projects.flatMap((project) => project.tasks.map((task) => task.workerKind))),
    [projects]
  );
  const visibleSidebarWorkers = useMemo(
    () => sidebarWorkers.filter(
      (worker) => worker.state === "online" || worker.state === "offline" || usedSidebarWorkerKinds.has(worker.kind)
    ),
    [sidebarWorkers, usedSidebarWorkerKinds]
  );

  // models.dev 定价快照：平台支持时加载一次，用于概览图表的成本估算。
  const [modelPricing, setModelPricing] = useState<ModelPriceQuote[]>([]);
  useEffect(() => {
    let cancelled = false;
    void platform.loadModelPricing?.()
      .then((items) => {
        if (!cancelled) setModelPricing(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [platform]);

  // Worker 类型 → 执行端上报的模型 id 列表，用于 models.dev 定价匹配。
  const modelIdsByKind = useMemo(() => {
    const map: Partial<Record<WorkerKind, string[]>> = {};
    for (const worker of sidebarWorkers) {
      if (worker.state !== "online" && worker.state !== "offline") continue;
      const ids = worker.title.split(" / ").map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) continue;
      const existing = map[worker.kind] ?? [];
      map[worker.kind] = [...new Set([...existing, ...ids])];
    }
    return map;
  }, [sidebarWorkers]);

  // ── 调试列：设置页开关，表格标签列右侧展示缓存率 / 总价 / SID ──
  const [debugColumnEnabled, setDebugColumnEnabled] = useState(() => {
    try {
      return localStorage.getItem("maple.debugColumn") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("maple.debugColumn", debugColumnEnabled ? "true" : "false");
    } catch {
      // 忽略存储失败。
    }
  }, [debugColumnEnabled]);

  const taskDebugMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const project of projects) {
      for (const task of project.tasks) {
        if (!task.usage) continue;
        const { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens } = task.usage;
        const totalInput = inputTokens + cachedInputTokens;
        const cacheRate = totalInput > 0 ? (cachedInputTokens / totalInput) * 100 : 0;
        const usd = estimateTokenCostUsd(
          [{ workerKind: task.workerKind, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }],
          modelPricing,
          modelIdsByKind
        );
        const priceYuan = usd === null ? null : usd * USD_TO_CNY_RATE;
        const sid = task.sessionId ? sessionSid(task.sessionId) : "—";
        map[task.id] =
          `缓存率 ${cacheRate.toFixed(1)}% 总价 ${priceYuan === null ? "—" : priceYuan.toFixed(3)} 元 SID ${sid}`;
      }
    }
    return map;
  }, [projects, modelPricing, modelIdsByKind]);

  /** 调试导出：逐个任务导出 title / 报告 / Token 消耗 / Leader 发起说明。 */
  function exportProjectDebug(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const lines: string[] = [];
    lines.push(`# 调试导出 · ${project.name}`);
    lines.push(`导出时间：${new Date().toLocaleString()}`);
    lines.push("");
    const taskLines = project.tasks.flatMap((task, index) => {
      const block: string[] = [];
      block.push(`## ${index + 1}. ${task.title}（${task.status}）`);
      block.push(`- Worker：${task.workerKind}`);
      const brief = task.dispatchBrief?.trim();
      block.push(`- Leader 发起说明：${brief || "无"}`);
      if (task.usage) {
        const { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens } = task.usage;
        const totalInput = inputTokens + cachedInputTokens;
        const cacheRate = totalInput > 0 ? (cachedInputTokens / totalInput) * 100 : 0;
        const usd = estimateTokenCostUsd(
          [{ workerKind: task.workerKind, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }],
          modelPricing,
          modelIdsByKind
        );
        const priceYuan = usd === null ? null : usd * USD_TO_CNY_RATE;
        const total = inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;
        block.push("- Token 消耗：");
        block.push(`  - 输入 ${inputTokens}（缓存命中 ${cachedInputTokens}，缓存率 ${cacheRate.toFixed(1)}%）`);
        block.push(`  - 输出 ${outputTokens}，推理输出 ${reasoningOutputTokens}，合计 ${total} token`);
        block.push(`  - 总价 ${priceYuan === null ? "—" : `${priceYuan.toFixed(4)} 元`}` +
          (task.sessionId ? `，SID ${sessionSid(task.sessionId)}` : ""));
      } else {
        block.push("- Token 消耗：无");
      }
      const reports = (task.reports ?? []).filter((report) => report.content.trim().length > 0);
      if (reports.length > 0) {
        block.push("- 报告：");
        for (const report of reports) {
          block.push(`  - [${report.author} · ${report.createdAt}]`);
          for (const line of report.content.split(/\r?\n/)) {
            block.push(`    ${line}`);
          }
        }
      } else {
        block.push("- 报告：无");
      }
      block.push("");
      return block;
    });
    lines.push(...taskLines);
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `调试导出-${project.name}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

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
    const inProgressCount = allTasks.filter((t) => isTaskInFlight(t)).length;
    const runningCount = executingWorkers.size;

    // 分布按「显示状态」分桶:规划中/排队阶段从原始 status 中拆出,与任务徽标口径一致。
    const statusDistribution: Record<string, number> = {};
    allTasks.forEach(t => {
      const key = t.executionPhase === "planning" ? "规划中" : t.executionPhase === "queued" ? "队列中" : t.status;
      statusDistribution[key] = (statusDistribution[key] || 0) + 1;
    });

    // 按项目聚合 token 用量（按 Worker 类型 × Leader/Worker 角色分桶），用于概览柱状图。
    const projectTokenUsage = projects
      .map((project) => {
        const byWorker: Partial<Record<WorkerKind, number>> = {};
        const byLeader: Partial<Record<WorkerKind, number>> = {};
        // 明细与成本按角色独立累计；hover 判定才是整柱共用。
        const emptyRole = () => ({
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0
        });
        const workerUsage = emptyRole();
        const leaderUsage = emptyRole();
        let total = 0;
        for (const bucket of project.tokenUsage ?? []) {
          const isLeader = bucket.agentRole === "leader";
          const target = isLeader ? byLeader : byWorker;
          const usage = isLeader ? leaderUsage : workerUsage;
          target[bucket.workerKind] = (target[bucket.workerKind] ?? 0) + bucket.totalTokens;
          total += bucket.totalTokens;
          usage.totalTokens += bucket.totalTokens;
          usage.inputTokens += bucket.inputTokens;
          usage.cachedInputTokens += bucket.cachedInputTokens;
          usage.outputTokens += bucket.outputTokens;
          usage.reasoningOutputTokens += bucket.reasoningOutputTokens;
        }
        const buckets = project.tokenUsage ?? [];
        return {
          projectId: project.id,
          name: project.name,
          totalTokens: total,
          byWorker,
          byLeader,
          worker: {
            ...workerUsage,
            costUsd: estimateTokenCostUsd(
              buckets.filter((bucket) => bucket.agentRole !== "leader"),
              modelPricing,
              modelIdsByKind
            )
          },
          leader: {
            ...leaderUsage,
            costUsd: estimateTokenCostUsd(
              buckets.filter((bucket) => bucket.agentRole === "leader"),
              modelPricing,
              modelIdsByKind
            )
          },
          taskCount: project.tasks.length
        };
      })
      .filter((entry) => entry.totalTokens > 0);

    return {
      pending,
      completedCount,
      inProgressCount,
      runningCount,
      projectCount: projects.length,
      allCount: allTasks.length,
      statusDistribution,
      projectTokenUsage
    };
  }, [projects, executingWorkers, modelPricing, modelIdsByKind]);

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
    try {
      const probes = await platform.probeInstallTargets();
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

  // ——— Worker runtime warm-up ———
  // Run probes in the background so the "execute pending" click stays snappy.
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    void (async () => {
      for (const entry of WORKER_KINDS) {
        if (cancelled) return;
        const config = workerConfigs[entry.kind];
        if (!config?.executable?.trim()) continue;
        try {
          await resolveWorkerRuntime(entry.kind, config);
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri, workerConfigs]);

  type WorkerPoolMode = "task";
  type WorkerPoolEntry = { workerId: string; workerLabel: string; projectName: string; mode: WorkerPoolMode; kind: WorkerKind | null };

  const workerPool = useMemo<WorkerPoolEntry[]>(() => {
    const entries: WorkerPoolEntry[] = [];
    const indexByKind = new Map<WorkerKind, number>();

    for (const workerId of executingWorkers) {
      const parsed = parseWorkerId(workerId);
      const kindEntry = parsed.kind ? WORKER_KINDS.find((entry) => entry.kind === parsed.kind) : null;
      const nextIndex = (parsed.kind ? indexByKind.get(parsed.kind) ?? 0 : 0) + 1;
      if (parsed.kind) indexByKind.set(parsed.kind, nextIndex);
      const projectName = parsed.projectId
        ? projects.find((project) => project.id === parsed.projectId)?.name ?? "未绑定项目"
        : "未绑定项目";
      entries.push({
        workerId,
        workerLabel: kindEntry ? `${kindEntry.label} ${nextIndex}` : workerId,
        projectName,
        mode: "task",
        kind: parsed.kind
      });
    }

    return entries;
  }, [projects, executingWorkers]);

  // ── Persistence ──
  useEffect(() => {
    applyTheme(theme);
    if (!platform.loadUserPreferences) localStorage.setItem(STORAGE_THEME, theme);
  }, [platform, theme]);
  useEffect(() => {
    applyUiFont(uiFont);
    if (!platform.loadUserPreferences) localStorage.setItem(STORAGE_UI_FONT, uiFont);
  }, [platform, uiFont]);
  useEffect(() => {
    if (!platform.loadExecutionSettings) localStorage.setItem(STORAGE_BASE_WORKER, baseWorker);
  }, [platform, baseWorker]);
  useEffect(() => {
    if (!platform.loadUserPreferences) localStorage.setItem(STORAGE_UI_LANGUAGE, uiLanguage);
  }, [platform, uiLanguage]);
  useEffect(() => {
    if (!platform.loadExecutionSettings) localStorage.setItem(STORAGE_AI_LANGUAGE, aiLanguage);
  }, [platform, aiLanguage]);
  useEffect(() => {
    if (isTauri) localStorage.setItem(STORAGE_EDITOR_APP, externalEditorApp);
  }, [isTauri, externalEditorApp]);
  useEffect(() => {
    if (!platform.loadExecutionSettings) localStorage.setItem(STORAGE_CONSTITUTION, constitution);
  }, [platform, constitution]);
  useEffect(() => {
    if (!platform.loadExecutionSettings) localStorage.setItem(STORAGE_LEADER_CONSTITUTION, leaderConstitution);
  }, [platform, leaderConstitution]);
  useEffect(() => {
    if (platform.loadExecutionSettings) return;
    localStorage.setItem(STORAGE_WORKER_RETRY_INTERVAL_SECONDS, String(workerRetryConfig.intervalSeconds));
    localStorage.setItem(STORAGE_WORKER_RETRY_MAX_ATTEMPTS, String(workerRetryConfig.maxAttempts));
  }, [platform, workerRetryConfig]);

  useEffect(() => {
    if (!platform.loadUserPreferences) {
      setUserPreferencesReady(true);
      return;
    }
    let cancelled = false;
    platform.loadUserPreferences()
      .then((preferences) => {
        if (cancelled) return;
        setThemeState(preferences.theme);
        setUiFont(preferences.uiFont);
        setUiLanguage(preferences.uiLanguage);
        setUserPreferencesReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [platform]);

  useEffect(() => {
    if (!platform.saveUserPreferences || !userPreferencesReady) return;
    void platform.saveUserPreferences({ theme, uiFont, uiLanguage }).catch(() => {});
  }, [platform, userPreferencesReady, theme, uiFont, uiLanguage]);

  useEffect(() => {
    if (!platform.loadExecutionSettings) {
      setExecutionSettingsReady(true);
      setReminderPlayCli(loadLocalReminderPlayCli());
      setReminderPlayMaple(loadLocalReminderPlayMaple());
      const localAudio = loadLocalReminderAudio();
      if (localAudio) {
        setReminderAudioUrl(localAudio.dataUrl);
        setReminderAudioName(localAudio.name);
      }
      let cancelled = false;
      platform.loadConstitution()
        .then((text) => {
          if (!cancelled && typeof text === "string") setConstitution(text);
        })
        .catch(() => {});
      platform.loadLeaderConstitution()
        .then((text) => {
          if (!cancelled && typeof text === "string") setLeaderConstitution(text);
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }
    let cancelled = false;
    platform.loadExecutionSettings()
      .then((settings) => {
        if (cancelled) return;
        setBaseWorker(settings.baseWorker);
        setLeaderWorker(settings.leaderWorker);
        setAiLanguage(settings.aiOutputLanguage);
        setConstitution(settings.constitution);
        setLeaderConstitution(settings.leaderConstitution);
        setWorkerRetryConfigState(normalizeWorkerRetryConfig({
          intervalSeconds: settings.retryIntervalSeconds,
          maxAttempts: settings.retryMaxAttempts
        }));
        setWorkerConcurrency(settings.concurrency);
        setReminderPlayCli(settings.reminderPlayCli ?? false);
        setReminderPlayMaple(settings.reminderPlayMaple ?? false);
        setReminderAudioName(settings.reminderAudioName ?? null);
        setExecutionSettingsReady(true);
      })
      .catch(() => {});
    if (platform.loadReminderAudio) {
      platform.loadReminderAudio()
        .then((url) => {
          if (!cancelled) setReminderAudioUrl(url);
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [platform]);

  useEffect(() => {
    if (!platform.saveExecutionSettings || !executionSettingsReady) return;
    void platform.saveExecutionSettings({
      baseWorker,
      leaderWorker,
      aiOutputLanguage: aiLanguage,
      constitution,
      leaderConstitution,
      retryIntervalSeconds: workerRetryConfig.intervalSeconds,
      retryMaxAttempts: workerRetryConfig.maxAttempts,
      concurrency: workerConcurrency,
      reminderPlayCli,
      reminderPlayMaple
    }).catch(() => {});
    // Constitution has an explicit save action; it is intentionally not a trigger here.
  }, [
    platform,
    executionSettingsReady,
    baseWorker,
    leaderWorker,
    aiLanguage,
    constitution,
    leaderConstitution,
    workerRetryConfig.intervalSeconds,
    workerRetryConfig.maxAttempts,
    workerConcurrency,
    reminderPlayCli,
    reminderPlayMaple
  ]);
  useEffect(() => {
    if (platform.loadExecutionSettings) return;
    saveLocalReminderPlayCli(reminderPlayCli);
  }, [platform, reminderPlayCli]);
  useEffect(() => {
    if (platform.loadExecutionSettings) return;
    saveLocalReminderPlayMaple(reminderPlayMaple);
  }, [platform, reminderPlayMaple]);

  // ── 完成提醒：任务进入「已完成」时按开关在 Maple 内播放音频 ──
  const lastTaskStatusRef = useRef<Map<string, string>>(new Map());
  const completionNotifiedRef = useRef<Set<string>>(new Set());
  const reminderAudioUrlRef = useRef<string | null>(reminderAudioUrl);
  reminderAudioUrlRef.current = reminderAudioUrl;
  useEffect(() => {
    if (!reminderPlayMaple) return;
    const lastStatuses = lastTaskStatusRef.current;
    const notified = completionNotifiedRef.current;
    for (const project of projects) {
      for (const task of project.tasks) {
        const previous = lastStatuses.get(task.id);
        lastStatuses.set(task.id, task.status);
        if (task.status !== "已完成") {
          notified.delete(task.id);
          continue;
        }
        // 首次加载时已完成的旧任务不播；同一任务离开「已完成」后可再次提醒。
        if (previous === undefined || previous === "已完成" || notified.has(task.id)) continue;
        notified.add(task.id);
        const url = reminderAudioUrlRef.current;
        if (!url) continue;
        try {
          const audio = new Audio(url);
          void audio.play().catch(() => {});
        } catch {
          // 播放失败不打断界面流程。
        }
      }
    }
  }, [projects, reminderPlayMaple]);

  useEffect(() => {
    let cancelled = false;
    platform.loadProjects()
      .then((parsed) => {
        if (cancelled) return;
        if (Array.isArray(parsed) && parsed.length > 0) setProjects(normalizeProjects(parsed));
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
    if (!stateBootstrapped) return;
    platform.persistProjects(projects);
  }, [platform, stateBootstrapped, projects]);
  useEffect(() => {
    if (!platform.subscribeProjects) return;
    return platform.subscribeProjects((incoming, { dirtyTaskIds, runners: incomingRunners }) => {
      const preserve = new Set<string>(dirtyTaskIds);
      if (editingTaskIdRef.current) preserve.add(editingTaskIdRef.current);
      setProjects((prev) => mergeExternalProjects(prev, incoming, preserve));
      setRunners(incomingRunners);
    });
  }, [platform]);
  useEffect(() => {
    platform.syncTray(projects, theme);
  }, [platform, projects, theme]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  async function saveConstitution(workerText: string, leaderText: string): Promise<void> {
    const normalizedWorker = workerText.replace(/\r\n/g, "\n");
    const normalizedLeader = leaderText.replace(/\r\n/g, "\n");
    setConstitution(normalizedWorker);
    setLeaderConstitution(normalizedLeader);

    const savedText = uiLanguage === "en" ? "Constitution saved." : "宪法已保存。";
    const failedText = uiLanguage === "en" ? "Failed to save constitution." : "宪法保存失败。";

    try {
      await platform.saveConstitution(normalizedWorker);
      await platform.saveLeaderConstitution(normalizedLeader);
      setNotice(savedText);
    } catch {
      setNotice(failedText);
      throw new Error(failedText);
    }
  }

  useEffect(() => {
    workerLogsRef.current = workerLogs;
  }, [workerLogs]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    editingTaskIdRef.current = editingTaskId;
  }, [editingTaskId]);

  useEffect(() => {
    executingWorkersRef.current = executingWorkers;
  }, [executingWorkers]);

  useEffect(() => {
    if (boardProjectId && !projects.some((p) => p.id === boardProjectId)) {
      setBoardProjectId(null);
      setSelectedTaskId(null);
    }
  }, [boardProjectId, projects]);

  useEffect(() => {
    const activeProjectIds = new Set(projects.map((project) => project.id));
    for (const projectId of Object.keys(retryTimerRef.current)) {
      if (activeProjectIds.has(projectId)) continue;
      clearTimeout(retryTimerRef.current[projectId]);
      delete retryTimerRef.current[projectId];
      delete retryAttemptRef.current[projectId];
    }
  }, [projects]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(retryTimerRef.current)) {
        clearTimeout(timer);
      }
      retryTimerRef.current = {};
    };
  }, []);

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

    const sent = await platform.notify(title, body);
    if (sent) return;

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
    const platformWindow = platform.window;
    if (!platformWindow) return;
    void platformWindow.isMaximized().then(setWindowMaximized).catch(() => undefined);

    let disposed = false;
    const resizeUnsubscribe = platformWindow.onResized(() => {
      if (disposed) return;
      platformWindow.isMaximized().then(setWindowMaximized).catch(() => { /* ignore */ });
    });
    return () => {
      disposed = true;
      resizeUnsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cleanup = platform.onWorkerLog((event) => {
      const { workerId, line } = event;
      setWorkerLogs((prev) => ({ ...prev, [workerId]: `${prev[workerId] ?? ""}${line}` }));
      const promptLine = detectPermissionPromptLine(line);
      if (!promptLine) return;

      const parsed = parseWorkerId(workerId);
      if (parsed.kind) {
        const config = workerConfigs[parsed.kind];
        if (config && hasDangerBypassEnabled(parsed.kind, config)) {
          const now = Date.now();
          const lastAnsweredAt = permissionAnsweredAtRef.current[workerId] ?? 0;
          if (now - lastAnsweredAt >= 1200) {
            permissionAnsweredAtRef.current[workerId] = now;
            void answerPermission(workerId, "y", { silent: true, question: promptLine });
          }
          return;
        }
      }

      setPermissionPrompt({ workerId, question: promptLine });
    });
    return () => {
      cleanup();
    };
  }, [isTauri, workerConfigs]);

  useEffect(() => {
    const cleanup = platform.onTaskUpdated((event) => {
      const { projectName, task } = event;
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
    });
    return () => {
      cleanup();
    };
  }, [isTauri]);

  useEffect(() => {
    const cleanup = platform.onTagCatalogUpdated((event) => {
      const { projectName, tagCatalog } = event;
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
    });
    return () => {
      cleanup();
    };
  }, [isTauri]);

  useEffect(() => {
    const cleanup = platform.onWorkerFinished((event) => {
      const { project, summary } = event;
      const detail = summary.trim();
      setNotice(detail ? `项目「${project}」执行完成：${detail}` : `项目「${project}」执行完成。`);
    });
    return () => {
      cleanup();
    };
  }, [isTauri]);

  useEffect(() => {
    const cleanup = platform.onWorkerDone((event) => {
      const { workerId, success, code } = event;
      const parsed = parseWorkerId(workerId);
      const kindLabel = parsed.kind ? WORKER_KINDS.find((w) => w.kind === parsed.kind)?.label : null;
      const projectName = parsed.projectId ? projectsRef.current.find((p) => p.id === parsed.projectId)?.name : null;
      const label = kindLabel && projectName ? `${kindLabel} · ${projectName}` : kindLabel ?? workerId;
      const currentRunId = activeWorkerRunIdRef.current[workerId];
      const interrupted = isWorkerRunInterrupted(currentRunId);
      appendWorkerLog(workerId, `\n[exit ${code ?? "?"}] ${success ? "完成" : "失败"}\n`);
      setNotice(interrupted ? `${label} 已中断。` : `${label} 会话已结束（exit ${code ?? "?"}）`);
    });
    return () => {
      cleanup();
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
    if (kind === "iflow") return ["--yolo"];
    return [];
  }

  function buildWorkerRunArgs(kind: WorkerKind, config: WorkerConfig): string[] {
    return [...buildDangerArgs(kind, config.dangerMode), ...parseArgs(config.runArgs)];
  }

  function hasDangerBypassEnabled(kind: WorkerKind, config: WorkerConfig): boolean {
    const args = buildWorkerRunArgs(kind, config);
    if (kind === "claude") {
      const permissionModeFlag = args.indexOf("--permission-mode");
      const permissionModeBypass = permissionModeFlag >= 0 && args[permissionModeFlag + 1]?.toLowerCase() === "bypasspermissions";
      return args.includes("--dangerously-skip-permissions") || permissionModeBypass;
    }
    if (kind === "codex") {
      return args.includes("--dangerously-bypass-approvals-and-sandbox") || args.includes("--yolo");
    }
    return args.includes("--yolo");
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

  function buildWorkerRunPayload(
    workerId: string,
    config: WorkerConfig,
    task: Task,
    project: Project
  ): { args: string[]; prompt: string } {
    const kind = parseWorkerId(workerId).kind;
    const args = kind ? buildWorkerRunArgs(kind, config) : parseArgs(config.runArgs);
    const promptText = createWorkerExecutionPrompt({
      projectName: project.name,
      directory: project.directory,
      taskTitle: task.title,
      language: effectiveAiLanguage,
      workerKind: kind ?? undefined
    });

    // Insert prompt according to worker CLI conventions.
    // - Claude/Codex: append prompt after option block so danger flags are preserved.
    // - iFlow: "-p" expects prompt right after the flag.
    if (kind) {
      const strategy = PROMPT_PLACEMENT_BY_KIND[kind];
      if (strategy) {
        const flagIndex = args.indexOf(strategy.flag);
        if (flagIndex >= 0 && strategy.mode === "after_flag") {
          args.splice(flagIndex + 1, 0, promptText);
          return { args, prompt: "" };
        }
        if (flagIndex >= 0 && strategy.mode === "append_tail") {
          args.push(promptText);
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

  async function resolveWorkerRuntime(kind: WorkerKind, config: WorkerConfig): Promise<WorkerRuntime> {
    const existing = workerRuntimeByKind[kind];
    if (existing !== "unknown") return existing;
    if (!isTauri) return "missing";

    const probeArgs = (() => {
      const parsed = parseArgs(config.probeArgs);
      return parsed.length > 0 ? parsed : ["--version"];
    })();

    try {
      const nativeProbe = await platform.probeWorker(config.executable, probeArgs, "");
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

    setWorkerRuntimeByKind((prev) => ({ ...prev, [kind]: "missing" }));
    return "missing";
  }

  // ── Task CRUD ──
  function setEditingTask(taskId: string | null): void {
    editingTaskIdRef.current = taskId;
    setEditingTaskId(taskId);
  }

  function taskMutationVersion(taskId: string): number {
    const version = (taskMutationVersionRef.current[taskId] ?? 0) + 1;
    taskMutationVersionRef.current[taskId] = version;
    return version;
  }

  function enqueueTaskMutation<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = taskMutationQueueRef.current[taskId];
    let result: Promise<T>;
    try {
      result = previous ? previous.then(operation) : operation();
    } catch (error) {
      result = Promise.reject(error);
    }
    const settled = result.then(() => undefined, () => undefined);
    taskMutationQueueRef.current[taskId] = settled;
    void settled.finally(() => {
      if (taskMutationQueueRef.current[taskId] === settled) delete taskMutationQueueRef.current[taskId];
    });
    return result;
  }

  function taskMutationError(prefix: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    setNotice(`${prefix}：${detail}`);
  }

  /** 上传完成提醒音频（≤500kB）。Server-backed 平台走服务端，否则回退本地存储。 */
  async function uploadReminderAudio(file: File): Promise<void> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > REMINDER_AUDIO_MAX_BYTES) {
        setNotice("提醒音频需不超过 500kB。");
        return;
      }
      const mime = file.type || "audio/mpeg";
      if (platform.saveReminderAudio) {
        const url = await platform.saveReminderAudio({ name: file.name, mime, bytes });
        setReminderAudioUrl(url);
      } else {
        const dataUrl = await fileToReminderDataUrl(file);
        saveLocalReminderAudio({ name: file.name, mime, dataUrl });
        setReminderAudioUrl(dataUrl);
      }
      setReminderAudioName(file.name);
      setNotice(uiLanguage === "en" ? "Reminder audio saved." : "提醒音频已保存。");
    } catch (error) {
      taskMutationError(uiLanguage === "en" ? "Failed to save reminder audio" : "提醒音频保存失败", error);
    }
  }

  async function removeReminderAudio(): Promise<void> {
    try {
      if (platform.removeReminderAudio) await platform.removeReminderAudio();
      else removeLocalReminderAudio();
      setReminderAudioUrl(null);
      setReminderAudioName(null);
    } catch (error) {
      taskMutationError(uiLanguage === "en" ? "Failed to remove reminder audio" : "提醒音频删除失败", error);
    }
  }

  function mutateLocalTask(
    projectId: string,
    taskId: string,
    updater: (task: Task) => Task
  ): Task | null {
    let updatedTask: Task | null = null;
    const nextProjects = projectsRef.current.map((project) => {
      if (project.id !== projectId) return project;
      const tasks = project.tasks.map((task) => {
        if (task.id !== taskId) return task;
        updatedTask = updater(task);
        return updatedTask;
      });
      return updatedTask ? { ...project, tasks } : project;
    });
    if (!updatedTask) return null;
    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    return updatedTask;
  }

  function removeLocalTask(projectId: string, taskId: string): void {
    const project = projectsRef.current.find((item) => item.id === projectId);
    const removedIds = new Set<string>([taskId]);
    if (project) {
      // 删除父任务时把整棵子树一起从本地移除，与服务端 ON DELETE CASCADE 保持一致。
      let changed = true;
      while (changed) {
        changed = false;
        for (const task of project.tasks) {
          if (task.parentId && removedIds.has(task.parentId) && !removedIds.has(task.id)) {
            removedIds.add(task.id);
            changed = true;
          }
        }
      }
    }
    const nextProjects = projectsRef.current.map((project) => (
      project.id === projectId
        ? { ...project, tasks: project.tasks.filter((task) => !removedIds.has(task.id)) }
        : project
    ));
    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    if (selectedTaskId && removedIds.has(selectedTaskId)) setSelectedTaskId(null);
    if (editingTaskIdRef.current && removedIds.has(editingTaskIdRef.current)) setEditingTask(null);
  }

  function reconcileServerTask(projectId: string, taskId: string, serverTask: Task): void {
    mutateLocalTask(projectId, taskId, (current) => ({
      ...serverTask,
      needsConfirmation: current.needsConfirmation
    }));
  }

  function updateTask(
    projectId: string,
    taskId: string,
    updater: (task: Task) => Task,
    options?: { touchUpdatedAt?: boolean }
  ) {
    if (deletingTaskIdsRef.current.has(taskId)) return;
    const project = projectsRef.current.find((item) => item.id === projectId);
    const previous = project?.tasks.find((task) => task.id === taskId);
    if (!previous) return;
    const now = new Date().toISOString();
    const touchUpdatedAt = options?.touchUpdatedAt ?? true;
    const next = { ...updater(previous), updatedAt: touchUpdatedAt ? now : previous.updatedAt };
    mutateLocalTask(projectId, taskId, () => next);

    if (!platform.taskCommands || !previous.title.trim()) return;
    const version = taskMutationVersion(taskId);
    void enqueueTaskMutation(taskId, () => platform.taskCommands!.update(projectId, previous, next))
      .then((serverTask) => {
        if (taskMutationVersionRef.current[taskId] === version) {
          reconcileServerTask(projectId, taskId, serverTask);
        }
      })
      .catch((error) => taskMutationError("任务保存失败", error));
  }

  function addTask(projectId: string) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return;
    const newTask = createTask("", "待办", baseWorker);
    const nextProjects = projectsRef.current.map((item) => (
      item.id === projectId ? { ...item, tasks: [newTask, ...item.tasks] } : item
    ));
    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    setEditingTask(newTask.id);
  }

  function addDraftTask(projectId: string) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return;
    const newTask = createTask("", "草稿", baseWorker);
    const nextProjects = projectsRef.current.map((item) => (
      item.id === projectId ? { ...item, tasks: [newTask, ...item.tasks] } : item
    ));
    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    setEditingTask(newTask.id);
  }

  /** 任务行最左侧的添加按钮创建子任务：插入父任务下方并进入标题编辑。 */
  function addSubtask(projectId: string, parentTaskId: string) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return;
    const parentIndex = project.tasks.findIndex((task) => task.id === parentTaskId);
    const parentTask = project.tasks[parentIndex];
    const newTask = createTask("", "草稿", parentTask?.workerKind ?? baseWorker, parentTaskId);
    const nextTasks = [...project.tasks];
    nextTasks.splice(parentIndex >= 0 ? parentIndex + 1 : 0, 0, newTask);
    const nextProjects = projectsRef.current.map((item) => (
      item.id === projectId ? { ...item, tasks: nextTasks } : item
    ));
    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    setEditingTask(newTask.id);
  }

  function selectTask(taskId: string | null) {
    setSelectedTaskId(taskId);
    if (!taskId || !boardProjectId) return;
    const project = projectsRef.current.find((p) => p.id === boardProjectId);
    const task = project?.tasks.find((t) => t.id === taskId);
    if (!project || !task?.needsConfirmation) return;
    updateTask(project.id, taskId, (t) => ({ ...t, needsConfirmation: false }), { touchUpdatedAt: false });
  }

  async function commitTaskTitle(projectId: string, taskId: string, title: string): Promise<boolean> {
    const trimmed = title.trim();
    const project = projectsRef.current.find((item) => item.id === projectId);
    const existingTask = project?.tasks.find((t) => t.id === taskId);
    if (!project || !existingTask) {
      setEditingTask(null);
      return true;
    }

    const hadTitle = existingTask.title.trim().length > 0;
    if (!trimmed && !hadTitle) {
      removeLocalTask(projectId, taskId);
      return true;
    }
    if (!trimmed) {
      setEditingTask(null);
      return true;
    }

    if (!hadTitle && platform.taskCommands) {
      if (creatingTaskIdsRef.current.has(taskId)) return false;
      creatingTaskIdsRef.current.add(taskId);
      const task = {
        ...existingTask,
        title: trimmed,
        workerKind: existingTask.workerKind ?? baseWorker,
        updatedAt: new Date().toISOString()
      };
      const version = taskMutationVersion(taskId);
      try {
        const serverTask = await enqueueTaskMutation(taskId, () => (
          platform.taskCommands!.create(projectId, task, baseWorker)
        ));
        if (taskMutationVersionRef.current[taskId] === version) {
          reconcileServerTask(projectId, taskId, serverTask);
        }
        setEditingTask(null);
        return true;
      } catch (error) {
        taskMutationError("任务创建失败", error);
        return false;
      } finally {
        creatingTaskIdsRef.current.delete(taskId);
      }
    }

    updateTask(projectId, taskId, (task) => ({ ...task, title: trimmed }));
    setEditingTask(null);
    return true;
  }

  function deleteTask(projectId: string, taskId: string) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    const task = project?.tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (!platform.taskCommands || !task.title.trim()) {
      removeLocalTask(projectId, taskId);
      return;
    }
    if (deletingTaskIdsRef.current.has(taskId)) return;
    deletingTaskIdsRef.current.add(taskId);
    taskMutationVersion(taskId);
    void enqueueTaskMutation(taskId, () => platform.taskCommands!.remove(projectId, taskId))
      .then(() => removeLocalTask(projectId, taskId))
      .catch((error) => taskMutationError("任务删除失败", error))
      .finally(() => deletingTaskIdsRef.current.delete(taskId));
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
    const projectActiveWorkerId = preferredProjectId
      ? activeWorkerIds.find((workerId) => parseWorkerId(workerId).projectId === preferredProjectId) ?? null
      : null;
    if (requireActive && !projectActiveWorkerId && !(preferredWorkerId && activeWorkerIds.includes(preferredWorkerId))) {
      setNotice("该项目当前没有正在工作的 Worker 实例，无法打开控制台。");
      return;
    }

    const fallbackWorkerId =
      (preferredWorkerId && activeWorkerIds.includes(preferredWorkerId) ? preferredWorkerId : null)
      ?? projectActiveWorkerId
      ?? (preferredKind ? activeWorkerIds.find((workerId) => isWorkerKindId(workerId, preferredKind)) ?? null : null)
      ?? activeWorkerIds[0]
      ?? (boardProject ? buildWorkerId(baseWorker, boardProject.id) : null)
      ?? buildWorkerId(preferredKind ?? baseWorker);

    setWorkerConsoleWorkerId(fallbackWorkerId);
    setWorkerConsoleOpen(true);
  }

  function setWorkerRetryConfig(next: Partial<WorkerRetryConfig>) {
    setWorkerRetryConfigState((prev) => normalizeWorkerRetryConfig({ ...prev, ...next }));
  }

  function clearRetryTimer(workerId: string) {
    const timer = retryTimerRef.current[workerId];
    if (!timer) return;
    clearTimeout(timer);
    delete retryTimerRef.current[workerId];
  }

  function clearRetryState(workerId: string) {
    clearRetryTimer(workerId);
    delete retryAttemptRef.current[workerId];
  }

  function countTasksByStatus(projectId: string, status: Task["status"]): number {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return 0;
    return project.tasks.filter((task) => task.status === status).length;
  }

  function resetProjectTasksToTodo(
    projectId: string,
    statuses: Task["status"][],
    options?: {
      workerKind?: WorkerKind;
      report?: { author: string; content: string };
    }
  ): number {
    const statusSet = new Set(statuses);
    const now = new Date().toISOString();
    let resetCount = 0;
    let changed = false;

    const nextProjects: Project[] = projectsRef.current.map((project) => {
      if (project.id !== projectId) return project;
      let projectChanged = false;
      const nextTasks: Task[] = project.tasks.map((task): Task => {
        if (options?.workerKind) {
          if (task.workerKind !== options.workerKind) {
            return task;
          }
        }
        if (!statusSet.has(task.status)) return task;
        projectChanged = true;
        resetCount += 1;
        return {
          ...task,
          status: "待办" as const,
          needsConfirmation: false,
          updatedAt: now,
          reports: options?.report
            ? [...task.reports, createTaskReport(options.report.author, options.report.content)]
            : task.reports,
        };
      });
      if (!projectChanged) return project;
      changed = true;
      return { ...project, tasks: nextTasks };
    });

    if (changed) {
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
    }

    return resetCount;
  }

  async function stopWorkerProcess(workerId: string): Promise<boolean> {
    if (!isTauri) return false;
    try {
      return await platform.stopWorker(workerId);
    } catch {
      return false;
    }
  }

  function beginWorkerRun(workerId: string): string {
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeWorkerRunIdRef.current[workerId] = runId;
    return runId;
  }

  function markWorkerRunInterrupted(workerId: string): string | null {
    const runId = activeWorkerRunIdRef.current[workerId];
    if (!runId) return null;
    interruptedWorkerRunIdsRef.current.add(runId);
    return runId;
  }

  function isWorkerRunInterrupted(runId: string | null | undefined): boolean {
    return Boolean(runId) && interruptedWorkerRunIdsRef.current.has(runId!);
  }

  async function interruptProjectExecution(workerId: string) {
    const parsed = parseWorkerId(workerId);
    const projectId = parsed.projectId;
    const workerKind = parsed.kind;
    const label = parsed.kind
      ? WORKER_KINDS.find((worker) => worker.kind === parsed.kind)?.label ?? parsed.kind
      : workerId;

    markWorkerRunInterrupted(workerId);
    clearRetryState(workerId);

    const stopped = await stopWorkerProcess(workerId);
    setExecutingWorkers((prev) => {
      const next = new Set(prev);
      next.delete(workerId);
      return next;
    });
    setPermissionPrompt((prev) => (prev?.workerId === workerId ? null : prev));

    if (!projectId) {
      appendWorkerLog(
        workerId,
        `\n[手动中断] ${stopped ? "已终止当前 Worker。" : "未检测到可终止的 Worker 进程。"}\n`
      );
      setNotice(stopped ? `已中断 ${label}。` : `未检测到可中断的 ${label} 进程。`);
      return;
    }

    const resetCount = resetProjectTasksToTodo(projectId, ["进行中", "队列中"], {
      workerKind: workerKind ?? undefined,
      report: {
        author: label,
        content: INTERRUPTED_EXECUTION_REPORT,
      },
    });

    if (resetCount === 0) {
      appendWorkerLog(
        workerId,
        `\n[手动中断] ${stopped ? "当前 Worker 已终止。" : "未检测到可终止的 Worker 进程。"} 当前项目没有执行中的任务。\n`
      );
      setNotice(stopped ? `已停止 ${label}，当前项目没有执行中的任务。` : "当前项目没有执行中的任务。");
      return;
    }

    appendWorkerLog(
      workerId,
      `\n[手动中断] 已重置 ${resetCount} 个任务为待办，${stopped ? "当前 Worker 已终止" : "未检测到可终止的 Worker 进程"}。\n`
    );
    setNotice(`已中断 ${label}，并将 ${resetCount} 个任务恢复为待办。`);
  }

  async function restartProjectExecution(projectId: string) {
    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return;

    const activeKinds = [...new Set(
      project.tasks
        .filter((task) => task.status === "进行中" || task.status === "队列中")
        .map((task) => task.workerKind)
    )];
    if (activeKinds.length === 0) { setNotice("当前项目没有执行中的任务。"); return; }

    let totalReset = 0;
    for (const kind of activeKinds) {
      const workerId = buildWorkerId(kind, project.id);
      clearRetryState(workerId);
      markWorkerRunInterrupted(workerId);

      const stopped = await stopWorkerProcess(workerId);
      setExecutingWorkers((prev) => {
        const next = new Set(prev);
        next.delete(workerId);
        return next;
      });
      setPermissionPrompt((prev) => (prev?.workerId === workerId ? null : prev));

      const resetCount = resetProjectTasksToTodo(projectId, ["进行中", "队列中"], {
        workerKind: kind,
        report: {
          author: WORKER_KINDS.find((worker) => worker.kind === kind)?.label ?? kind,
          content: INTERRUPTED_EXECUTION_REPORT,
        },
      });
      totalReset += resetCount;
      appendWorkerLog(
        workerId,
        `\n[手动重启] 已重置 ${resetCount} 个任务为待办，${stopped ? "旧 Worker 已终止" : "未检测到可终止的 Worker 进程"}。\n`
      );
    }

    setNotice(`已重置 ${totalReset} 个任务并重新开始执行。`);
    await completePending(projectId);
  }

  function scheduleProjectRetry(projectId: string, kind: WorkerKind, workerId: string, label: string) {
    clearRetryTimer(workerId);
    const inProgressCount = countTasksByStatus(projectId, "进行中");
    if (inProgressCount === 0) {
      delete retryAttemptRef.current[workerId];
      return;
    }

    const previousAttempts = retryAttemptRef.current[workerId] ?? 0;
    const nextAttempt = previousAttempts + 1;
    if (nextAttempt > workerRetryConfig.maxAttempts) {
      appendWorkerLog(
        workerId,
        `\n[自动重试停止] 仍有 ${inProgressCount} 个任务处于进行中，已达到最大重试次数 ${workerRetryConfig.maxAttempts}。\n`
      );
      setNotice(`${label} 自动重试已停止：已达到最大重试次数。`);
      return;
    }

    const delayMs = workerRetryConfig.intervalSeconds * 1000;
    appendWorkerLog(
      workerId,
      `\n[自动重试] 检测到 ${inProgressCount} 个进行中任务，将在 ${workerRetryConfig.intervalSeconds} 秒后执行第 ${nextAttempt}/${workerRetryConfig.maxAttempts} 次重试。\n`
    );
    retryTimerRef.current[workerId] = setTimeout(() => {
      delete retryTimerRef.current[workerId];

      if (executingWorkersRef.current.has(workerId)) {
        scheduleProjectRetry(projectId, kind, workerId, label);
        return;
      }

      const remainingInProgress = countTasksByStatus(projectId, "进行中");
      if (remainingInProgress === 0) {
        delete retryAttemptRef.current[workerId];
        return;
      }

      retryAttemptRef.current[workerId] = nextAttempt;
      const resetCount = resetProjectTasksToTodo(projectId, ["进行中"]);
      if (resetCount === 0) {
        delete retryAttemptRef.current[projectId];
        return;
      }

      setNotice(`${label} 正在自动重试（第 ${nextAttempt}/${workerRetryConfig.maxAttempts} 次）。`);
      void completePending(projectId, kind);
    }, delayMs);
  }

  // ── Project Management ──
  function removeLocalProject(projectId: string): void {
    const nextProjects = projectsRef.current.filter((project) => project.id !== projectId);
    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    setBoardProjectId((current) => current === projectId ? null : current);
    if (boardProjectId === projectId) setSelectedTaskId(null);
  }

  function removeProject(projectId: string) {
    if (!platform.projectCommands) {
      removeLocalProject(projectId);
      return;
    }
    if (deletingProjectIdsRef.current.has(projectId)) return;
    deletingProjectIdsRef.current.add(projectId);
    void platform.projectCommands.remove(projectId)
      .then(() => {
        removeLocalProject(projectId);
        setNotice(uiLanguage === "en" ? "Project removed." : "项目已删除。");
      })
      .catch((error) => taskMutationError(uiLanguage === "en" ? "Failed to remove project" : "项目删除失败", error))
      .finally(() => deletingProjectIdsRef.current.delete(projectId));
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
    return platform.runWorker({
      workerId,
      taskTitle: task.title,
      executable: config.executable,
      args: runPayload.args,
      prompt: runPayload.prompt,
      cwd: project.directory
    });
  }

  async function completePending(projectId: string, overrideKind?: WorkerKind) {
    const project = projectsRef.current.find((p) => p.id === projectId);
    if (!project) return;
    const pendingTasks = project.tasks.filter((t) => t.status === "待办" || t.status === "待返工");
    const kinds = overrideKind
      ? [overrideKind]
      : [...new Set(pendingTasks.map((t) => t.workerKind))];
    if (kinds.length === 0) { setNotice("目前没有更多待办"); return; }
    for (const kind of kinds) {
      void completePendingForKind(projectId, kind);
    }
  }

  async function completePendingForKind(projectId: string, kind: WorkerKind) {
    const project = projectsRef.current.find((p) => p.id === projectId);
    if (!project) return;
    if (!project.directory) { setNotice("项目缺少目录，无法执行。"); return; }
    const config = workerConfigs[kind] ?? DEFAULT_WORKER_CONFIGS[kind];
    const label = WORKER_KINDS.find((w) => w.kind === kind)?.label ?? kind;
    if (!config.executable.trim()) { setNotice(`请先在进度页配置 ${label} 命令。`); return; }
    const pendingTasks = project.tasks.filter((t) => (t.status === "待办" || t.status === "待返工") && t.workerKind === kind);
    if (pendingTasks.length === 0) { setNotice(`${label} 当前没有可执行的任务。`); return; }
    const pendingTaskIds = new Set(pendingTasks.map((t) => t.id));
    const workerId = buildWorkerId(kind, project.id);
    const runId = beginWorkerRun(workerId);
    setExecutingWorkers((prev) => {
      const next = new Set(prev);
      next.add(workerId);
      return next;
    });
    setNotice(`${label} 准备执行…`);
    try {
      const runtime = await resolveWorkerRuntime(kind, config);
      if (runtime === "missing") {
        setNotice(`${label} CLI 未检测到，请先安装或配置。`);
        return;
      }

      startTransition(() => {
        setProjects((prev) => {
          const now = new Date().toISOString();
          return prev.map((item) => item.id !== project.id ? item : {
            ...item,
            tasks: item.tasks.map((task) => (
              pendingTaskIds.has(task.id) && (task.status === "待办" || task.status === "待返工")
                ? { ...task, status: "队列中", updatedAt: now }
                : task
            ))
          });
        });
      });

      let executionInterrupted = false;
      for (const task of pendingTasks) {
        if (isWorkerRunInterrupted(runId)) {
          executionInterrupted = true;
          break;
        }

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
          appendWorkerLog(workerId, `\n$ ${formatCommandForLog(config.executable, payload.args)}\n`);
          const beforeLen = workerLogsRef.current[workerId]?.length ?? 0;
          const result = await runWorkerCommand(runtime, workerId, config, task, project, payload);
          const afterLen = workerLogsRef.current[workerId]?.length ?? 0;
          if (!isTauri || afterLen === beforeLen) {
            if (result.stdout.trim()) appendWorkerLog(workerId, `${result.stdout.trim()}\n`);
            if (result.stderr.trim()) appendWorkerLog(workerId, `${result.stderr.trim()}\n`);
          }

          if (isWorkerRunInterrupted(runId)) {
            executionInterrupted = true;
            break;
          }

          // Check if MCP events already updated the task to a terminal state.
          // If so, the worker drove state transitions properly via MCP tools.
          const currentTask = projectsRef.current
            .find((p) => p.id === projectId)
            ?.tasks.find((t) => t.id === task.id);
          const mcpDrivenStatus = currentTask?.status;
          const isTerminal = mcpDrivenStatus === "已完成" || mcpDrivenStatus === "已阻塞"
            || mcpDrivenStatus === "需要更多信息" || mcpDrivenStatus === "待返工";

          if (isTerminal) {
            // MCP already handled status; nothing more to do for this task.
            continue;
          }

          // Fallback: worker exited without driving a terminal MCP state.
          if (isWorkerRunInterrupted(runId)) {
            executionInterrupted = true;
            break;
          }

          const report = createTaskReport(label, buildWorkerArchiveReport(result, task.title));
          updateTask(project.id, task.id, (c) => ({
            ...c,
            status: "已阻塞",
            needsConfirmation: false,
            reports: [...c.reports, report],
          }));

    } catch (error) {
          appendWorkerLog(workerId, `\n${String(error)}\n`);
          if (isWorkerRunInterrupted(runId)) {
            executionInterrupted = true;
            break;
          }
          updateTask(project.id, task.id, (c) => ({ ...c, status: "已阻塞", reports: [...c.reports, createTaskReport(label, `执行异常：${String(error)}`)] }));
        }
      }
      if (!executionInterrupted) {
        setNotice(`已触发 ${label} 执行 ${pendingTasks.length} 个任务。`);
      }
    } finally {
      const shouldClearActiveRun = activeWorkerRunIdRef.current[workerId] === runId;
      const interrupted = isWorkerRunInterrupted(runId);
      interruptedWorkerRunIdsRef.current.delete(runId);
      if (shouldClearActiveRun) {
        delete activeWorkerRunIdRef.current[workerId];
        setExecutingWorkers((prev) => {
          const next = new Set(prev);
          next.delete(workerId);
          return next;
        });
      }

      if (!interrupted && countTasksByStatus(project.id, "进行中") > 0) {
        scheduleProjectRetry(project.id, kind, workerId, label);
      } else {
        clearRetryState(workerId);
      }
    }
  }

  async function answerPermission(
    workerId: string,
    answer: string,
    options?: { silent?: boolean; question?: string }
  ) {
    setPermissionPrompt(null);
    if (!isTauri) return;
    if (options?.silent) {
      const question = options.question?.trim();
      appendWorkerLog(workerId, `\n[自动确认] ${question ? `${question} -> ` : ""}${answer}\n`);
    } else {
      appendWorkerLog(workerId, `> ${answer}\n`);
    }
    try { await platform.sendWorkerInput(workerId, answer); }
    catch (error) { appendWorkerLog(workerId, `\n${String(error)}\n`); }
  }

  // ── Window Controls ──
  async function minimizeWindow() {
    if (!platform.window) return;
    try { await platform.window.minimize(); }
    catch (error) { setNotice(`窗口最小化失败：${String(error)}`); }
  }

  async function toggleWindowMaximize() {
    if (!platform.window) return;
    try {
      const maximized = await platform.window.toggleMaximize();
      setWindowMaximized(maximized);
    } catch (error) { setNotice(`窗口缩放失败：${String(error)}`); }
  }

  async function closeWindow() {
    if (!platform.window) return;
    try { await platform.window.close(); }
    catch (error) { setNotice(`窗口关闭失败：${String(error)}`); }
  }

  // ── Render ──
  const mobileTabT = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  return (
    <PlatformProvider value={platform}>
    <div className={`app-root${windowMaximized ? " maximized" : ""}`}>
      <AppBackground />
      <div className="shell">
        <div className={`app-frame${mobileNavOpen ? " nav-open" : ""}`}>
        <AppSidebar
          view={view}
          projects={projects}
          runners={runners}
          workers={visibleSidebarWorkers}
          showWorkers={platform.capabilities.projectSource === "runner" && visibleSidebarWorkers.length > 0}
          boardProjectId={boardProjectId}
          uiLanguage={uiLanguage}
          isTauri={isTauri}
          windowMaximized={windowMaximized}
          onViewChange={(nextView) => { setView(nextView); setMobileNavOpen(false); }}
          onProjectSelect={(id) => { setBoardProjectId(id); setView("board"); setSelectedTaskId(null); setMobileNavOpen(false); }}
          onReorderProjects={reorderProjects}
          onMinimize={minimizeWindow}
          onToggleMaximize={toggleWindowMaximize}
          onClose={closeWindow}
          footer={typeof sidebarFooter === "function" ? sidebarFooter({ openSettings: () => { setView("settings"); setMobileNavOpen(false); } }) : sidebarFooter}
          version={version}
          onBrandClick={onBrandClick}
        />

        {/* 移动端导航抽屉的半透明遮罩（仅 ≤980px 显示，点按关闭抽屉） */}
        <button
          type="button"
          className="mobile-nav-backdrop"
          aria-label="关闭导航菜单"
          onClick={() => setMobileNavOpen(false)}
        />

        {/* 移动端底部标签栏（iOS Tab Bar 质感，仅 ≤980px 显示） */}
        <nav className="mobile-tabbar" aria-label="主导航">
          <button
            type="button"
            className={`mobile-tab${view === "overview" ? " active" : ""}`}
            onClick={() => setView("overview")}
          >
            <Icon icon="mingcute:home-4-line" className="text-[21px]" />
            <span>{mobileTabT("概览", "Overview")}</span>
          </button>
          <button
            type="button"
            className={`mobile-tab${view === "board" ? " active" : ""}`}
            onClick={() => {
              if (!boardProjectId && projects.length > 0) {
                setBoardProjectId(projects[0].id);
                setSelectedTaskId(null);
              }
              setView("board");
            }}
          >
            <Icon icon="mingcute:board-line" className="text-[21px]" />
            <span>{mobileTabT("看板", "Board")}</span>
          </button>
          <button
            type="button"
            className={`mobile-tab${view === "settings" || view === "progress" ? " active" : ""}`}
            onClick={() => setView("settings")}
          >
            <Icon icon="mingcute:settings-3-line" className="text-[21px]" />
            <span>{mobileTabT("设置", "Settings")}</span>
          </button>
          <button
            type="button"
            className={`mobile-tab${mobileNavOpen ? " active" : ""}`}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <Icon icon="mingcute:menu-line" className="text-[21px]" />
            <span>{mobileTabT("菜单", "Menu")}</span>
          </button>
        </nav>

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
                    projectTokenUsage={metrics.projectTokenUsage}
                    runners={runners}
                    workerAvailability={workerAvailability}
                    installProbes={installProbes}
                    workerPool={workerPool}
                    onRefreshProbes={() => setInstallProbeToken((n) => n + 1)}
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
                    uiLanguage={uiLanguage}
                    tagLanguage={effectiveAiLanguage}
                    detailMode={detailMode}
                    externalEditorApp={externalEditorApp}
                    displayType={boardDisplayType}
                    leaderWorker={leaderWorker}
                    workers={visibleSidebarWorkers}
                    executionConcurrency={workerConcurrency}
                    debugColumnEnabled={debugColumnEnabled}
                    taskDebugMap={taskDebugMap}
                    onOpenLeaderSettings={() => openSettingsTab("models")}
                    onSetDisplayType={setBoardDisplayType}
                    onAddDraftTask={addDraftTask}
                    onCommitTaskTitle={commitTaskTitle}
                    onAddSubtask={addSubtask}
                    onUpdateTaskStatus={(projectId, taskId, status) => updateTask(projectId, taskId, (t) => ({ ...t, status: status as TaskStatus }))}
                    onUpdateTaskWorker={(projectId, taskId, kind) => updateTask(projectId, taskId, (t) => ({ ...t, workerKind: kind }))}
                    onDeleteTask={deleteTask}
                    onSelectTask={selectTask}
                    onEditTask={setEditingTask}
                    onSetDetailMode={setDetailMode}
                    onOpenProjectConsole={(projectId) => {
                      openWorkerConsole(undefined, { requireActive: true, projectId });
                    }}
                    onRemoveProject={removeProject}
                    onExportTasks={exportProjectDebug}
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
                    detailMode={detailMode}
                    theme={theme}
                    uiFont={uiFont}
                    uiLanguage={uiLanguage}
                    aiLanguage={aiLanguage}
                    baseWorker={baseWorker}
                    leaderWorker={leaderWorker}
                    externalEditorApp={externalEditorApp}
                    constitution={constitution}
                    leaderConstitution={leaderConstitution}
                    workerAvailability={workerAvailability}
                    installProbes={installProbes}
                    onThemeChange={setThemeState}
                    onUiFontChange={setUiFont}
                    onUiLanguageChange={setUiLanguage}
                    onAiLanguageChange={setAiLanguage}
                    onBaseWorkerChange={setBaseWorker}
                    onLeaderWorkerChange={setLeaderWorker}
                    onExternalEditorAppChange={setExternalEditorApp}
                    onSaveConstitution={saveConstitution}
                    onDetailModeChange={setDetailMode}
                      workerRetryIntervalSeconds={workerRetryConfig.intervalSeconds}
                      workerRetryMaxAttempts={workerRetryConfig.maxAttempts}
                      workerConcurrency={workerConcurrency}
                      onWorkerRetryIntervalChange={(seconds) => setWorkerRetryConfig({ intervalSeconds: seconds })}
                      onWorkerRetryMaxAttemptsChange={(count) => setWorkerRetryConfig({ maxAttempts: count })}
                      onWorkerConcurrencyChange={setWorkerConcurrency}
                      reminderAudioUrl={reminderAudioUrl}
                      reminderAudioName={reminderAudioName}
                      reminderPlayCli={reminderPlayCli}
                      reminderPlayMaple={reminderPlayMaple}
                      onUploadReminderAudio={(file) => void uploadReminderAudio(file)}
                      onRemoveReminderAudio={() => void removeReminderAudio()}
                      onReminderPlayCliChange={setReminderPlayCli}
                      onReminderPlayMapleChange={setReminderPlayMaple}
                      debugColumnEnabled={debugColumnEnabled}
                      onDebugColumnChange={setDebugColumnEnabled}
                    onRefreshProbes={() => setInstallProbeToken((n) => n + 1)}
                    extraTabs={settingsExtraTabs}
                    tabRequest={settingsTabRequest}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </main>
        </div>
        </div>

        {workerConsoleOpen && (
          <WorkerConsoleModal
            workerConsoleWorkerId={workerConsoleWorkerId}
            currentWorkerLog={currentWorkerLog}
            executingWorkers={executingWorkers}
            workerPool={workerPool}
            theme={theme}
            onClose={() => setWorkerConsoleOpen(false)}
            onInterruptWorker={(wId) => void interruptProjectExecution(wId)}
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
	              subtaskCount={boardProject.tasks.filter((t) => t.parentId === selectedTaskId).length}
	              waitingKind={taskWaitingKind(
	                boardProject.tasks.find((t) => t.id === selectedTaskId)!,
	                boardProject.tasks,
	                workerConcurrency
	              )}
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
	              onSetAsRework={() => updateTask(boardProject.id, selectedTaskId, (t) => ({
	                ...t,
	                status: "待返工",
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
	              onUpdateTaskStatus={(status) => updateTask(boardProject.id, selectedTaskId, (t) => ({ ...t, status: status as TaskStatus }))}
	              onUpdateTags={(nextTags) => updateTask(boardProject.id, selectedTaskId, (t) => ({ ...t, tags: nextTags }))}
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
	                subtaskCount={boardProject.tasks.filter((t) => t.parentId === selectedTaskId).length}
	                waitingKind={taskWaitingKind(
	                  boardProject.tasks.find((t) => t.id === selectedTaskId)!,
	                  boardProject.tasks,
	                  workerConcurrency
	                )}
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
	                onSetAsRework={() => updateTask(boardProject.id, selectedTaskId, (t) => ({
	                  ...t,
	                  status: "待返工",
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
	                onUpdateTags={(nextTags) => updateTask(boardProject.id, selectedTaskId, (t) => ({ ...t, tags: nextTags }))}
	                onRestartExecution={() => void restartProjectExecution(boardProject.id)}
	                onDelete={() => deleteTask(boardProject.id, selectedTaskId)}
	              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </PlatformProvider>
  );
}

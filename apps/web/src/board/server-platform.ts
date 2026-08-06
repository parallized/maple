import {
  createNoopPlatform,
  getAssetFromDb,
  WEB_CAPABILITIES,
  type BoardPlatform,
  type Project,
  type ProjectCommands,
  type RunnerSummary,
  type TagCatalog,
  type Task,
  type TaskCommands
} from "@maple/board-ui";
import type { UpdateTodoRequest } from "@maple/protocol";
import { DashboardApi, DashboardApiError } from "../api/client";
import { mapSnapshotToProjects, mapSnapshotToRunners, mapTodoToTask } from "./snapshot-mapper";
import { toTodoStatus } from "./status-map";

const ORDER_STORAGE_KEY = "maple.web.project-order";
const POLL_INTERVAL_MS = 2_000;
const PROJECT_PERSIST_DEBOUNCE_MS = 500;
const PROJECT_RETRY_DELAY_MS = 2_000;

export interface ServerPlatformOptions {
  /** snapshot / 写入返回 401 时触发（连接失效，回到登录页）。 */
  onUnauthorized?: () => void;
  /** Account/workspace namespace for browser-only presentation state. */
  storageScope?: string;
}

/** BoardPlatform 之上额外暴露的能力：外部变更后主动刷新。 */
export type ServerPlatform = BoardPlatform & {
  refreshNow: () => Promise<void>;
};

interface ProjectState {
  id: string;
  tagCatalog?: TagCatalog;
}

function cloneTagCatalog(value: TagCatalog | undefined): TagCatalog | undefined {
  if (!value) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as TagCatalog;
  }
}

function serializeDetailsDoc(doc: unknown): string {
  if (doc === undefined || doc === null) return "";
  if (typeof doc === "string") return doc;
  try {
    return JSON.stringify(doc);
  } catch {
    return "";
  }
}

function sameTags(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

export function buildTodoUpdateRequest(previous: Task, next: Task): UpdateTodoRequest {
  const body: UpdateTodoRequest = {};
  if (previous.title !== next.title) body.title = next.title;
  if (previous.details !== next.details) body.details = next.details;

  const previousDoc = serializeDetailsDoc(previous.detailsDoc);
  const nextDoc = serializeDetailsDoc(next.detailsDoc);
  if (previousDoc !== nextDoc) body.detailsDoc = nextDoc;
  if (!sameTags(previous.tags, next.tags)) body.tags = [...next.tags];
  if (previous.workerKind !== next.workerKind) {
    body.workerKind = next.workerKind;
  }
  if (
    previous.status !== next.status
    && next.status !== "队列中"
    && next.status !== "进行中"
  ) {
    body.status = toTodoStatus(next.status);
  }
  return body;
}

function readOrder(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeOrder(storageKey: string, order: string[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(order));
  } catch {
    // 隐私模式或存储被禁用时，项目顺序只在当前会话有效。
  }
}

function captureProjectState(projects: Project[]): ProjectState[] {
  return projects.map((project) => ({
    id: project.id,
    tagCatalog: cloneTagCatalog(project.tagCatalog)
  }));
}

function sameTagCatalog(left: TagCatalog | undefined, right: TagCatalog | undefined): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

/**
 * Web 的 Server 平台适配层。
 *
 * Server 是任务的唯一数据源：任务写入全部走 taskCommands，快照轮询只负责读取。
 * persistProjects 只处理项目顺序和标签目录；项目与任务删除都走显式命令。
 */
export function createServerPlatform(api: DashboardApi, options?: ServerPlatformOptions): ServerPlatform {
  const baselineProjects = new Map<string, { tagCatalog?: TagCatalog }>();
  const pendingTaskCounts = new Map<string, number>();
  const orderStorageKey = options?.storageScope
    ? `${ORDER_STORAGE_KEY}:${options.storageScope}`
    : ORDER_STORAGE_KEY;
  let localOrder = readOrder(orderStorageKey);
  let pendingProjectState: ProjectState[] | null = null;
  let projectStateVersion = 0;
  let projectPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let projectFlushInFlight = false;
  let projectRetryNeeded = false;
  let unauthorizedNotified = false;
  let taskMutationEpoch = 0;
  let snapshotSubscriber: ((
    projects: Project[],
    meta: { dirtyTaskIds: ReadonlySet<string>; runners: RunnerSummary[] }
  ) => void) | null = null;
  let pollInFlight = false;
  let pollRequested = false;

  function notifyUnauthorized(): void {
    if (unauthorizedNotified) return;
    unauthorizedNotified = true;
    options?.onUnauthorized?.();
  }

  function handleApiError(error: unknown): void {
    if (error instanceof DashboardApiError && error.status === 401) notifyUnauthorized();
  }

  function alignProjectBaseline(projects: Project[]): void {
    const seen = new Set<string>();
    for (const project of projects) {
      seen.add(project.id);
      baselineProjects.set(project.id, { tagCatalog: cloneTagCatalog(project.tagCatalog) });
    }
    for (const projectId of [...baselineProjects.keys()]) {
      if (!seen.has(projectId)) baselineProjects.delete(projectId);
    }
  }

  function dirtyTaskIds(): ReadonlySet<string> {
    return new Set(pendingTaskCounts.keys());
  }

  async function pollSnapshot(): Promise<void> {
    if (!snapshotSubscriber) return;
    if (typeof document !== "undefined" && document.hidden) return;
    if (pollInFlight) {
      pollRequested = true;
      return;
    }

    pollInFlight = true;
    pollRequested = false;
    const startedMutationEpoch = taskMutationEpoch;
    try {
      const snapshot = await api.snapshot();
      if (!snapshotSubscriber) return;
      if (startedMutationEpoch !== taskMutationEpoch) {
        pollRequested = true;
        return;
      }
      const projects = mapSnapshotToProjects(snapshot, localOrder);
      alignProjectBaseline(projects);
      snapshotSubscriber(projects, {
        dirtyTaskIds: dirtyTaskIds(),
        runners: mapSnapshotToRunners(snapshot)
      });
    } catch (error) {
      handleApiError(error);
    } finally {
      pollInFlight = false;
      if (pollRequested) {
        queueMicrotask(() => void pollSnapshot());
      }
    }
  }

  function beginTaskMutation(taskId: string): void {
    pendingTaskCounts.set(taskId, (pendingTaskCounts.get(taskId) ?? 0) + 1);
    taskMutationEpoch += 1;
  }

  function endTaskMutation(taskId: string): void {
    const remaining = (pendingTaskCounts.get(taskId) ?? 1) - 1;
    if (remaining > 0) pendingTaskCounts.set(taskId, remaining);
    else pendingTaskCounts.delete(taskId);
    taskMutationEpoch += 1;
    void pollSnapshot();
  }

  async function runTaskMutation<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    beginTaskMutation(taskId);
    try {
      return await operation();
    } catch (error) {
      handleApiError(error);
      throw error;
    } finally {
      endTaskMutation(taskId);
    }
  }

  const taskCommands: TaskCommands = {
    create(projectId, task, fallbackWorkerKind) {
      return runTaskMutation(task.id, async () => {
        let todo = await api.createTodo(projectId, {
          id: task.id,
          title: task.title,
          details: task.details,
          parentId: task.parentId ?? undefined,
          workerKind: task.workerKind ?? fallbackWorkerKind ?? "codex",
          tags: [...task.tags],
          status: task.status === "草稿" ? "draft" : "todo"
        });
        const detailsDoc = serializeDetailsDoc(task.detailsDoc);
        if (detailsDoc) todo = await api.updateTodo(todo.id, { detailsDoc });
        return mapTodoToTask(todo);
      });
    },

    update(_projectId, previous, next) {
      const body = buildTodoUpdateRequest(previous, next);
      if (Object.keys(body).length === 0) return Promise.resolve(next);
      return runTaskMutation(next.id, async () => mapTodoToTask(await api.updateTodo(next.id, body)));
    },

    remove(_projectId, taskId) {
      return runTaskMutation(taskId, async () => {
        try {
          await api.deleteTodo(taskId);
        } catch (error) {
          if (error instanceof DashboardApiError && error.status === 404) return;
          throw error;
        }
      });
    }
  };

  const projectCommands: ProjectCommands = {
    async remove(projectId) {
      try {
        await api.deleteProject(projectId);
      } catch (error) {
        handleApiError(error);
        if (!(error instanceof DashboardApiError && error.status === 404)) throw error;
      }
      baselineProjects.delete(projectId);
      pendingProjectState = pendingProjectState?.filter((project) => project.id !== projectId) ?? null;
    }
  };

  function scheduleProjectFlush(delay: number): void {
    if (projectPersistTimer) clearTimeout(projectPersistTimer);
    projectPersistTimer = setTimeout(() => {
      projectPersistTimer = null;
      void flushProjectState();
    }, delay);
  }

  async function flushProjectState(): Promise<void> {
    if (projectFlushInFlight || !pendingProjectState) return;
    projectFlushInFlight = true;
    projectRetryNeeded = false;
    const version = projectStateVersion;
    const state = pendingProjectState;

    try {
      for (const project of state) {
        const baseline = baselineProjects.get(project.id);
        if (!baseline || sameTagCatalog(project.tagCatalog, baseline.tagCatalog)) continue;
        try {
          await api.updateProject(project.id, {
            tagCatalog: project.tagCatalog ? JSON.stringify(project.tagCatalog) : ""
          });
          baseline.tagCatalog = cloneTagCatalog(project.tagCatalog);
        } catch (error) {
          handleApiError(error);
          projectRetryNeeded = true;
          if (!(error instanceof DashboardApiError)) return;
        }
      }
    } finally {
      projectFlushInFlight = false;
      if (unauthorizedNotified) return;
      if (projectStateVersion !== version) scheduleProjectFlush(300);
      else if (projectRetryNeeded) scheduleProjectFlush(PROJECT_RETRY_DELAY_MS);
    }
  }

  const platform = createNoopPlatform({
    capabilities: WEB_CAPABILITIES,
    taskCommands,
    projectCommands,

    async loadProjects(): Promise<Project[] | null> {
      try {
        const snapshot = await api.snapshot();
        const projects = mapSnapshotToProjects(snapshot, localOrder);
        alignProjectBaseline(projects);
        pendingProjectState = captureProjectState(projects);
        return projects;
      } catch (error) {
        handleApiError(error);
        return null;
      }
    },

    persistProjects(projects: Project[]): void {
      const order = projects.map((project) => project.id);
      if (JSON.stringify(order) !== JSON.stringify(localOrder)) {
        localOrder = order;
        writeOrder(orderStorageKey, order);
      }
      pendingProjectState = captureProjectState(projects);
      projectStateVersion += 1;
      scheduleProjectFlush(PROJECT_PERSIST_DEBOUNCE_MS);
    },

    subscribeProjects(callback) {
      snapshotSubscriber = callback;
      void pollSnapshot();
      const timer = setInterval(() => void pollSnapshot(), POLL_INTERVAL_MS);
      return () => {
        if (snapshotSubscriber === callback) snapshotSubscriber = null;
        clearInterval(timer);
      };
    },

    async saveImageAsset(taskId, data, mimeType) {
      try {
        return (await api.uploadTodoAsset(taskId, data, mimeType)).asset.id;
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async resolveImageAssetUrl(taskId, assetId) {
      try {
        return URL.createObjectURL(await api.todoAssetBlob(taskId, assetId));
      } catch (error) {
        handleApiError(error);
        if (!(error instanceof DashboardApiError && error.status === 404)) return null;
      }

      // One-time compatibility path: promote an old browser-only asset to the Server.
      const legacy = await getAssetFromDb(assetId).catch(() => null);
      if (!legacy) return null;
      try {
        const bytes = new Uint8Array(await legacy.blob.arrayBuffer());
        const uploaded = await api.uploadTodoAsset(taskId, bytes, legacy.blob.type);
        if (uploaded.asset.id !== assetId) return null;
        return URL.createObjectURL(await api.todoAssetBlob(taskId, assetId));
      } catch (error) {
        handleApiError(error);
        return null;
      }
    },

    async loadConstitution() {
      try {
        return (await api.executionSettings()).constitution;
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async saveConstitution(text) {
      try {
        await api.updateExecutionSettings({ constitution: text });
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async loadLeaderConstitution() {
      try {
        return (await api.executionSettings()).leaderConstitution;
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async saveLeaderConstitution(text) {
      try {
        await api.updateExecutionSettings({ leaderConstitution: text });
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async loadUserPreferences() {
      try {
        return await api.userPreferences();
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async saveUserPreferences(next) {
      try {
        await api.updateUserPreferences(next);
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async loadExecutionSettings() {
      try {
        return await api.executionSettings();
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async saveExecutionSettings(next) {
      try {
        await api.updateExecutionSettings(next);
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async saveRunnerModelSettings(runnerId, next) {
      try {
        const response = await api.updateRunnerModels(runnerId, next);
        void pollSnapshot();
        return {
          defaultWorker: response.runner.defaultWorker ?? null,
          leaderWorker: response.runner.leaderWorker ?? null
        };
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async refreshRunnerTools(runnerId) {
      try {
        await api.createRunnerCommand(runnerId, { type: "refresh_worker_inventory" });
        // 命令下发后执行端会立即重探并上报；稍等一拍让快照带回最新清单。
        setTimeout(() => void pollSnapshot(), 300);
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async loadReminderAudio() {
      try {
        const blob = await api.workspaceReminderAudio();
        return URL.createObjectURL(blob);
      } catch (error) {
        if (error instanceof DashboardApiError && error.status === 404) return null;
        handleApiError(error);
        throw error;
      }
    },

    async saveReminderAudio(file) {
      try {
        const settings = await api.uploadWorkspaceReminderAudio(file.bytes, file.mime, file.name);
        if (!settings.reminderAudioName) return null;
        const blob = await api.workspaceReminderAudio();
        return URL.createObjectURL(blob);
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async removeReminderAudio() {
      try {
        await api.removeWorkspaceReminderAudio();
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async loadDeepSeekConnection() {
      try {
        return await api.deepSeekConnection();
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async connectDeepSeek(apiKey) {
      try {
        const status = await api.connectDeepSeek(apiKey);
        void pollSnapshot();
        return status;
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async disconnectDeepSeek() {
      try {
        const status = await api.disconnectDeepSeek();
        void pollSnapshot();
        return status;
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    // ── models.dev 定价快照（GET /api/model-pricing；失败时静默降级为无成本估算）──
    async loadModelPricing() {
      try {
        const response = await api.modelPricing();
        return response.items.map((item) => ({
          providerId: item.providerId,
          modelId: item.modelId,
          modelName: item.modelName,
          inputUsdPerMillion: item.inputUsdPerMillion,
          reasoningUsdPerMillion: item.reasoningUsdPerMillion,
          outputUsdPerMillion: item.outputUsdPerMillion,
          cacheReadUsdPerMillion: item.cacheReadUsdPerMillion
        }));
      } catch (error) {
        handleApiError(error);
        return [];
      }
    },

    // ── 验收设置（Server 端持久化，GET/PATCH /api/settings/acceptance）──
    async loadAcceptanceSettings() {      try {
        return await api.acceptanceSettings();
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async saveAcceptanceSettings(next) {
      try {
        await api.updateAcceptanceSettings(next);
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    // ── 任务附件（截图;GET /api/todos/:id 与 /api/todos/:id/artifacts/:artifactId）──
    async loadTaskArtifacts(taskId) {
      try {
        const detail = await api.todoDetail(taskId);
        return (detail.artifacts ?? []).map((artifact) => ({
          id: artifact.id,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          createdAt: artifact.createdAt
        }));
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async fetchArtifactBlob(taskId, artifactId, variant) {
      try {
        return await api.artifactBlob(taskId, artifactId, variant);
      } catch (error) {
        handleApiError(error);
        throw error;
      }
    },

    async notify(title: string, body: string): Promise<boolean> {
      if (typeof Notification === "undefined") return false;
      try {
        if (Notification.permission === "default") {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") return false;
        }
        if (Notification.permission !== "granted") return false;
        new Notification(title, { body });
        return true;
      } catch {
        return false;
      }
    }
  });

  return { ...platform, refreshNow: () => pollSnapshot() };
}

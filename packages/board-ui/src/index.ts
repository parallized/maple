export { BoardApp } from "./BoardApp";
export type { BoardAppProps } from "./BoardApp";
export type { SettingsExtraTab } from "./views/SettingsView";
export { PlatformProvider, usePlatform } from "./platform/context";
export { createNoopPlatform, DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from "./platform/noop";
export type {
  BoardPlatform,
  BoardExecutionSettings,
  BoardUserPreferences,
  InstallMeta,
  InstallTaskEvent,
  PlatformCapabilities,
  ProjectCommands,
  RunWorkerRequest,
  TaskCommands,
  Unsubscribe,
  WorkerProbe,
} from "./platform/types";
export * from "./domain";
export { ensureIconifyCollectionsLoaded } from "./lib/iconify";
export { applyUiFont } from "./lib/ui-font";
export { saveAssetToIdb, resolveAssetUrlFromIdb, getAssetFromDb } from "./lib/asset-idb";
export { buildTrayTaskSnapshot } from "./lib/task-tray";
export { buildTrayTaskPalette } from "./lib/tray-palette";
export { buildSidebarWorkers, formatReasoningEffort } from "./lib/worker-sidebar";
export type { SidebarWorkerItem, SidebarWorkerState } from "./lib/worker-sidebar";
export { STORAGE_PROJECTS, WORKER_KINDS, DEFAULT_WORKER_CONFIGS } from "./lib/constants";
export { loadProjects, loadTheme, loadUiLanguage, loadAiLanguage, loadConstitution } from "./lib/storage";
export { normalizeProjects } from "./lib/utils";

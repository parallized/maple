import type { BoardPlatform, PlatformCapabilities } from "./types";

export const WEB_CAPABILITIES: PlatformCapabilities = {
  isDesktop: false,
  canExecuteWorkers: false,
  canInstall: false,
  canPickDirectory: false,
  canOpenPath: false,
  projectSource: "runner",
};

export const DESKTOP_CAPABILITIES: PlatformCapabilities = {
  isDesktop: true,
  canExecuteWorkers: true,
  canInstall: true,
  canPickDirectory: true,
  canOpenPath: true,
  projectSource: "directory",
};

/**
 * 返回所有方法均为安全默认值的 platform,各端按需覆盖。
 * 事件订阅默认返回 no-op;执行类方法默认失败返回。
 */
export function createNoopPlatform(
  overrides: Partial<BoardPlatform> & { capabilities?: Partial<PlatformCapabilities> } = {},
): BoardPlatform {
  const { capabilities, ...rest } = overrides;
  const noopUnsubscribe = () => {};
  const base: BoardPlatform = {
    capabilities: { ...WEB_CAPABILITIES, ...capabilities },
    loadProjects: async () => null,
    persistProjects: () => {},
    loadConstitution: async () => null,
    saveConstitution: async () => {},
    loadLeaderConstitution: async () => null,
    saveLeaderConstitution: async () => {},
    saveImageAsset: async () => {
      throw new Error("当前平台不支持保存图片。");
    },
    resolveImageAssetUrl: async () => null,
    runWorker: async () => ({ success: false, code: null, stdout: "", stderr: "当前环境无法执行 Worker CLI。" }),
    stopWorker: async () => false,
    sendWorkerInput: async () => {},
    probeWorker: async () => ({ success: false, code: null, stdout: "", stderr: "" }),
    onWorkerLog: () => noopUnsubscribe,
    onWorkerDone: () => noopUnsubscribe,
    onTaskUpdated: () => noopUnsubscribe,
    onTagCatalogUpdated: () => noopUnsubscribe,
    onWorkerFinished: () => noopUnsubscribe,
    probeInstallTargets: async () => [],
    installMcpSkills: async () => {},
    getInstallMeta: async () => null,
    onInstallTaskEvent: () => noopUnsubscribe,
    openPath: async () => {},
    openInEditor: async () => {},
    pickDirectory: async () => null,
    notify: async () => false,
    syncTray: (_projects, _theme) => {},
    window: null,
  };
  return { ...base, ...rest, capabilities: { ...base.capabilities, ...capabilities } };
}

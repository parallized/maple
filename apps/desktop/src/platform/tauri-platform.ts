import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import {
  DESKTOP_CAPABILITIES,
  STORAGE_PROJECTS,
  buildTrayTaskPalette,
  buildTrayTaskSnapshot,
  createNoopPlatform,
  loadProjects as loadProjectsFromLocalStorage,
  resolveAssetUrlFromIdb,
  saveAssetToIdb,
} from "@maple/board-ui";
import type {
  BoardPlatform,
  InstallMeta,
  InstallTaskEvent,
  McpTagCatalogUpdatedEvent,
  McpTaskUpdatedEvent,
  McpWorkerFinishedEvent,
  Project,
  Unsubscribe,
  WorkerCommandResult,
  WorkerDoneEvent,
  WorkerLogEvent,
  WorkerProbe,
} from "@maple/board-ui";

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ── 图片资产工具(与旧 lib/maple-assets.ts 的 Tauri 路径逐字对齐)──

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function guessExtensionFromMime(mime: string): string | null {
  const normalized = mime.trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  return null;
}

function mimeFromExt(ext: string): string {
  const normalized = ext.trim().toLowerCase();
  if (normalized === "png") return "image/png";
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "webp") return "image/webp";
  if (normalized === "gif") return "image/gif";
  if (normalized === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** listen 返回 Promise<unlisten>,封装成同步 unsubscribe(disposed 后立即 unlisten)。 */
function subscribeTauriEvent<T>(eventName: string, cb: (payload: T) => void): Unsubscribe {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void listen<T>(eventName, (event) => {
    cb(event.payload);
  }).then((fn) => {
    if (disposed) {
      fn();
    } else {
      unlisten = fn;
    }
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/**
 * 桌面端平台实现:Tauri 运行时走 invoke/listen;vite dev:web 浏览器模式下
 * 项目持久化与图片资产降级到 localStorage / IndexedDB,其余能力保持 noop 安全默认。
 */
export function createTauriPlatform(): BoardPlatform {
  const isTauri = hasTauriRuntime();

  // 双端都有实现的方法(Tauri 文件 / 浏览器本地存储)。
  const sharedOverrides: Partial<BoardPlatform> = {
    loadProjects: async () => {
      if (!isTauri) return loadProjectsFromLocalStorage();
      try {
        const raw = await invoke<string>("read_state_file");
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const parsed = JSON.parse(trimmed) as Project[];
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    persistProjects: (projects) => {
      if (!isTauri) {
        try {
          localStorage.setItem(STORAGE_PROJECTS, JSON.stringify(projects));
        } catch { /* ignore */ }
        return;
      }
      invoke("write_state_file", { json: JSON.stringify(projects) }).catch(() => {});
    },
    loadConstitution: async () => {
      if (!isTauri) return null;
      try {
        return await invoke<string>("read_constitution_file");
      } catch {
        return null;
      }
    },
    saveConstitution: async (text) => {
      if (!isTauri) return;
      await invoke("write_constitution_file", { content: text });
    },
    saveImageAsset: async (_taskId, data, mimeType) => {
      if (!isTauri) return saveAssetToIdb(data, mimeType);
      const bytes = new Uint8Array(data);
      const hash = await sha256Hex(bytes.buffer);
      if (!hash || hash.length !== 64 || !/^[a-f0-9]+$/.test(hash)) {
        throw new Error("图片 hash 计算失败。");
      }
      const ext = guessExtensionFromMime(mimeType) ?? "bin";
      const fileName = `${hash}.${ext}`;
      await invoke("save_asset_file", { fileName, bytesBase64: bytesToBase64(bytes) });
      return fileName;
    },
    resolveImageAssetUrl: async (_taskId, assetId) => {
      if (!isTauri) return resolveAssetUrlFromIdb(assetId);
      const ext = assetId.slice(assetId.lastIndexOf(".") + 1);
      // Strategy 1: base64 data URI(全平台可用,规避 protocol / asset-scope 问题)。
      try {
        const base64 = await invoke<string>("read_asset_file_base64", { fileName: assetId });
        return `data:${mimeFromExt(ext)};base64,${base64}`;
      } catch { /* continue to next strategy */ }
      // Strategy 2: convertFileSrc(可用时更高效)。
      try {
        const filePath = await invoke<string>("get_asset_file_path", { fileName: assetId });
        return convertFileSrc(filePath);
      } catch { /* continue to next strategy */ }
      // Strategy 3: 回退 maple:// 自定义协议。
      return `maple://asset/${assetId}`;
    },
  };

  // 仅 Tauri 运行时可用的能力;浏览器模式保留 noop 安全默认。
  const tauriOverrides: Partial<BoardPlatform> = isTauri
    ? {
        runWorker: (req) => invoke<WorkerCommandResult>("run_worker", req),
        stopWorker: (workerId) => invoke<boolean>("stop_worker_process", { workerId }),
        sendWorkerInput: async (workerId, input) => {
          await invoke("send_worker_input", { workerId, input, appendNewline: true });
        },
        probeWorker: (executable, args, cwd) =>
          invoke<WorkerCommandResult>("probe_worker", { executable, args, cwd }),
        onWorkerLog: (cb) => subscribeTauriEvent<WorkerLogEvent>("maple://worker-log", cb),
        onWorkerDone: (cb) => subscribeTauriEvent<WorkerDoneEvent>("maple://worker-done", cb),
        onTaskUpdated: (cb) => subscribeTauriEvent<McpTaskUpdatedEvent>("maple://task-updated", cb),
        onTagCatalogUpdated: (cb) =>
          subscribeTauriEvent<McpTagCatalogUpdatedEvent>("maple://tag-catalog-updated", cb),
        onWorkerFinished: (cb) =>
          subscribeTauriEvent<McpWorkerFinishedEvent>("maple://worker-finished", cb),
        probeInstallTargets: () => invoke<WorkerProbe[]>("probe_install_targets"),
        installMcpSkills: async (options) => {
          await invoke("install_mcp_skills", { options });
        },
        getInstallMeta: () => invoke<InstallMeta>("get_install_meta"),
        onInstallTaskEvent: (cb) =>
          subscribeTauriEvent<InstallTaskEvent>("maple://install-task-event", cb),
        openPath: async (path) => {
          await invoke("open_path", { path });
        },
        openInEditor: async (path, editorApp) => {
          await invoke("open_in_editor", { path, app: editorApp });
        },
        pickDirectory: async () => {
          const selected = await open({ directory: true, multiple: false });
          return typeof selected === "string" ? selected : null;
        },
        notify: async (title, body) => {
          try {
            let granted = await isPermissionGranted();
            if (!granted) {
              const permission = await requestPermission();
              granted = permission === "granted";
            }
            if (!granted) return false;
            await sendNotification({ title, body });
            return true;
          } catch {
            return false;
          }
        },
        syncTray: (projects, _theme) => {
          const palette = buildTrayTaskPalette();
          const snapshot = buildTrayTaskSnapshot(projects, palette);
          invoke("sync_tray_task_badge", { snapshot }).catch(() => {});
        },
        window: {
          minimize: () => getCurrentWindow().minimize(),
          toggleMaximize: async () => {
            const appWindow = getCurrentWindow();
            const maximized = await appWindow.isMaximized();
            if (maximized) await appWindow.unmaximize();
            else await appWindow.maximize();
            return !maximized;
          },
          close: () => getCurrentWindow().close(),
          isMaximized: () => getCurrentWindow().isMaximized(),
          onResized: (cb) => {
            let disposed = false;
            let unlisten: (() => void) | undefined;
            void getCurrentWindow()
              .onResized(() => {
                if (!disposed) cb();
              })
              .then((fn) => {
                if (disposed) {
                  fn();
                } else {
                  unlisten = fn;
                }
              });
            return () => {
              disposed = true;
              unlisten?.();
            };
          },
        },
      }
    : {};

  return createNoopPlatform({
    capabilities: DESKTOP_CAPABILITIES,
    ...sharedOverrides,
    ...tauriOverrides,
  });
}

import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { hasTauriRuntime } from "./utils";

export const MAPLE_ASSET_URL_PREFIX = "maple://asset/";

export type MapleAssetDescriptor = {
  fileName: string;
  hash: string;
  ext: string;
};

function isLowerHex(value: string): boolean {
  return /^[a-f0-9]+$/.test(value);
}

export function parseMapleAssetUrl(url: string): MapleAssetDescriptor | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith(MAPLE_ASSET_URL_PREFIX)) return null;
  const fileName = trimmed.slice(MAPLE_ASSET_URL_PREFIX.length).trim();
  if (!/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(fileName)) return null;
  const [hash, ext] = fileName.split(".", 2);
  if (!hash || !ext) return null;
  return { fileName, hash, ext };
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

function guessExtensionFromName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const dot = trimmed.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = trimmed.slice(dot + 1).trim().toLowerCase();
  if (!ext || ext.length > 8) return null;
  if (!/^[a-z0-9]+$/.test(ext)) return null;
  return ext;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

type AssetDbRecord = { fileName: string; blob: Blob };

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("maple-assets", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "fileName" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 打开失败"));
  });
}

async function putAssetToDb(record: AssetDbRecord): Promise<void> {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 写入失败"));
    tx.objectStore("files").put(record);
  });
}

async function getAssetFromDb(fileName: string): Promise<AssetDbRecord | null> {
  const db = await openAssetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const req = tx.objectStore("files").get(fileName);
    req.onsuccess = () => resolve((req.result as AssetDbRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 读取失败"));
  });
}

export async function saveImageAsset(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  if (!hash || hash.length !== 64 || !isLowerHex(hash)) {
    throw new Error("图片 hash 计算失败。");
  }

  const ext =
    guessExtensionFromMime(file.type)
    ?? guessExtensionFromName(file.name)
    ?? "bin";

  const fileName = `${hash}.${ext}`;
  const assetUrl = `${MAPLE_ASSET_URL_PREFIX}${fileName}`;

  if (hasTauriRuntime()) {
    const bytesBase64 = arrayBufferToBase64(buffer);
    await invoke("save_asset_file", { fileName, bytesBase64 });
    return assetUrl;
  }

  await putAssetToDb({ fileName, blob: new Blob([buffer], { type: file.type || "application/octet-stream" }) });
  return assetUrl;
}

const resolvedSrcCache = new Map<string, string>();

export async function resolveImageSrc(assetUrl: string): Promise<string | null> {
  const descriptor = parseMapleAssetUrl(assetUrl);
  if (!descriptor) return null;

  const cached = resolvedSrcCache.get(descriptor.fileName);
  if (cached) return cached;

  if (hasTauriRuntime()) {
    // Prefer file URL conversion so WebView can load reliably (img/video/etc).
    try {
      const filePath = await invoke<string>("get_asset_file_path", { fileName: descriptor.fileName });
      const src = convertFileSrc(filePath);
      resolvedSrcCache.set(descriptor.fileName, src);
      return src;
    } catch {
      // Fallback to `maple://asset/...` scheme protocol (older builds / dev setups).
      resolvedSrcCache.set(descriptor.fileName, assetUrl);
      return assetUrl;
    }
  }

  const record = await getAssetFromDb(descriptor.fileName);
  if (!record) return null;
  const src = URL.createObjectURL(record.blob);
  resolvedSrcCache.set(descriptor.fileName, src);
  return src;
}

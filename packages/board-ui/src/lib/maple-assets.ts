import type { BoardPlatform } from "../platform/types";

export const MAPLE_ASSET_URL_PREFIX = "maple://asset/";

export type MapleAssetDescriptor = {
  fileName: string;
  hash: string;
  ext: string;
};

export function parseMapleAssetUrl(url: string): MapleAssetDescriptor | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let fileName = "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "maple:") return null;

    // maple://asset/<filename>
    if (parsed.host === "asset") {
      fileName = parsed.pathname.replace(/^\/+/, "");
    }

    // maple://localhost/asset/<filename> (Windows WebView2 may normalise this way)
    if (parsed.host === "localhost" && parsed.pathname.startsWith("/asset/")) {
      fileName = parsed.pathname.slice("/asset/".length);
    }

    // maple:///asset/<filename> (triple-slash, empty authority)
    if (!parsed.host && parsed.pathname.startsWith("/asset/")) {
      fileName = parsed.pathname.slice("/asset/".length);
    }
  } catch {
    if (trimmed.startsWith(MAPLE_ASSET_URL_PREFIX)) {
      fileName = trimmed.slice(MAPLE_ASSET_URL_PREFIX.length).trim();
    } else {
      return null;
    }
  }

  fileName = fileName.trim().replace(/\/+$/, "");
  if (!/^[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(fileName)) return null;

  const [hash, ext] = fileName.split(".", 2);
  if (!hash || !ext) return null;
  return { fileName, hash, ext };
}

export async function saveImageAsset(platform: BoardPlatform, taskId: string, file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const mimeType = file.type || "application/octet-stream";
  const assetId = await platform.saveImageAsset(taskId, new Uint8Array(buffer), mimeType);
  return `${MAPLE_ASSET_URL_PREFIX}${assetId}`;
}

const resolvedSrcCache = new WeakMap<BoardPlatform, Map<string, string>>();

export async function resolveImageSrc(
  platform: BoardPlatform,
  taskId: string,
  assetUrl: string
): Promise<string | null> {
  const descriptor = parseMapleAssetUrl(assetUrl);
  if (!descriptor) return null;

  const platformCache = resolvedSrcCache.get(platform) ?? new Map<string, string>();
  if (!resolvedSrcCache.has(platform)) resolvedSrcCache.set(platform, platformCache);
  const cacheKey = `${taskId}:${descriptor.fileName}`;
  const cached = platformCache.get(cacheKey);
  if (cached) return cached;

  const src = await platform.resolveImageAssetUrl(taskId, descriptor.fileName);
  if (!src) return null;
  platformCache.set(cacheKey, src);
  return src;
}

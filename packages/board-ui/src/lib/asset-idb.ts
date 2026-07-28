export type AssetDbRecord = { fileName: string; blob: Blob };

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

export async function putAssetToDb(record: AssetDbRecord): Promise<void> {
  const db = await openAssetDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 写入失败"));
    tx.objectStore("files").put(record);
  });
}

export async function getAssetFromDb(fileName: string): Promise<AssetDbRecord | null> {
  const db = await openAssetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const req = tx.objectStore("files").get(fileName);
    req.onsuccess = () => resolve((req.result as AssetDbRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 读取失败"));
  });
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function guessExtensionFromMime(mime: string): string | null {
  const normalized = mime.trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  return null;
}

export function mimeFromExt(ext: string): string {
  const normalized = ext.trim().toLowerCase();
  if (normalized === "png") return "image/png";
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "webp") return "image/webp";
  if (normalized === "gif") return "image/gif";
  if (normalized === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

/** 平台层 saveImageAsset 的 IndexedDB 实现;返回资产 id(引用形如 maple://asset/<id>)。 */
export async function saveAssetToIdb(data: Uint8Array, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(data);
  const hash = await sha256Hex(bytes.buffer);
  if (!hash || hash.length !== 64 || !/^[a-f0-9]+$/.test(hash)) {
    throw new Error("图片 hash 计算失败。");
  }

  const ext = guessExtensionFromMime(mimeType) ?? "bin";
  const fileName = `${hash}.${ext}`;
  await putAssetToDb({ fileName, blob: new Blob([bytes], { type: mimeType || "application/octet-stream" }) });
  return fileName;
}

/** 平台层 resolveImageAssetUrl 的 IndexedDB 实现;返回 blob: URL,不存在返回 null。 */
export async function resolveAssetUrlFromIdb(fileName: string): Promise<string | null> {
  const record = await getAssetFromDb(fileName);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}

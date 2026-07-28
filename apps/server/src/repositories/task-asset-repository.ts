import type { Database } from "bun:sqlite";
import {
  TODO_ASSET_MAX_BYTES,
  type TodoAsset,
  type TodoAssetMimeType
} from "@maple/protocol";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { nowIso } from "../lib/time";

interface TaskAssetRow {
  id: string;
  todo_id: string;
  file_name: string;
  mime_type: TodoAssetMimeType;
  size_bytes: number;
  storage_name: string;
  created_at: string;
}

export class TaskAssetValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 409 | 422 = 422
  ) {
    super(message);
    this.name = "TaskAssetValidationError";
  }
}

function detectImage(bytes: Uint8Array): { mimeType: TodoAssetMimeType; extension: string } | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return { mimeType: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) return { mimeType: "image/webp", extension: "webp" };
  if (bytes.length >= 6) {
    const signature = new TextDecoder().decode(bytes.slice(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") {
      return { mimeType: "image/gif", extension: "gif" };
    }
  }
  return null;
}

function toAsset(row: TaskAssetRow): TodoAsset {
  return {
    id: row.id,
    todoId: row.todo_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at
  };
}

export class TaskAssetRepository {
  private readonly root: string;

  constructor(
    private readonly database: Database,
    dataDir: string
  ) {
    this.root = resolve(dataDir, "todo-assets");
  }

  get(todoId: string, assetId: string): TaskAssetRow | null {
    return this.database
      .query("SELECT * FROM todo_assets WHERE todo_id = ? AND id = ?")
      .get(todoId, assetId) as TaskAssetRow | null;
  }

  async store(todoId: string, file: File): Promise<TodoAsset> {
    if (file.size <= 0 || file.size > TODO_ASSET_MAX_BYTES) {
      throw new TaskAssetValidationError(
        "todo_asset_size_invalid",
        `正文图片大小必须在 1 字节到 ${TODO_ASSET_MAX_BYTES / 1024 / 1024} MB 之间。`
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = detectImage(bytes);
    if (!image) {
      throw new TaskAssetValidationError(
        "todo_asset_type_invalid",
        "正文图片仅支持真实的 PNG、JPEG、WebP 或 GIF 文件。"
      );
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const id = `${hash}.${image.extension}`;
    const existing = this.get(todoId, id);
    if (existing && existsSync(this.storagePath(existing.storage_name))) return toAsset(existing);

    const createdAt = existing?.created_at ?? nowIso();
    const storageName = existing?.storage_name ?? `${crypto.randomUUID()}.${image.extension}`;
    if (!existing) {
      this.database.run(
        `INSERT INTO todo_assets(
           todo_id, id, file_name, mime_type, size_bytes, storage_name, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [todoId, id, id, image.mimeType, bytes.byteLength, storageName, createdAt]
      );
    }

    const finalPath = this.storagePath(storageName);
    const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
    try {
      await mkdir(this.root, { recursive: true });
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      await rename(temporaryPath, finalPath);
    } catch (error) {
      if (!existing) this.database.run("DELETE FROM todo_assets WHERE todo_id = ? AND id = ?", [todoId, id]);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return {
      id,
      todoId,
      fileName: id,
      mimeType: image.mimeType,
      sizeBytes: bytes.byteLength,
      createdAt
    };
  }

  response(todoId: string, assetId: string): Response | null {
    const row = this.get(todoId, assetId);
    if (!row) return null;
    const path = this.storagePath(row.storage_name);
    if (!existsSync(path)) return null;
    return new Response(Bun.file(path), {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": row.mime_type,
        "x-content-type-options": "nosniff"
      }
    });
  }

  storageNamesForProject(projectId: string): string[] {
    return (this.database
      .query(
        `SELECT a.storage_name FROM todo_assets a
         JOIN todos t ON t.id = a.todo_id
         WHERE t.project_id = ?`
      )
      .all(projectId) as Array<{ storage_name: string }>).map((row) => row.storage_name);
  }

  storageNamesForTodo(todoId: string): string[] {
    return (this.database
      .query("SELECT storage_name FROM todo_assets WHERE todo_id = ?")
      .all(todoId) as Array<{ storage_name: string }>).map((row) => row.storage_name);
  }

  async removeStorageFiles(storageNames: string[]): Promise<void> {
    await Promise.all(storageNames.map((storageName) => rm(this.storagePath(storageName), { force: true })));
  }

  private storagePath(storageName: string): string {
    if (!/^[0-9a-f-]+\.(?:png|jpg|webp|gif)$/i.test(storageName)) {
      throw new Error("正文图片存储名无效");
    }
    return join(this.root, storageName);
  }
}

import type { Database } from "bun:sqlite";
import {
  TODO_SCREENSHOT_MAX_BYTES,
  TODO_SCREENSHOT_MAX_COUNT,
  type ScreenshotCompressionPreset,
  type TodoArtifact,
  type TodoScreenshotMimeType
} from "@maple/protocol";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createScreenshotThumbnail,
  normalizeScreenshot,
  screenshotMimeType,
  ScreenshotNormalizationError
} from "../artifacts/screenshot-image";
import { touchRevision } from "../database/revision";
import { nowIso } from "../lib/time";

interface ArtifactRow {
  id: string;
  todo_id: string;
  attempt_id: string;
  kind: "screenshot";
  file_name: string;
  mime_type: TodoScreenshotMimeType;
  size_bytes: number;
  storage_name: string;
  created_at: string;
}

export class ArtifactValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 409 | 422 = 422
  ) {
    super(message);
    this.name = "ArtifactValidationError";
  }
}

function toArtifact(row: ArtifactRow): TodoArtifact {
  return {
    id: row.id,
    todoId: row.todo_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at
  };
}

export class ArtifactRepository {
  private readonly root: string;

  constructor(
    private readonly database: Database,
    dataDir: string
  ) {
    this.root = resolve(dataDir, "artifacts");
  }

  listByTodo(todoId: string): TodoArtifact[] {
    const rows = this.database
      .query("SELECT * FROM todo_artifacts WHERE todo_id = ? ORDER BY created_at ASC, id ASC")
      .all(todoId) as ArtifactRow[];
    return rows.map(toArtifact);
  }

  get(todoId: string, artifactId: string): ArtifactRow | null {
    return this.database
      .query("SELECT * FROM todo_artifacts WHERE id = ? AND todo_id = ?")
      .get(artifactId, todoId) as ArtifactRow | null;
  }

  async storeScreenshot(
    todoId: string,
    attemptId: string,
    file: File,
    compressionPreset: ScreenshotCompressionPreset
  ): Promise<TodoArtifact> {
    if (file.size <= 0 || file.size > TODO_SCREENSHOT_MAX_BYTES) {
      throw new ArtifactValidationError(
        "screenshot_size_invalid",
        `截图大小必须在 1 字节到 ${TODO_SCREENSHOT_MAX_BYTES / 1024 / 1024} MB 之间。`
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = screenshotMimeType(bytes);
    if (!mimeType) {
      throw new ArtifactValidationError("screenshot_type_invalid", "仅支持真实的 PNG、JPEG 或 WebP 截图。");
    }

    let normalized;
    try {
      normalized = await normalizeScreenshot(bytes, file.name, compressionPreset);
    } catch (error) {
      if (error instanceof ScreenshotNormalizationError) {
        throw new ArtifactValidationError("screenshot_decode_invalid", error.message);
      }
      throw error;
    }
    if (normalized.bytes.byteLength <= 0 || normalized.bytes.byteLength > TODO_SCREENSHOT_MAX_BYTES) {
      throw new ArtifactValidationError(
        "screenshot_size_invalid",
        `压缩后的截图必须在 1 字节到 ${TODO_SCREENSHOT_MAX_BYTES / 1024 / 1024} MB 之间。`
      );
    }

    const id = crypto.randomUUID();
    const storageName = `${id}.webp`;
    const createdAt = nowIso();
    const reserve = this.database.transaction(() => {
      const row = this.database
        .query("SELECT COUNT(*) AS count FROM todo_artifacts WHERE attempt_id = ? AND kind = 'screenshot'")
        .get(attemptId) as { count: number };
      if (row.count >= TODO_SCREENSHOT_MAX_COUNT) return false;
      this.database.run(
        `INSERT INTO todo_artifacts(
           id, todo_id, attempt_id, kind, file_name, mime_type, size_bytes, storage_name, created_at
         ) VALUES (?, ?, ?, 'screenshot', ?, ?, ?, ?, ?)`,
        [
          id,
          todoId,
          attemptId,
          normalized.fileName,
          normalized.mimeType,
          normalized.bytes.byteLength,
          storageName,
          createdAt
        ]
      );
      return true;
    });
    if (!reserve.immediate()) {
      throw new ArtifactValidationError(
        "screenshot_limit_reached",
        `每次任务最多上传 ${TODO_SCREENSHOT_MAX_COUNT} 张截图。`,
        409
      );
    }

    const finalPath = this.storagePath(storageName);
    const temporaryPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
    const thumbnail = await createScreenshotThumbnail(normalized.bytes);
    const thumbnailStorageName = thumbnail ? thumbnailName(storageName) : null;
    const thumbnailFinalPath = thumbnailStorageName ? this.storagePath(thumbnailStorageName) : null;
    const thumbnailTemporaryPath = thumbnailFinalPath ? `${thumbnailFinalPath}.${crypto.randomUUID()}.tmp` : null;
    try {
      await mkdir(this.root, { recursive: true });
      await writeFile(temporaryPath, normalized.bytes, { flag: "wx" });
      if (thumbnail && thumbnailTemporaryPath && thumbnailFinalPath) {
        await writeFile(thumbnailTemporaryPath, thumbnail, { flag: "wx" });
      }
      await rename(temporaryPath, finalPath);
      if (thumbnail && thumbnailTemporaryPath && thumbnailFinalPath) {
        await rename(thumbnailTemporaryPath, thumbnailFinalPath);
      }
      touchRevision(this.database);
    } catch (error) {
      this.database.run("DELETE FROM todo_artifacts WHERE id = ?", [id]);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      await rm(finalPath, { force: true }).catch(() => undefined);
      if (thumbnailTemporaryPath) await rm(thumbnailTemporaryPath, { force: true }).catch(() => undefined);
      if (thumbnailFinalPath) await rm(thumbnailFinalPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      id,
      todoId,
      attemptId,
      kind: "screenshot",
      fileName: normalized.fileName,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.bytes.byteLength,
      createdAt
    };
  }

  response(todoId: string, artifactId: string, variant?: "thumb"): Response | null {
    const row = this.get(todoId, artifactId);
    if (!row) return null;
    // 缩略图是可选派生物:老数据没有就回退原图。
    const path = variant === "thumb"
      ? (() => {
          const thumbPath = this.storagePath(thumbnailName(row.storage_name));
          return existsSync(thumbPath) ? thumbPath : this.storagePath(row.storage_name);
        })()
      : this.storagePath(row.storage_name);
    if (!existsSync(path)) return null;
    return new Response(Bun.file(path), {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
        "content-type": variant === "thumb" && path !== this.storagePath(row.storage_name) ? "image/webp" : row.mime_type,
        "x-content-type-options": "nosniff"
      }
    });
  }

  storageNamesForProject(projectId: string): string[] {
    return (this.database
      .query(
        `SELECT a.storage_name FROM todo_artifacts a
         JOIN todos t ON t.id = a.todo_id
         WHERE t.project_id = ?`
      )
      .all(projectId) as Array<{ storage_name: string }>).map((row) => row.storage_name);
  }

  storageNamesForTodo(todoId: string): string[] {
    return (this.database
      .query("SELECT storage_name FROM todo_artifacts WHERE todo_id = ?")
      .all(todoId) as Array<{ storage_name: string }>).map((row) => row.storage_name);
  }

  async removeStorageFiles(storageNames: string[]): Promise<void> {
    await Promise.all(
      storageNames.flatMap((storageName) => [
        rm(this.storagePath(storageName), { force: true }),
        // 派生缩略图一并清理(可能不存在,force 忽略)。
        rm(this.storagePath(thumbnailName(storageName)), { force: true })
      ])
    );
  }

  private storagePath(storageName: string): string {
    if (!/^[0-9a-f-]+(?:\.thumb)?\.(?:png|jpg|webp)$/i.test(storageName)) {
      throw new Error("成果物存储名无效");
    }
    return join(this.root, storageName);
  }
}

/** 原图存储名 → 缩略图存储名(扩展名统一改成 .thumb.webp)。 */
function thumbnailName(storageName: string): string {
  return storageName.replace(/\.(?:png|jpg|webp)$/i, ".thumb.webp");
}

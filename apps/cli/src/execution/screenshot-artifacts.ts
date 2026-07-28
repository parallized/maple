import {
  TODO_SCREENSHOT_MAX_BYTES,
  TODO_SCREENSHOT_MAX_COUNT,
  type TodoArtifact,
  type TodoScreenshotMimeType
} from "@maple/protocol";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, realpath, rmdir, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

export interface LocalScreenshotArtifact {
  path: string;
  fileName: string;
  mimeType: TodoScreenshotMimeType;
  sizeBytes: number;
  bytes: Uint8Array;
}

export interface ScreenshotUploadResult {
  uploaded: TodoArtifact[];
  warnings: string[];
  discovered: number;
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

function scopeName(attemptId: string): string {
  const readable = attemptId.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 48) || "attempt";
  const digest = createHash("sha256").update(attemptId).digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}

async function ensurePlainDirectory(parent: string, segment: string, mapleRoot: string): Promise<string> {
  const path = join(parent, segment);
  try {
    await mkdir(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`截图目录不是普通目录：${path}`);
  }
  const resolved = await realpath(path);
  if (!isInside(mapleRoot, resolved)) throw new Error(`截图目录越出 Maple 数据目录：${path}`);
  return resolved;
}

export async function prepareScreenshotDirectory(mapleDataDirectory: string, attemptId: string): Promise<string> {
  const configuredRoot = resolve(mapleDataDirectory);
  await mkdir(configuredRoot, { recursive: true });
  const mapleRoot = await realpath(configuredRoot);
  const artifactsRoot = await ensurePlainDirectory(mapleRoot, "artifacts", mapleRoot);
  return ensurePlainDirectory(artifactsRoot, scopeName(attemptId), mapleRoot);
}

function detectMimeType(bytes: Uint8Array): TodoScreenshotMimeType | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
    && bytes.at(-2) === 0xff
    && bytes.at(-1) === 0xd9
  ) return "image/jpeg";
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

export async function collectScreenshotArtifacts(directory: string): Promise<{
  artifacts: LocalScreenshotArtifact[];
  warnings: string[];
}> {
  const root = await realpath(directory);
  const entries = (await readdir(root, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const artifacts: LocalScreenshotArtifact[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    if (artifacts.length >= TODO_SCREENSHOT_MAX_COUNT) {
      warnings.push(`截图超过 ${TODO_SCREENSHOT_MAX_COUNT} 张，未上传：${entry.name}`);
      continue;
    }
    const path = join(root, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      warnings.push(`已忽略非普通截图文件：${entry.name}`);
      continue;
    }
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      warnings.push(`已忽略非普通截图文件：${entry.name}`);
      continue;
    }
    if (stat.size <= 0 || stat.size > TODO_SCREENSHOT_MAX_BYTES) {
      warnings.push(`截图大小不符合限制：${entry.name}`);
      continue;
    }
    const resolvedPath = await realpath(path);
    if (!isInside(root, resolvedPath)) {
      warnings.push(`已忽略目录外截图：${entry.name}`);
      continue;
    }
    const bytes = new Uint8Array(await readFile(resolvedPath));
    const mimeType = detectMimeType(bytes);
    if (!mimeType) {
      warnings.push(`截图格式无效：${entry.name}`);
      continue;
    }
    artifacts.push({
      path: resolvedPath,
      fileName: entry.name,
      mimeType,
      sizeBytes: bytes.byteLength,
      bytes
    });
  }
  return { artifacts, warnings };
}

export async function uploadScreenshotArtifacts(
  directory: string,
  upload: (artifact: LocalScreenshotArtifact) => Promise<TodoArtifact>
): Promise<ScreenshotUploadResult> {
  const collected = await collectScreenshotArtifacts(directory);
  const uploaded: TodoArtifact[] = [];
  const warnings = [...collected.warnings];

  for (const artifact of collected.artifacts) {
    try {
      const remote = await upload(artifact);
      uploaded.push(remote);
      try {
        await unlink(artifact.path);
      } catch (error) {
        warnings.push(`截图已上传，但本地文件删除失败：${artifact.fileName}（${error instanceof Error ? error.message : String(error)}）`);
      }
    } catch (error) {
      warnings.push(`截图上传失败，已保留本地文件：${artifact.fileName}（${error instanceof Error ? error.message : String(error)}）`);
    }
  }

  try {
    await access(directory, constants.F_OK);
    if ((await readdir(directory)).length === 0) await rmdir(directory);
  } catch {
    // 目录已被 Worker 清理，或仍有未上传文件；两种情况都不影响任务回传。
  }

  return { uploaded, warnings, discovered: collected.artifacts.length };
}

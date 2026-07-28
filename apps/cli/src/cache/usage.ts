import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { defaultPlaywrightRuntimeDirectory } from "../execution/playwright-runtime";

const MEBIBYTE = 1024 * 1024;

export interface CacheUsage {
  mapleBytes: number;
  playwrightBytes: number;
}

export interface CacheUsagePaths {
  mapleRoot?: string;
  playwrightRoot?: string;
}

function isInside(candidate: string, parent: string): boolean {
  const nested = relative(parent, candidate);
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function directorySize(
  root: string,
  excludedRoots: readonly string[] = []
): Promise<number> {
  const rootPath = resolve(root);
  const exclusions = excludedRoots.map((path) => resolve(path));
  const directories = [rootPath];
  let total = 0;

  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index]!;
    if (exclusions.some((excluded) => isInside(directory, excluded))) continue;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (exclusions.some((excluded) => isInside(path, excluded))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) directories.push(path);
      else if (entry.isFile()) files.push(path);
    }
    total += (await Promise.all(files.map(fileSize))).reduce((sum, size) => sum + size, 0);
  }

  return total;
}

export async function readCacheUsage(paths: CacheUsagePaths = {}): Promise<CacheUsage> {
  const mapleRoot = paths.mapleRoot ?? join(homedir(), ".maple");
  const playwrightRoot = paths.playwrightRoot ?? defaultPlaywrightRuntimeDirectory();
  const [mapleBytes, playwrightBytes] = await Promise.all([
    directorySize(mapleRoot, [playwrightRoot]),
    directorySize(playwrightRoot)
  ]);
  return { mapleBytes, playwrightBytes };
}

function formatMebibytes(bytes: number): string {
  return String(Math.max(0, Math.round(bytes / MEBIBYTE)));
}

export function formatCacheUsage(usage: CacheUsage): string {
  return `缓存 Maple ${formatMebibytes(usage.mapleBytes)} M, Playwright ${formatMebibytes(usage.playwrightBytes)} M`;
}

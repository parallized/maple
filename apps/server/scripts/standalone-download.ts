import { cpSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

export const STANDALONE_DOWNLOAD_MANIFEST = "manifest.txt";
export const STANDALONE_DOWNLOAD_SIZED_MANIFEST = "manifest-v2.txt";

function filesBelow(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...filesBelow(root, path));
    else if (entry.isFile()) files.push(portablePath(relative(root, path)));
  }
  return files;
}

/** Copies the already-built dashboard without recursively copying its downloads directory. */
export function copyStandaloneDashboard(sourceWebRoot: string, downloadRoot: string): void {
  const source = resolve(sourceWebRoot);
  const target = resolve(downloadRoot, "web");
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "downloads") continue;
    cpSync(join(source, entry.name), join(target, entry.name), {
      recursive: entry.isDirectory(),
      dereference: true
    });
  }
}

/** Writes a shell-friendly, sorted list of every portable payload file. */
export function writeStandaloneDownloadManifest(downloadRoot: string): string[] {
  const root = resolve(downloadRoot);
  const manifest = filesBelow(root)
    .filter((path) => path !== STANDALONE_DOWNLOAD_MANIFEST && path !== STANDALONE_DOWNLOAD_SIZED_MANIFEST)
    .sort((left, right) => left.localeCompare(right, "en"));
  writeFileSync(join(root, STANDALONE_DOWNLOAD_MANIFEST), `${manifest.join("\n")}\n`, "utf8");
  const sizedManifest = manifest.map((path) => `${statSync(join(root, path)).size}\t${path}`);
  writeFileSync(
    join(root, STANDALONE_DOWNLOAD_SIZED_MANIFEST),
    `${sizedManifest.join("\n")}\n`,
    "utf8"
  );
  return manifest;
}


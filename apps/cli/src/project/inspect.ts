import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { RegisterProjectRequest, WorkerKind } from "@maple/protocol";
import type { LocalProject } from "../config/types";

function runGit(directory: string, args: string[]): string | null {
  const result = Bun.spawnSync(["git", "-C", directory, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore"
  });
  if (result.exitCode !== 0) return null;
  const output = result.stdout.toString().trim();
  return output || null;
}

function sanitizeRemote(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "file:") return null;
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    if (/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(trimmed)) return null;
    const scpRemote = trimmed.match(/^(?:[^@\s]+@)([^:\s]+):(.+)$/);
    if (scpRemote?.[1] && scpRemote[2]) return `${scpRemote[1]}:${scpRemote[2]}`;
    return trimmed.replace(/^(https?:\/\/)[^/@]+@/i, "$1");
  }
}

function canonicalRemote(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function hash(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

export interface InspectProjectOptions {
  path: string;
  name?: string;
  workerKind: WorkerKind;
  existing?: LocalProject;
}

export function inspectProject(options: InspectProjectOptions): LocalProject {
  const requestedPath = resolve(options.path);
  if (!existsSync(requestedPath) || !statSync(requestedPath).isDirectory()) {
    throw new Error(`项目目录不存在：${requestedPath}`);
  }

  const gitRoot = runGit(requestedPath, ["rev-parse", "--show-toplevel"]);
  const projectPath = resolve(gitRoot ?? requestedPath);
  const repositoryUrl = sanitizeRemote(runGit(projectPath, ["remote", "get-url", "origin"]));
  const gitBranch = runGit(projectPath, ["branch", "--show-current"]);
  const gitHead = runGit(projectPath, ["rev-parse", "HEAD"]);
  const defaultBranch = runGit(projectPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])?.replace(
    /^origin\//,
    ""
  ) ?? null;
  const externalKey = repositoryUrl
    ? `git:${hash(canonicalRemote(repositoryUrl))}`
    : options.existing?.externalKey ?? `local:${crypto.randomUUID()}`;

  return {
    localId: options.existing?.localId ?? crypto.randomUUID(),
    projectId: options.existing?.projectId ?? null,
    bindingId: options.existing?.bindingId ?? null,
    externalKey,
    name: options.name?.trim() || options.existing?.name || basename(projectPath),
    path: projectPath,
    repositoryUrl,
    defaultBranch,
    gitBranch,
    gitHead,
    workerKind: options.workerKind,
    registeredAt: options.existing?.registeredAt ?? null
  };
}

export function toRegistration(project: LocalProject): RegisterProjectRequest {
  return {
    externalKey: project.externalKey,
    name: project.name,
    repositoryUrl: project.repositoryUrl,
    defaultBranch: project.defaultBranch,
    workspaceLabel: basename(project.path),
    gitBranch: project.gitBranch,
    gitHead: project.gitHead
  };
}

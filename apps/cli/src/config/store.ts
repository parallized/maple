import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeStoredRunnerName } from "../runner/runner-name";
import type { CliConfig, LocalProject } from "./types";

export function resolveConfigPath(env: Record<string, string | undefined> = process.env): string {
  if (env.MAPLE_CLI_CONFIG?.trim()) return resolve(env.MAPLE_CLI_CONFIG.trim());
  const root = env.MAPLE_CLI_HOME?.trim() ? resolve(env.MAPLE_CLI_HOME.trim()) : join(homedir(), ".maple");
  return join(root, "cli.json");
}

export function createEmptyConfig(): CliConfig {
  return { version: 1, serverUrl: "", runner: null, projects: [] };
}

function isLocalProject(value: unknown): value is LocalProject {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LocalProject>;
  return (
    typeof item.localId === "string" &&
    typeof item.externalKey === "string" &&
    typeof item.name === "string" &&
    typeof item.path === "string" &&
    typeof item.workerKind === "string"
  );
}

export function loadConfig(path = resolveConfigPath()): CliConfig {
  if (!existsSync(path)) return createEmptyConfig();
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CliConfig>;
  return {
    version: 1,
    serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : "",
    updateIgnoredVersion:
      typeof parsed.updateIgnoredVersion === "string" && parsed.updateIgnoredVersion.trim()
        ? parsed.updateIgnoredVersion
        : undefined,
    runner:
      parsed.runner &&
      typeof parsed.runner.id === "string" &&
      typeof parsed.runner.token === "string" &&
      typeof parsed.runner.name === "string"
        ? {
            ...parsed.runner,
            name: normalizeStoredRunnerName(parsed.runner.name, hostname())
          }
        : null,
    projects: Array.isArray(parsed.projects) ? parsed.projects.filter(isLocalProject) : []
  };
}

export function saveConfig(config: CliConfig, path = resolveConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server 地址必须使用 http:// 或 https://。");
  }
  return url.toString().replace(/\/$/, "");
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function upsertProject(config: CliConfig, project: LocalProject): CliConfig {
  const index = config.projects.findIndex(
    (item) => item.localId === project.localId || samePath(item.path, project.path)
  );
  const projects = [...config.projects];
  if (index >= 0) projects[index] = project;
  else projects.push(project);
  return { ...config, projects };
}

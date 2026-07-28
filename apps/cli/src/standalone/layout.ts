import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_STANDALONE_PORT } from "@maple/server/standalone";

export interface StandaloneLayout {
  root: string;
  serverDataDir: string;
  cliConfigPath: string;
  webRoot: string;
  port: number;
}

function parsePort(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_STANDALONE_PORT;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Maple Local 端口必须在 1 到 65535 之间。");
  }
  return port;
}

function resolveWebRoot(env: Record<string, string | undefined>): string {
  const configured = env.MAPLE_STANDALONE_WEB_ROOT?.trim();
  const candidates = configured
    ? [resolve(configured)]
    : [
        resolve(dirname(process.argv[1] || import.meta.path), "web"),
        resolve(import.meta.dir, "../../../web/dist")
      ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  throw new Error("Maple Local 缺少 WebUI 资源，请重新安装完整版本。");
}

export function resolveStandaloneLayout(
  env: Record<string, string | undefined> = process.env,
  portOverride?: string
): StandaloneLayout {
  const root = resolve(env.MAPLE_STANDALONE_HOME?.trim() || join(homedir(), ".maple", "standalone"));
  return {
    root,
    serverDataDir: join(root, "server"),
    cliConfigPath: join(root, "cli", "cli.json"),
    webRoot: resolveWebRoot(env),
    port: parsePort(portOverride ?? env.MAPLE_STANDALONE_PORT)
  };
}


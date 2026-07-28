import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SESSION_PREFIX = "server-";
const OWNER_FILE = "owner.json";

interface RuntimeOwner {
  pid: number;
  startedAt: string;
}

export interface ServerRuntimeSession {
  runtimeRoot: string;
  sessionRoot: string;
  outputRoot: string;
}

interface RuntimeIdentity {
  now?: number;
  pid?: number;
  nonce?: string;
}

function processIsRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(sessionRoot: string): RuntimeOwner | null {
  try {
    const value = JSON.parse(readFileSync(join(sessionRoot, OWNER_FILE), "utf8")) as Partial<RuntimeOwner>;
    if (!Number.isSafeInteger(value.pid) || (value.pid ?? 0) <= 0) return null;
    return {
      pid: value.pid as number,
      startedAt: typeof value.startedAt === "string" ? value.startedAt : ""
    };
  } catch {
    return null;
  }
}

export function resolveServerRuntimeRoot(
  env: Record<string, string | undefined> = process.env
): string {
  const dataRoot = resolve(env.MAPLE_DATA_DIR?.trim() || join(homedir(), ".maple", "server"));
  return join(dataRoot, "runtime");
}

export function updateServerRuntimeOwner(sessionRoot: string, pid: number): void {
  const owner: RuntimeOwner = {
    pid,
    startedAt: new Date().toISOString()
  };
  writeFileSync(join(sessionRoot, OWNER_FILE), `${JSON.stringify(owner)}\n`, "utf8");
}

export function createServerRuntimeSession(
  env: Record<string, string | undefined> = process.env,
  identity: RuntimeIdentity = {}
): ServerRuntimeSession {
  const runtimeRoot = resolveServerRuntimeRoot(env);
  const pid = identity.pid ?? process.pid;
  const now = identity.now ?? Date.now();
  const nonce = identity.nonce ?? randomUUID().slice(0, 8);
  const sessionRoot = join(runtimeRoot, `${SESSION_PREFIX}${now}-${pid}-${nonce}`);

  mkdirSync(sessionRoot, { recursive: true });
  updateServerRuntimeOwner(sessionRoot, pid);

  return {
    runtimeRoot,
    sessionRoot,
    outputRoot: join(sessionRoot, "deployment")
  };
}

export function cleanupStaleServerRuntimeSessions(
  runtimeRoot: string,
  isRunning: (pid: number) => boolean = processIsRunning
): string[] {
  if (!existsSync(runtimeRoot)) return [];

  const warnings: string[] = [];
  for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(SESSION_PREFIX)) continue;
    const sessionRoot = join(runtimeRoot, entry.name);
    const owner = readOwner(sessionRoot);
    if (owner && isRunning(owner.pid)) continue;

    try {
      rmSync(sessionRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      warnings.push(`${sessionRoot} (${code})`);
    }
  }
  return warnings;
}

export function removeServerRuntimeSession(sessionRoot: string): string | null {
  try {
    rmSync(sessionRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    return `${sessionRoot} (${code})`;
  }
}

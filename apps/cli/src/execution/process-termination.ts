export interface KillableSubprocess {
  readonly pid: number;
  readonly exitCode: number | null;
  kill(signal?: number | NodeJS.Signals): void;
}

const WINDOWS_TREE_KILL_TIMEOUT_MS = 2_000;
const KILLER_SHUTDOWN_TIMEOUT_MS = 250;

/** Windows 必须交给 taskkill 递归终止，否则 node.exe / CLI 包装层的子进程可能继续存活。 */
export function windowsForceKillCommand(pid: number): string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new RangeError(`Invalid process id: ${pid}`);
  return ["taskkill.exe", "/PID", String(pid), "/T", "/F"];
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

function signalSubprocess(subprocess: KillableSubprocess, signal: NodeJS.Signals): void {
  if (subprocess.exitCode !== null) return;
  try {
    subprocess.kill(signal);
  } catch {
    try {
      subprocess.kill();
    } catch {
      // 进程可能恰好已经退出；终止操作保持幂等。
    }
  }
}

/** 请求 Worker 进程树正常收尾；POSIX Worker 会单独建进程组。 */
export function terminateProcessTree(subprocess: KillableSubprocess): void {
  if (subprocess.exitCode !== null) return;
  signalProcessGroup(subprocess.pid, "SIGTERM");
  signalSubprocess(subprocess, "SIGTERM");
}

async function forceKillWindowsProcessTree(pid: number): Promise<void> {
  const killer = Bun.spawn(windowsForceKillCommand(pid), {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore"
  });
  const settled = await settlesWithin(killer.exited, WINDOWS_TREE_KILL_TIMEOUT_MS);
  if (settled) return;
  try {
    killer.kill("SIGKILL");
  } catch {
    killer.kill();
  }
  await settlesWithin(killer.exited, KILLER_SHUTDOWN_TIMEOUT_MS);
}

/**
 * 硬终止整个 Worker 进程树。
 *
 * Windows 使用 taskkill /T /F；POSIX 使用独立进程组的 SIGKILL，并保留对子进程本体的兜底。
 */
export async function forceTerminateProcessTree(subprocess: KillableSubprocess): Promise<void> {
  if (subprocess.exitCode !== null) return;
  if (process.platform === "win32") {
    await forceKillWindowsProcessTree(subprocess.pid).catch(() => undefined);
  } else {
    signalProcessGroup(subprocess.pid, "SIGKILL");
  }
  signalSubprocess(subprocess, "SIGKILL");
}

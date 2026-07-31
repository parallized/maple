export interface KillableSubprocess {
  readonly pid: number;
  readonly exitCode: number | null;
  kill(signal?: number | NodeJS.Signals): void;
}

export interface ReapableSubprocess extends KillableSubprocess {
  readonly exited: Promise<unknown>;
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

/**
 * 给已完成协议交互的 CLI 一个很短的自然退出窗口，然后在后台收掉完整进程树。
 * 调用方可以不等待该 Promise，从而不让 Provider 的慢退出阻塞业务完成。
 */
export async function reapCompletedProcessTree(
  subprocess: ReapableSubprocess,
  graceMs = 250
): Promise<void> {
  if (subprocess.exitCode !== null) return;
  if (await settlesWithin(subprocess.exited, graceMs)) return;
  if (process.platform === "win32") {
    await forceTerminateProcessTree(subprocess);
    await settlesWithin(subprocess.exited, WINDOWS_TREE_KILL_TIMEOUT_MS);
    return;
  }
  terminateProcessTree(subprocess);
  if (await settlesWithin(subprocess.exited, graceMs)) return;
  await forceTerminateProcessTree(subprocess);
  await settlesWithin(subprocess.exited, WINDOWS_TREE_KILL_TIMEOUT_MS);
}

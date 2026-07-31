import { windowsForceKillCommand } from "../execution/process-termination";

export interface PortCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type PortCommandRunner = (
  command: readonly string[]
) => Promise<PortCommandResult | null>;

export type PortProcessSignal = NodeJS.Signals | 0;

export interface LocalPortCleanupOptions {
  platform?: NodeJS.Platform;
  currentPid?: number;
  commandRunner?: PortCommandRunner;
  killProcess?: (pid: number, signal: PortProcessSignal) => void;
  isProcessAlive?: (pid: number) => boolean;
  wait?: (milliseconds: number) => Promise<void>;
  terminateTimeoutMs?: number;
  rescanAttempts?: number;
  rescanDelayMs?: number;
}

export interface LocalPortCleanupResult {
  targetedPids: number[];
  remainingPids: number[];
}

const DEFAULT_TERMINATE_TIMEOUT_MS = 1_000;
const DEFAULT_RESCAN_ATTEMPTS = 3;
const DEFAULT_RESCAN_DELAY_MS = 100;

function uniquePids(pids: Iterable<number>): number[] {
  return [...new Set([...pids].filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
}

function parseEndpointPort(endpoint: string): number | null {
  const match = /:(\d+)$/.exec(endpoint.trim().replace(/\]$/, ""));
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isSafeInteger(port) ? port : null;
}

/** Extracts listening PIDs from the output of Windows netstat. */
export function parseWindowsNetstatListeners(output: string, port: number): number[] {
  const pids: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0]?.toUpperCase() !== "TCP") continue;
    const state = fields[3]?.toUpperCase();
    if (state !== "LISTENING" && state !== "LISTEN") continue;
    if (parseEndpointPort(fields[1] ?? "") !== port) continue;
    const pid = Number(fields[4]);
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
  }
  return uniquePids(pids);
}

/** Extracts the numeric PID lines emitted by `lsof -t`. */
export function parseLsofPids(output: string): number[] {
  return uniquePids(
    output
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
  );
}

/** Extracts PIDs from the `fuser -n tcp <port>` payload. */
export function parseFuserPids(output: string): number[] {
  const separator = output.lastIndexOf(":");
  const payload = separator >= 0 ? output.slice(separator + 1) : output;
  return uniquePids(
    [...payload.matchAll(/\b(\d+)(?:[a-z]+)?\b/gi)].map((match) => Number(match[1]))
  );
}

/** Extracts `pid=...` entries from Linux `ss -ltnp` output. */
export function parseSsPids(output: string): number[] {
  const pids: number[] = [];
  for (const match of output.matchAll(/\bpid=(\d+)\b/g)) {
    const pid = Number(match[1]);
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
  }
  return uniquePids(pids);
}

async function runCommand(command: readonly string[]): Promise<PortCommandResult | null> {
  try {
    const child = Bun.spawn([...command], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe"
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);
    return { exitCode, stdout, stderr };
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function findWindowsPids(
  port: number,
  commandRunner: PortCommandRunner
): Promise<number[]> {
  const result = await commandRunner(["netstat.exe", "-ano", "-p", "tcp"]);
  return result ? parseWindowsNetstatListeners(result.stdout, port) : [];
}

async function findUnixPids(
  port: number,
  commandRunner: PortCommandRunner
): Promise<number[]> {
  const lsof = await commandRunner([
    "lsof",
    "-nP",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-t"
  ]);
  if (lsof) {
    const pids = parseLsofPids(lsof.stdout);
    if (pids.length > 0 || lsof.exitCode === 0) return pids;
  }

  const fuser = await commandRunner(["fuser", "-n", "tcp", String(port)]);
  if (fuser) {
    const pids = uniquePids([
      ...parseFuserPids(fuser.stdout),
      ...parseFuserPids(fuser.stderr)
    ]);
    if (pids.length > 0 || fuser.exitCode === 0) return pids;
  }

  const ss = await commandRunner([
    "ss",
    "-H",
    "-ltnp",
    "sport",
    "=",
    `:${port}`
  ]);
  return ss ? parseSsPids(ss.stdout) : [];
}

async function findPids(
  port: number,
  platform: NodeJS.Platform,
  commandRunner: PortCommandRunner
): Promise<number[]> {
  try {
    return platform === "win32"
      ? await findWindowsPids(port, commandRunner)
      : await findUnixPids(port, commandRunner);
  } catch {
    return [];
  }
}

async function terminateUnixPid(
  pid: number,
  options: Required<Pick<LocalPortCleanupOptions, "killProcess" | "isProcessAlive" | "wait">>
    & Pick<LocalPortCleanupOptions, "terminateTimeoutMs">
): Promise<void> {
  if (!options.isProcessAlive(pid)) return;
  try {
    options.killProcess(pid, "SIGTERM");
  } catch {
    return;
  }

  const timeoutMs = options.terminateTimeoutMs ?? DEFAULT_TERMINATE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (options.isProcessAlive(pid) && Date.now() < deadline) {
    await options.wait(50);
  }
  if (!options.isProcessAlive(pid)) return;
  try {
    options.killProcess(pid, "SIGKILL");
  } catch {
    // The process may have exited between the liveness check and the signal.
  }
}

async function terminatePid(
  pid: number,
  platform: NodeJS.Platform,
  options: Required<Pick<LocalPortCleanupOptions, "commandRunner" | "killProcess" | "isProcessAlive" | "wait">>
    & Pick<LocalPortCleanupOptions, "terminateTimeoutMs">
): Promise<void> {
  if (platform === "win32") {
    const result = await options.commandRunner(windowsForceKillCommand(pid));
    if (result) return;
    try {
      options.killProcess(pid, "SIGKILL");
    } catch {
      // The process may have exited already.
    }
    return;
  }
  await terminateUnixPid(pid, options);
}

function normalizePorts(ports: readonly number[]): number[] {
  const normalized = [...new Set(ports)];
  for (const port of normalized) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new RangeError(`Invalid local service port: ${port}`);
    }
  }
  return normalized;
}

/** Releases stale TCP listeners before the local WebUI and Standalone processes start. */
export async function cleanupLocalPorts(
  ports: readonly number[],
  options: LocalPortCleanupOptions = {}
): Promise<LocalPortCleanupResult> {
  const normalizedPorts = normalizePorts(ports);
  if (normalizedPorts.length === 0) return { targetedPids: [], remainingPids: [] };

  const platform = options.platform ?? process.platform;
  const commandRunner = options.commandRunner ?? runCommand;
  const currentPid = options.currentPid ?? process.pid;
  const killProcess = options.killProcess ?? ((pid: number, signal: PortProcessSignal) => {
    process.kill(pid, signal);
  });
  const isProcessAlive = options.isProcessAlive ?? isAlive;
  const wait = options.wait ?? Bun.sleep;
  const terminateOptions = {
    commandRunner,
    killProcess,
    isProcessAlive,
    wait,
    terminateTimeoutMs: options.terminateTimeoutMs
  };
  const targetedPids = new Set<number>();

  const scan = async (): Promise<number[]> => {
    const found = await Promise.all(
      normalizedPorts.map((port) => findPids(port, platform, commandRunner))
    );
    return uniquePids(found.flat()).filter((pid) => pid !== currentPid);
  };

  for (const pid of await scan()) {
    targetedPids.add(pid);
    await terminatePid(pid, platform, terminateOptions);
  }

  const rescanAttempts = Math.max(0, options.rescanAttempts ?? DEFAULT_RESCAN_ATTEMPTS);
  const rescanDelayMs = Math.max(0, options.rescanDelayMs ?? DEFAULT_RESCAN_DELAY_MS);
  let remainingPids: number[] = [];
  for (let attempt = 0; attempt < rescanAttempts; attempt += 1) {
    if (attempt > 0 && rescanDelayMs > 0) await wait(rescanDelayMs);
    remainingPids = await scan();
    if (remainingPids.length === 0) break;
    for (const pid of remainingPids) {
      targetedPids.add(pid);
      await terminatePid(pid, platform, terminateOptions);
    }
  }
  if (remainingPids.length > 0) {
    if (rescanDelayMs > 0) await wait(rescanDelayMs);
    remainingPids = await scan();
  }

  return {
    targetedPids: [...targetedPids],
    remainingPids
  };
}

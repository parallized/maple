import { join, resolve } from "node:path";
import {
  cleanupStaleServerRuntimeSessions,
  createServerRuntimeSession,
  removeServerRuntimeSession,
  resolveServerRuntimeRoot,
  updateServerRuntimeOwner
} from "./runtime-directory";

type ChildProcess = ReturnType<typeof Bun.spawn>;

const serverRoot = resolve(import.meta.dir, "..");

function serverAddress(env: Record<string, string | undefined>): { displayUrl: string; healthUrl: string } {
  const configuredHost = env.MAPLE_HOST?.trim() || "127.0.0.1";
  const parsedPort = Number.parseInt(env.MAPLE_PORT ?? "", 10);
  const port = Number.isSafeInteger(parsedPort) && parsedPort > 0 ? parsedPort : 45820;
  const healthHost = configuredHost === "0.0.0.0" || configuredHost === "::" ? "127.0.0.1" : configuredHost;
  const urlHost = healthHost.includes(":") ? `[${healthHost}]` : healthHost;
  return {
    displayUrl: `http://${urlHost}:${port}`,
    healthUrl: `http://${urlHost}:${port}/health`
  };
}

async function mapleServerIsRunning(env: Record<string, string | undefined>): Promise<boolean> {
  const { healthUrl } = serverAddress(env);
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(600) });
    if (!response.ok) return false;
    const health = await response.json() as { name?: unknown; status?: unknown };
    return health.name === "maple-server" && health.status === "ok";
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const address = serverAddress(Bun.env);
  if (await mapleServerIsRunning(Bun.env)) {
    console.log(`[maple-server] 已在 ${address.displayUrl} 运行，无需重复启动。`);
    return 0;
  }

  const runtimeRoot = resolveServerRuntimeRoot(Bun.env);
  for (const warning of cleanupStaleServerRuntimeSessions(runtimeRoot)) {
    console.warn(`[maple-server] 暂时无法清理旧运行目录：${warning}`);
  }

  const runtime = createServerRuntimeSession(Bun.env);
  let activeProcess: ChildProcess | null = null;
  let stopping = false;

  const stop = (signal: NodeJS.Signals) => {
    stopping = true;
    if (!activeProcess || activeProcess.exitCode !== null) return;
    try {
      activeProcess.kill(signal);
    } catch {
      // The child may have received the console signal and exited first.
    }
  };
  const stopOnInterrupt = () => stop("SIGINT");
  const stopOnTerminate = () => stop("SIGTERM");
  process.once("SIGINT", stopOnInterrupt);
  process.once("SIGTERM", stopOnTerminate);

  try {
    activeProcess = Bun.spawn([process.execPath, join(serverRoot, "scripts", "build.ts")], {
      cwd: serverRoot,
      env: { ...Bun.env, MAPLE_BUILD_OUTPUT: runtime.outputRoot },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
    });
    const buildExitCode = await activeProcess.exited;
    activeProcess = null;
    if (stopping) return 0;
    if (buildExitCode !== 0) return buildExitCode;

    activeProcess = Bun.spawn([process.execPath, join(runtime.outputRoot, "index.js")], {
      cwd: runtime.outputRoot,
      env: Bun.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
    });
    updateServerRuntimeOwner(runtime.sessionRoot, activeProcess.pid);
    const serverExitCode = await activeProcess.exited;
    activeProcess = null;
    return stopping ? 0 : serverExitCode;
  } finally {
    process.off("SIGINT", stopOnInterrupt);
    process.off("SIGTERM", stopOnTerminate);
    if (activeProcess && activeProcess.exitCode === null) {
      try {
        activeProcess.kill("SIGTERM");
        await activeProcess.exited;
      } catch {
        // Cleanup still proceeds when the process has already exited.
      }
    }
    const warning = removeServerRuntimeSession(runtime.sessionRoot);
    if (warning) console.warn(`[maple-server] 暂时无法清理本次运行目录：${warning}`);
  }
}

process.exitCode = await main();

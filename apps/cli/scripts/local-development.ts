import { join } from "node:path";
import { stringOption } from "../src/args";
import { openBrowser } from "../src/auth/device-authorization";
import { resolveStandalonePort } from "../src/standalone/layout";
import { cleanupLocalPorts } from "../src/standalone/port-cleanup";
import {
  parseStandaloneArgs,
  shouldOpenStandaloneBrowser
} from "../src/standalone/startup";

type ChildProcess = ReturnType<typeof Bun.spawn>;

const WEB_PORT = 5_173;
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface LocalProcessPlan {
  command: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  stdin: "inherit" | "ignore";
  stdout: "inherit";
  stderr: "inherit";
}

export interface LocalDevelopmentPlan {
  prepareWeb: LocalProcessPlan;
  web: LocalProcessPlan;
  standalone: LocalProcessPlan;
  ports: number[];
  webUrl: string;
  serverUrl: string;
  openBrowser: boolean;
}

export interface LocalDevelopmentPlanOptions {
  workspaceRoot: string;
  webRoot: string;
  standaloneEntry: string;
  forwardedArgs: string[];
  env?: Record<string, string | undefined>;
  bunExecutable?: string;
}

function appendAllowedOrigin(value: string | undefined, origin: string): string {
  const origins = value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  return [...new Set([...origins, origin])].join(",");
}

/** Produces a testable launch plan for the two independent reload loops. */
export function createLocalDevelopmentPlan(
  options: LocalDevelopmentPlanOptions
): LocalDevelopmentPlan {
  const env = options.env ?? process.env;
  const bunExecutable = options.bunExecutable ?? process.execPath;
  const args = parseStandaloneArgs(options.forwardedArgs);
  const port = resolveStandalonePort(
    stringOption(args, "port") ?? env.MAPLE_STANDALONE_PORT
  );
  const webUrl = `http://127.0.0.1:${WEB_PORT}`;
  const serverUrl = `http://127.0.0.1:${port}`;

  return {
    prepareWeb: {
      command: [bunExecutable, join(options.webRoot, "scripts", "generate-icon-subset.ts")],
      cwd: options.webRoot,
      env: { ...env },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit"
    },
    web: {
      command: [
        bunExecutable,
        "--bun",
        "vite",
        "--host",
        "127.0.0.1",
        "--port",
        String(WEB_PORT),
        "--strictPort"
      ],
      cwd: options.webRoot,
      env: { ...env, MAPLE_SERVER_PROXY: serverUrl },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit"
    },
    standalone: {
      command: [
        bunExecutable,
        "--watch",
        "--no-clear-screen",
        options.standaloneEntry,
        ...options.forwardedArgs
      ],
      cwd: options.workspaceRoot,
      env: {
        ...env,
        MAPLE_STANDALONE_WEB_ROOT: options.webRoot,
        MAPLE_STANDALONE_DASHBOARD_URL: webUrl,
        MAPLE_STANDALONE_ALLOWED_ORIGINS: appendAllowedOrigin(
          env.MAPLE_STANDALONE_ALLOWED_ORIGINS,
          webUrl
        ),
        MAPLE_STANDALONE_OPEN_BROWSER: "0"
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
    },
    ports: [WEB_PORT, port],
    webUrl,
    serverUrl,
    openBrowser: shouldOpenStandaloneBrowser(env)
  };
}

function spawnProcess(plan: LocalProcessPlan): ChildProcess {
  return Bun.spawn(plan.command, {
    cwd: plan.cwd,
    env: plan.env,
    stdin: plan.stdin,
    stdout: plan.stdout,
    stderr: plan.stderr
  });
}

function signalProcess(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // The process may already have received the terminal signal.
  }
}

async function stopProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  signalProcess(child);
  const stopped = await Promise.race([
    child.exited.then(() => true, () => true),
    Bun.sleep(SHUTDOWN_TIMEOUT_MS).then(() => false)
  ]);
  if (stopped || child.exitCode !== null) return;
  try {
    child.kill("SIGKILL");
    await child.exited;
  } catch {
    // Nothing remains to stop when the process exits between the checks.
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForEndpoint(
  url: string,
  child: ChildProcess,
  signal: AbortSignal,
  timeoutMs: number | null
): Promise<boolean> {
  const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;
  while (!signal.aborted && child.exitCode === null && (deadline === null || Date.now() < deadline)) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(600) });
      if (response.ok) return true;
    } catch {
      // The service is still starting or is waiting for a watched source fix.
    }
    await pause(120, signal);
  }
  return false;
}

async function openHomepageWhenReady(
  plan: LocalDevelopmentPlan,
  standalone: ChildProcess,
  signal: AbortSignal
): Promise<void> {
  if (!await waitForEndpoint(`${plan.serverUrl}/health`, standalone, signal, null)) return;
  /* dev 模式从开发主页进入，而不是直接落看板；主页内提供进入看板的入口。 */
  const homepageUrl = `${plan.webUrl}/`;
  console.log(`[maple-local] 开发主页已就绪：${homepageUrl}`);
  if (!plan.openBrowser || !openBrowser(homepageUrl)) {
    console.log(`[maple-local] 请在浏览器打开：${homepageUrl}`);
  }
}

/** Runs Vite HMR and the watched Standalone runtime as one lifecycle. */
export async function runLocalDevelopment(plan: LocalDevelopmentPlan): Promise<number> {
  const readiness = new AbortController();
  let stopping = false;
  let webPreparation: ChildProcess | null = null;
  let web: ChildProcess | null = null;
  let standalone: ChildProcess | null = null;
  let homepageTask: Promise<void> | null = null;

  const requestStop = () => {
    stopping = true;
    readiness.abort();
    signalProcess(standalone);
    signalProcess(web);
    signalProcess(webPreparation);
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  try {
    const cleanup = await cleanupLocalPorts(plan.ports);
    if (cleanup.targetedPids.length > 0 && cleanup.remainingPids.length === 0) {
      console.log(
        `[maple-local] 已释放开发端口 ${plan.ports.join("、")}，终止进程 ${cleanup.targetedPids.join("、")}。`
      );
    } else if (cleanup.targetedPids.length > 0) {
      console.log(
        `[maple-local] 已尝试清理开发端口 ${plan.ports.join("、")} 的占用进程。`
      );
    }
    if (cleanup.remainingPids.length > 0) {
      console.warn(
        `[maple-local] 开发端口仍被进程 ${cleanup.remainingPids.join("、")} 占用，服务可能无法启动。`
      );
    }
    if (stopping) return 0;

    console.log("[maple-local] [1/2] 正在启动 WebUI 热重载...");
    webPreparation = spawnProcess(plan.prepareWeb);
    const preparationExitCode = await webPreparation.exited;
    if (stopping) return 0;
    if (preparationExitCode !== 0) {
      console.error(`[maple-local] WebUI 准备失败，退出码 ${preparationExitCode}。`);
      return preparationExitCode;
    }
    web = spawnProcess(plan.web);
    if (!await waitForEndpoint(plan.webUrl, web, readiness.signal, STARTUP_TIMEOUT_MS)) {
      if (stopping) return 0;
      const exitCode = web.exitCode;
      console.error(exitCode === null
        ? `[maple-local] WebUI 未能在 ${STARTUP_TIMEOUT_MS / 1_000} 秒内启动。`
        : `[maple-local] WebUI 启动失败，退出码 ${exitCode}。`);
      return exitCode ?? 1;
    }
    console.log("[maple-local] [1/2] WebUI 热重载已就绪。");

    console.log("[maple-local] [2/2] 正在启动 Standalone 自动重载...");
    standalone = spawnProcess(plan.standalone);
    homepageTask = openHomepageWhenReady(plan, standalone, readiness.signal);

    const firstExit = await Promise.race([
      web.exited.then((exitCode) => ({ service: "WebUI", exitCode })),
      standalone.exited.then((exitCode) => ({ service: "Standalone", exitCode }))
    ]);
    if (!stopping && firstExit.exitCode !== 0) {
      console.error(`[maple-local] ${firstExit.service} 已停止，退出码 ${firstExit.exitCode}。`);
    }
    return stopping ? 0 : firstExit.exitCode;
  } finally {
    readiness.abort();
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    await Promise.all([
      stopProcess(standalone),
      stopProcess(web),
      stopProcess(webPreparation)
    ]);
    if (homepageTask) await homepageTask;
  }
}

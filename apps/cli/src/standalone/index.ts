import type { HealthResponse } from "@maple/protocol";
import { startStandaloneServer } from "@maple/server/standalone";
import { stringOption } from "../args";
import { openBrowser } from "../auth/device-authorization";
import { connectCommand, projectCommand, statusCommand } from "../commands";
import { ensureRuntimeLayout, runtimeEnvironment } from "../runtime/layout";
import { runRuntimeMcpServer } from "../runtime/mcp-server";
import { runTui } from "../tui/app";
import { provisionStandaloneCli } from "./bootstrap";
import { resolveStandaloneLayout } from "./layout";
import { parseStandaloneArgs } from "./startup";

const argv = process.argv.slice(2);
const args = parseStandaloneArgs(argv);

function printStandaloneHelp(): void {
  console.log(`Maple Local

本地一体版会在当前电脑内启动 Server、WebUI 与 Runner，不连接外部服务，也不需要账户登录。

用法：
  maple-local                         启动本地看板并直接运行 Runner
  maple-local tui                     打开本地管理菜单
  maple-local connect                 直接运行本地 Runner
  maple-local connect --project <目录>  添加项目并运行
  maple-local project add <目录>      添加本地项目
  maple-local project list            查看本地项目
  maple-local status                  查看本地配置
  maple-local update                  更新到服务器上的最新版本

选项：
  --port <端口>                       本地服务端口，默认 45821
`);
}

async function runningStandalone(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(600) });
    if (!response.ok) return false;
    const health = await response.json() as Partial<HealthResponse>;
    return health.name === "maple-server"
      && health.status === "ok"
      && health.deploymentMode === "standalone";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const runtime = ensureRuntimeLayout();
  Object.assign(process.env, runtimeEnvironment(runtime));

  if (args.command === "mcp") {
    await runRuntimeMcpServer();
    return;
  }
  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    printStandaloneHelp();
    return;
  }

  const layout = resolveStandaloneLayout(process.env, stringOption(args, "port"));
  const url = `http://127.0.0.1:${layout.port}`;
  if (await runningStandalone(url)) {
    if (argv.length === 0 || args.command === "tui" || args.command === "connect") {
      openBrowser(url);
      console.log(`[maple-local] 已在运行：${url}`);
      return;
    }
    if (args.command === "status") statusCommand(layout.cliConfigPath);
    else if (args.command === "project") await projectCommand(args, layout.cliConfigPath);
    else throw new Error(`未知命令：${args.command}。运行 maple-local help 查看用法。`);
    return;
  }

  const server = await startStandaloneServer({
    dataDir: layout.serverDataDir,
    webRoot: layout.webRoot,
    port: layout.port
  });
  provisionStandaloneCli(server, layout.cliConfigPath);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    if (argv.length === 0) {
      openBrowser(server.url);
      await runTui(layout.cliConfigPath, {
        fixedServerUrl: server.url,
        standalone: true,
        autoConnect: true
      });
    } else if (args.command === "tui") {
      openBrowser(server.url);
      await runTui(layout.cliConfigPath, { fixedServerUrl: server.url, standalone: true });
    } else if (args.command === "connect") {
      openBrowser(server.url);
      await connectCommand(
        { ...args, options: { ...args.options, server: server.url } },
        layout.cliConfigPath,
        controller.signal,
        { allowBrowserAuthorization: false }
      );
    } else if (args.command === "project") {
      await projectCommand(args, layout.cliConfigPath);
    } else if (args.command === "status") {
      statusCommand(layout.cliConfigPath);
    } else {
      throw new Error(`未知命令：${args.command}。运行 maple-local help 查看用法。`);
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    server.stop();
  }
}

try {
  await main();
} catch (error) {
  console.error(`[maple-local] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

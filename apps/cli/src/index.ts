import { parseCliArgs } from "./args";
import {
  connectCommand,
  printHelp,
  projectCommand,
  statusCommand
} from "./commands";
import { resolveConfigPath } from "./config/store";
import { runTui } from "./tui/app";
import { ensureRuntimeLayout, runtimeEnvironment } from "./runtime/layout";
import { runRuntimeMcpServer } from "./runtime/mcp-server";

const argv = process.argv.slice(2);
const args = parseCliArgs(argv);
const configPath = resolveConfigPath();
const runtime = ensureRuntimeLayout();
Object.assign(process.env, runtimeEnvironment(runtime));

async function runCommand(): Promise<void> {
  const controller = new AbortController();
  const stop = () => {
    if (!controller.signal.aborted) {
      console.log("\n[maple] 正在停止…");
      controller.abort();
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    if (args.command === "mcp") await runRuntimeMcpServer();
    else if (args.command === "connect") await connectCommand(args, configPath, controller.signal);
    else if (args.command === "project") await projectCommand(args, configPath);
    else if (args.command === "status") statusCommand(configPath);
    else if (args.command === "help" || args.command === "--help" || args.command === "-h") printHelp();
    else throw new Error(`未知命令：${args.command}。运行 maple help 查看用法。`);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

try {
  // 无参数或显式 tui：进入交互界面；其余走经典命令模式。
  if (argv.length === 0 || args.command === "tui") await runTui(configPath);
  else await runCommand();
} catch (error) {
  console.error(`[maple] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

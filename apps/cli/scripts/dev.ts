import { homedir } from "node:os";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dir, "../../..");
const cliEntry = join(workspaceRoot, "apps/cli/src/index.ts");
const forwardedArgs = process.argv.slice(2);
const defaultCliHome = join(homedir(), ".maple", "cli-dev");

if (forwardedArgs.includes("--help") || forwardedArgs.includes("-h")) {
  console.log(`Maple 开发执行端

用法：
  bun dev                             首次运行打开浏览器授权，之后复用凭据
  bun dev --project <目录>            绑定其他项目目录
  bun dev --server <URL>              连接其他开发 Server

默认值：
  Server   http://127.0.0.1:45820
  项目     ${workspaceRoot}
  配置     ${join(defaultCliHome, "cli.json")}
`);
  process.exit(0);
}

const cliHome = process.env.MAPLE_CLI_HOME?.trim() || defaultCliHome;
const child = Bun.spawn(
  [
    "bun",
    cliEntry,
    "connect",
    "--server",
    "http://127.0.0.1:45820",
    "--project",
    workspaceRoot,
    ...forwardedArgs
  ],
  {
    cwd: workspaceRoot,
    env: { ...process.env, MAPLE_CLI_HOME: cliHome },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  }
);

function stop() {
  child.kill();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const exitCode = await child.exited;
process.removeListener("SIGINT", stop);
process.removeListener("SIGTERM", stop);
process.exitCode = exitCode;

import { join, resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dir, "../../..");
const webRoot = join(workspaceRoot, "apps", "web");
const webOutput = join(webRoot, "dist");
const entry = join(workspaceRoot, "apps", "cli", "src", "standalone", "index.ts");
const forwarded = process.argv.slice(2);
const needsWeb = !forwarded.some((argument) => argument === "help" || argument === "--help" || argument === "-h" || argument === "mcp");

if (needsWeb) {
  console.log("[maple-local] 正在启动本地看板…");
  const build = Bun.spawn(["bun", "run", "build"], {
    cwd: webRoot,
    env: Bun.env,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe"
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text()
  ]);
  if (exitCode !== 0) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(exitCode);
  }
}

const child = Bun.spawn(["bun", entry, ...forwarded], {
  cwd: workspaceRoot,
  env: { ...Bun.env, MAPLE_STANDALONE_WEB_ROOT: webOutput },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
});

const stop = () => child.kill("SIGTERM");
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const exitCode = await child.exited;
process.removeListener("SIGINT", stop);
process.removeListener("SIGTERM", stop);
process.exitCode = exitCode;

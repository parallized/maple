import { cpSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const cliRoot = resolve(import.meta.dir, "..");
const workspaceRoot = resolve(cliRoot, "../..");
const webRoot = join(workspaceRoot, "apps", "web");
const outputRoot = resolve(process.env.MAPLE_STANDALONE_BUILD_OUTPUT?.trim() || join(cliRoot, "dist", "standalone"));
const stagingRoot = `${outputRoot}.building-${process.pid}`;
const retiredRoot = `${outputRoot}.retired-${process.pid}`;
const sharpRoot = realpathSync(join(workspaceRoot, "apps", "server", "node_modules", "sharp"));
const sharpNativeRoot = join(dirname(sharpRoot), "@img");

function assertManagedBuildPath(path: string): void {
  const relative = path.slice(cliRoot.length);
  if (!path.startsWith(`${cliRoot}${process.platform === "win32" ? "\\" : "/"}`) || !relative.includes("dist")) {
    throw new Error(`Refusing to replace an unmanaged Standalone build path: ${path}`);
  }
}

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: Bun.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
}

assertManagedBuildPath(stagingRoot);
assertManagedBuildPath(outputRoot);
rmSync(stagingRoot, { recursive: true, force: true });
rmSync(retiredRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });

try {
  await run(["bun", "run", "icons"], webRoot);
  await Promise.all([
    run([
      "bun",
      "build",
      "src/standalone/index.ts",
      "--target",
      "bun",
      "--outfile",
      join(stagingRoot, "maple-local.js"),
      "--banner",
      "#!/usr/bin/env bun"
    ], cliRoot),
    run(["bun", "run", "vite", "build", "--outDir", join(stagingRoot, "web"), "--emptyOutDir"], webRoot)
  ]);

  if (!existsSync(sharpNativeRoot)) throw new Error(`Sharp native dependencies are missing: ${sharpNativeRoot}`);
  cpSync(sharpNativeRoot, join(stagingRoot, "node_modules", "@img"), { recursive: true, dereference: true });

  if (!existsSync(join(stagingRoot, "maple-local.js")) || !existsSync(join(stagingRoot, "web", "index.html"))) {
    throw new Error("Maple Local build is incomplete.");
  }

  if (existsSync(outputRoot)) renameSync(outputRoot, retiredRoot);
  try {
    renameSync(stagingRoot, outputRoot);
  } catch (error) {
    if (existsSync(retiredRoot)) renameSync(retiredRoot, outputRoot);
    throw error;
  }
  rmSync(retiredRoot, { recursive: true, force: true });
  console.log(`[maple-local] complete distribution: ${outputRoot}`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}


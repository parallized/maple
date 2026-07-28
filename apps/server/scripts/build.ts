import { cpSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  cleanupRetiredBuilds,
  createBuildStagingRoot,
  discardBuildStagingRoot,
  prepareBuildStagingRoot,
  publishBuildDirectory
} from "./build-output";
import { copyStandaloneDashboard, writeStandaloneDownloadManifest } from "./standalone-download";

const serverRoot = resolve(import.meta.dir, "..");
const webRoot = resolve(serverRoot, "../web");
const outputRoot = resolve(process.env.MAPLE_BUILD_OUTPUT?.trim() || join(serverRoot, "dist"));
const stagingRoot = createBuildStagingRoot(outputRoot);
const webOutputRoot = join(stagingRoot, "web");
const downloadsRoot = join(webOutputRoot, "downloads");
const standaloneDownloadRoot = join(downloadsRoot, "maple-local");
const cliRoot = resolve(serverRoot, "../cli");
const workspaceRoot = resolve(serverRoot, "../..");
const sharpRoot = realpathSync(join(serverRoot, "node_modules", "sharp"));
const sharpNativeRoot = join(dirname(sharpRoot), "@img");
const sharpNativeOutputRoot = join(stagingRoot, "node_modules", "@img");

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    env: Bun.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
}

prepareBuildStagingRoot(stagingRoot);

try {
  await run(["bun", "run", "icons"], webRoot);
  await Promise.all([
    run(["bun", "build", "src/index.ts", "--target", "bun", "--outfile", join(stagingRoot, "index.js")], serverRoot),
    run(["bun", "run", "vite", "build", "--outDir", webOutputRoot, "--emptyOutDir"], webRoot)
  ]);

  mkdirSync(standaloneDownloadRoot, { recursive: true });
  await Promise.all([
    run(["bun", "build", "src/index.ts", "--target", "bun", "--outfile", join(downloadsRoot, "maple-cli.js")], cliRoot),
    run([
      "bun",
      "build",
      "src/standalone/index.ts",
      "--target",
      "bun",
      "--outfile",
      join(standaloneDownloadRoot, "maple-local.js")
    ], cliRoot)
  ]);
  copyStandaloneDashboard(webOutputRoot, standaloneDownloadRoot);
  writeStandaloneDownloadManifest(standaloneDownloadRoot);
  cpSync(join(workspaceRoot, "scripts", "maple-install.ps1"), join(webOutputRoot, "install.ps1"));
  cpSync(join(workspaceRoot, "scripts", "maple-install.sh"), join(webOutputRoot, "install.sh"));
  cpSync(join(workspaceRoot, "scripts", "maple-local-install.ps1"), join(webOutputRoot, "install-local.ps1"));
  cpSync(join(workspaceRoot, "scripts", "maple-local-install.sh"), join(webOutputRoot, "install-local.sh"));

  if (!existsSync(sharpNativeRoot)) {
    throw new Error(`Sharp native dependencies are missing: ${sharpNativeRoot}`);
  }
  cpSync(sharpNativeRoot, sharpNativeOutputRoot, { recursive: true, dereference: true });

  const serverEntry = join(stagingRoot, "index.js");
  const dashboardEntry = join(webOutputRoot, "index.html");
  const standaloneEntry = join(standaloneDownloadRoot, "maple-local.js");
  const standaloneManifest = join(standaloneDownloadRoot, "manifest.txt");
  if (
    !existsSync(serverEntry)
    || !existsSync(dashboardEntry)
    || !existsSync(standaloneEntry)
    || !existsSync(standaloneManifest)
  ) {
    throw new Error("Maple Server build is incomplete: Server entry or dashboard entry is missing.");
  }

  const retiredWarning = publishBuildDirectory(stagingRoot, outputRoot);
  if (retiredWarning) {
    console.warn(`[maple-server] previous deployment is still in use and will be cleaned later: ${retiredWarning}`);
  }
  for (const warning of cleanupRetiredBuilds(outputRoot)) {
    console.warn(`[maple-server] previous deployment is still in use and will be cleaned later: ${warning}`);
  }
  console.log(`[maple-server] complete deployment: ${outputRoot}`);
} finally {
  if (existsSync(stagingRoot)) {
    try {
      discardBuildStagingRoot(stagingRoot);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
      console.warn(`[maple-server] unable to remove incomplete staging directory (${code}): ${stagingRoot}`);
    }
  }
}

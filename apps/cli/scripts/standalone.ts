import { join, resolve } from "node:path";
import { isStandaloneDevelopmentCommand } from "../src/standalone/startup";
import {
  createLocalDevelopmentPlan,
  runLocalDevelopment
} from "./local-development";

const workspaceRoot = resolve(import.meta.dir, "../../..");
const webRoot = join(workspaceRoot, "apps", "web");
const entry = join(workspaceRoot, "apps", "cli", "src", "standalone", "index.ts");
const forwarded = process.argv.slice(2);

async function runOnce(): Promise<number> {
  const child = Bun.spawn([process.execPath, entry, ...forwarded], {
    cwd: workspaceRoot,
    env: { ...Bun.env, MAPLE_STANDALONE_WEB_ROOT: webRoot },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  const stop = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await child.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

process.exitCode = isStandaloneDevelopmentCommand(forwarded)
  ? await runLocalDevelopment(createLocalDevelopmentPlan({
      workspaceRoot,
      webRoot,
      standaloneEntry: entry,
      forwardedArgs: forwarded,
      env: Bun.env
    }))
  : await runOnce();

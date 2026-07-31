import { createHash } from "node:crypto";

function runGit(directory: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", directory, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore"
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

export interface ProjectManagerSnapshot {
  /** A tiny stable value used only to decide whether a manager session can continue. */
  stableContext: string;
  /** A tiny human-readable state hint; it intentionally contains no file list or source. */
  workingState: string;
}

/**
 * Build only the metadata the Leader needs for routing.
 * The Worker, not the Leader, owns repository rules, Skills, MCP and source inspection.
 */
export function inspectProjectForManager(directory: string): ProjectManagerSnapshot {
  const branch = runGit(directory, ["branch", "--show-current"]) || "detached";
  const head = runGit(directory, ["rev-parse", "--short", "HEAD"]) || "unknown";
  const status = runGit(directory, ["status", "--short"]);
  const statusFingerprint = createHash("sha256").update(status).digest("hex").slice(0, 8);
  const changedFiles = status ? status.split(/\r?\n/).filter(Boolean).length : 0;

  return {
    stableContext: `项目已绑定；Git ${branch}@${head}；上下文指纹 ${statusFingerprint}。`,
    workingState: `工作区摘要：${changedFiles} 个文件有变化；无需读取源码。`
  };
}

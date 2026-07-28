import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_FILE_CHARS = 12_000;
const MAX_TRACKED_FILES = 600;
const MAX_SOURCE_EXCERPT_CHARS = 24_000;
const CONTEXT_FILES = ["AGENTS.md", "README.md", "package.json", "Cargo.toml", "pyproject.toml", "go.mod"];
const SOURCE_EXTENSION = /\.(?:c|cc|cpp|cs|go|h|hpp|java|js|jsx|kt|mjs|py|rs|svelte|ts|tsx|vue)$/i;

function runGit(directory: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", directory, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore"
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

function readBounded(path: string): string {
  if (!existsSync(path)) return "";
  try {
    const content = readFileSync(path, "utf8");
    return content.length <= MAX_FILE_CHARS
      ? content.trim()
      : `${content.slice(0, MAX_FILE_CHARS).trim()}\n[内容已截断]`;
  } catch {
    return "";
  }
}

export interface ProjectManagerSnapshot {
  stableContext: string;
  workingState: string;
}

function selectSourceExcerpts(directory: string, tracked: string[], status: string, query: string): string {
  const changedFiles = new Set(
    status
      .split(/\r?\n/)
      .map((line) => line.slice(3).split(" -> ").at(-1)?.trim() ?? "")
      .filter(Boolean)
  );
  const terms = query.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const candidates = tracked
    .filter((path) => SOURCE_EXTENSION.test(path) && !/(^|\/)(?:dist|build|target|vendor|generated)(\/|$)/i.test(path))
    .map((path) => ({
      path,
      score: (changedFiles.has(path) ? 100 : 0)
        + terms.reduce((total, term) => total + (path.toLowerCase().includes(term) ? 10 : 0), 0)
    }))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 8);
  const excerpts: string[] = [];
  let used = 0;
  for (const candidate of candidates) {
    const content = readBounded(join(directory, candidate.path)).slice(0, 4_000);
    if (!content) continue;
    const excerpt = `### ${candidate.path}\n${content}`;
    if (used + excerpt.length > MAX_SOURCE_EXCERPT_CHARS) break;
    excerpts.push(excerpt);
    used += excerpt.length;
  }
  return excerpts.length > 0 ? excerpts.join("\n\n") : "（没有可用的源码摘录）";
}

/** 只使用本机只读操作，为项目经理构造可缓存的稳定前缀。 */
export function inspectProjectForManager(directory: string, taskQuery = ""): ProjectManagerSnapshot {
  const tracked = runGit(directory, ["ls-files"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_TRACKED_FILES);
  const contextFiles = CONTEXT_FILES.flatMap((relativePath) => {
    const content = readBounded(join(directory, relativePath));
    return content ? [`## ${relativePath}\n${content}`] : [];
  });
  const stableContext = [
    "项目规则与入口文件：",
    contextFiles.length > 0 ? contextFiles.join("\n\n") : "（没有找到根目录规则或入口说明）",
    "",
    `受版本控制的文件（最多 ${MAX_TRACKED_FILES} 个）：`,
    tracked.length > 0 ? tracked.join("\n") : "（当前目录没有可读取的 Git 文件清单）"
  ].join("\n");
  const status = runGit(directory, ["status", "--short"]);
  const diffStat = runGit(directory, ["diff", "--stat"]);
  const sourceExcerpts = selectSourceExcerpts(directory, tracked, status, taskQuery);
  return {
    stableContext,
    workingState: [
      "当前工作区状态：",
      status || "工作区没有 Git 状态变化。",
      diffStat ? `\n当前差异统计：\n${diffStat}` : "",
      `\n与当前任务优先相关的只读源码摘录：\n${sourceExcerpts}`
    ].join("\n")
  };
}

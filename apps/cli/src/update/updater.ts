import { existsSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 托管安装的 CLI 入口：安装脚本固定写入 ~/.maple/bin/maple-cli.js。 */
export function managedCliPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.MAPLE_CLI_HOME?.trim() ? resolve(env.MAPLE_CLI_HOME.trim()) : join(homedir(), ".maple");
  return join(root, "bin", "maple-cli.js");
}

/** 简单语义化版本比较：逐段比较 x.y.z 数字，缺段按 0 处理，忽略 v 前缀。 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((part) => {
        const number = Number.parseInt(part, 10);
        return Number.isNaN(number) ? 0 : number;
      });
  const left = parse(current);
  const right = parse(latest);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const currentPart = left[index] ?? 0;
    const latestPart = right[index] ?? 0;
    if (currentPart !== latestPart) return latestPart > currentPart;
  }
  return false;
}

/**
 * 从 Server 读取最新 CLI 版本清单（{server}/downloads/maple-cli-version.json）。
 * 清单缺失、格式不对或网络失败时静默返回 null，不影响 TUI 正常使用。
 */
export async function fetchLatestCliVersion(
  serverUrl: string,
  timeoutMs = 3_000
): Promise<string | null> {
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/downloads/maple-cli-version.json`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) return null;
    const manifest = await response.json() as { version?: unknown };
    if (typeof manifest.version !== "string" || !manifest.version.trim()) return null;
    return manifest.version.trim();
  } catch {
    return null;
  }
}

export interface CliUpdateResult {
  ok: boolean;
  message: string;
}

/** 下载 Server 上的最新 CLI 并替换托管安装文件；非托管安装时直接提示。 */
export async function applyCliUpdate(serverUrl: string): Promise<CliUpdateResult> {
  const target = managedCliPath();
  if (!existsSync(target)) {
    return {
      ok: false,
      message: "当前不是托管安装（未找到 ~/.maple/bin/maple-cli.js），无法自动更新"
    };
  }
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/downloads/maple-cli.js`, {
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) return { ok: false, message: `下载更新失败（HTTP ${response.status}）。` };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 10_000) return { ok: false, message: "下载的 CLI 文件不完整，已中止更新。" };
    const temporaryPath = `${target}.download`;
    writeFileSync(temporaryPath, bytes, { mode: 0o700 });
    renameSync(temporaryPath, target);
    return { ok: true, message: "更新完成，重启后生效。" };
  } catch (error) {
    return {
      ok: false,
      message: `更新失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/** 底部版本行的新版本提示文案。 */
export function updateHintText(latestVersion: string): string {
  return `按 CTRL + U 更新 至 v${latestVersion}，CTRL + P 忽略本次更新`;
}

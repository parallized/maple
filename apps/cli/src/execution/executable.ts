import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type ExecutableResolver = (executable: string) => string | null;

function bunWhich(executable: string): string | null {
  try {
    return Bun.which(executable);
  } catch {
    return null;
  }
}

/**
 * 将 PATH 中的命令（Windows 上通常是 npm 生成的 .cmd）解析为可直接启动的路径。
 * 带目录的自定义命令不在 PATH 时，仍允许使用本机已存在的相对或绝对路径。
 */
export function resolveExecutablePath(
  executable: string,
  resolver: ExecutableResolver = bunWhich
): string | null {
  const candidate = executable.trim();
  if (!candidate) return null;

  try {
    const found = resolver(candidate);
    if (found) return found;
  } catch {
    // 继续检查显式文件路径。
  }

  if ((candidate.includes("/") || candidate.includes("\\")) && existsSync(candidate)) {
    return resolve(candidate);
  }
  return null;
}

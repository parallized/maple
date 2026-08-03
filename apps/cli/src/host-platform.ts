import { readFileSync } from "node:fs";

/**
 * 本机平台标识，形如 win32/x64、darwin/arm64、linux/ubuntu/x64。
 * Linux 下从 /etc/os-release 读取发行版 ID，便于看板识别发行版图标；
 * 读取失败时退化为 linux/x64。
 */
export function hostPlatform(): string {
  const arch = process.arch;
  if (process.platform !== "linux") return `${process.platform}/${arch}`;
  let id = "";
  try {
    const osRelease = readFileSync("/etc/os-release", "utf8");
    const matched = osRelease.match(/^ID=(.*)$/m);
    if (matched) {
      id = matched[1]!.trim().replace(/^"|"$/g, "").toLowerCase();
    }
  } catch {
    // /etc/os-release 不可读时按纯 linux 处理。
  }
  return id ? `linux/${id}/${arch}` : `linux/${arch}`;
}

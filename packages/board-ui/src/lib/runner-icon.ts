/** Runner 主机平台对应的系统图标（彩色 logos；未知平台回退 mingcute 电脑图标）。
    侧栏 Runner 区块与概览「已连接 Worker」列表共用，保持两处图标一致。 */
export function runnerPlatformIcon(platform: string): string {
  const value = platform.toLowerCase();
  if (value.includes("win")) return "logos:microsoft-windows-icon";
  if (value.includes("darwin") || value.includes("mac")) return "logos:apple";
  if (value.includes("linux")) return "logos:linux-tux";
  return "mingcute:computer-line";
}

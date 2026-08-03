/** Runner 主机平台对应的系统图标（彩色 logos；未知平台回退 mingcute 电脑图标）。
    侧栏 Runner 区块与概览「已连接 Worker」列表共用，保持两处图标一致。 */
export function runnerPlatformIcon(platform: string): string {
  const value = platform.toLowerCase();
  // darwin 含 "win" 子串，必须优先于 windows 判断。
  if (value.includes("darwin") || value.includes("mac")) return "logos:apple";
  if (value.includes("win")) return "logos:microsoft-windows-icon";
  if (value.includes("linux")) {
    if (value.includes("ubuntu")) return "logos:ubuntu";
    if (value.includes("fedora")) return "logos:fedora";
    if (value.includes("arch")) return "logos:archlinux";
    if (value.includes("debian")) return "logos:debian";
    if (value.includes("manjaro")) return "logos:manjaro";
    if (value.includes("centos")) return "logos:centos-icon";
    if (value.includes("rocky")) return "logos:rocky-linux";
    if (value.includes("redhat") || value.includes("rhel")) return "logos:redhat";
    if (value.includes("suse")) return "logos:suse";
    if (value.includes("elementary")) return "logos:elementary";
    if (value.includes("mint")) return "logos:linux-mint";
    if (value.includes("zorin")) return "logos:zorin-os";
    if (value.includes("void")) return "logos:void";
    return "logos:linux-tux";
  }
  return "mingcute:computer-line";
}

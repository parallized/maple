import { Icon } from "@iconify/react";

/** Runner 主机平台的系统图标。
 *  - Windows：Win10 四色旗标（红 / 绿 / 蓝 / 黄）
 *  - macOS：苹果剪影，颜色跟随主题（浅色 = 黑，深色 = 白）
 *  - Linux：发行版彩色 logo；未知平台回退 mingcute 电脑图标。
 * 侧栏 Runner 区块与概览「已连接 Worker」列表共用，保持两处图标一致。 */
export function RunnerPlatformIcon({
  platform,
  className = "",
}: {
  platform: string;
  className?: string;
}) {
  const value = platform.toLowerCase();

  // darwin 含 "win" 子串，必须先于 windows 判断。
  if (value.includes("darwin") || value.includes("mac")) {
    return (
      <svg
        viewBox="0 0 256 256"
        width="1em"
        height="1em"
        className={`flex-none text-(--color-base-content) ${className}`}
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M213.803 167.03c.442 47.58 41.74 63.413 42.197 63.615c-.35 1.116-6.599 22.563-21.757 44.716c-13.104 19.153-26.705 38.235-48.13 38.63c-21.05.388-27.82-12.483-51.888-12.483c-24.061 0-31.582 12.088-51.51 12.871c-20.68.783-36.428-20.71-49.64-39.793c-27-39.033-47.633-110.3-19.928-158.406c13.763-23.89 38.36-39.017 65.056-39.405c20.307-.387 39.475 13.662 51.889 13.662c12.406 0 35.699-16.895 60.186-14.414c10.25.427 39.026 4.14 57.503 31.186c-1.49.923-34.335 20.044-33.978 59.822M174.24 50.199c10.98-13.29 18.369-31.79 16.353-50.199c-15.826.636-34.962 10.546-46.314 23.828c-10.173 11.763-19.082 30.589-16.678 48.633c17.64 1.365 35.66-8.964 46.64-22.262"
        />
      </svg>
    );
  }

  if (value.includes("win")) {
    return (
      <svg
        viewBox="0 0 256 256"
        width="1em"
        height="1em"
        className={`flex-none ${className}`}
        aria-hidden="true"
      >
        <path fill="#f25022" d="M0 0h121.329v121.329H0z" />
        <path fill="#7fba00" d="M134.671 0H256v121.329H134.671z" />
        <path fill="#00a4ef" d="M0 134.671h121.329V256H0z" />
        <path fill="#ffb900" d="M134.671 134.671H256V256H134.671z" />
      </svg>
    );
  }

  if (value.includes("linux")) {
    if (value.includes("ubuntu")) return <Icon icon="logos:ubuntu" className={`flex-none ${className}`} />;
    if (value.includes("fedora")) return <Icon icon="logos:fedora" className={`flex-none ${className}`} />;
    if (value.includes("arch")) return <Icon icon="logos:archlinux" className={`flex-none ${className}`} />;
    if (value.includes("debian")) return <Icon icon="logos:debian" className={`flex-none ${className}`} />;
    if (value.includes("manjaro")) return <Icon icon="logos:manjaro" className={`flex-none ${className}`} />;
    if (value.includes("centos")) return <Icon icon="logos:centos-icon" className={`flex-none ${className}`} />;
    if (value.includes("rocky")) return <Icon icon="logos:rocky-linux" className={`flex-none ${className}`} />;
    if (value.includes("redhat") || value.includes("rhel")) return <Icon icon="logos:redhat" className={`flex-none ${className}`} />;
    if (value.includes("suse")) return <Icon icon="logos:suse" className={`flex-none ${className}`} />;
    if (value.includes("elementary")) return <Icon icon="logos:elementary" className={`flex-none ${className}`} />;
    if (value.includes("mint")) return <Icon icon="logos:linux-mint" className={`flex-none ${className}`} />;
    if (value.includes("zorin")) return <Icon icon="logos:zorin-os" className={`flex-none ${className}`} />;
    if (value.includes("void")) return <Icon icon="logos:void" className={`flex-none ${className}`} />;
    return <Icon icon="logos:linux-tux" className={`flex-none ${className}`} />;
  }

  return <Icon icon="mingcute:computer-line" className={`flex-none ${className}`} />;
}

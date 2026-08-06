import { applyUiFont } from "@maple/board-ui/ui-font";
import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { DashboardApi } from "../api/client";
import { DashboardDemo } from "./DashboardDemo";
import { CapabilityGrid } from "./CapabilityGrid";
import { ColorBends } from "./ColorBends";
import { ScrollCurlSurface } from "./ScrollCurlSurface";
import { createScrollCurlMotion, type ScrollCurlMotion } from "./scroll-curl-motion";
import Lenis from "lenis";

/**
 * Maple 产品官网落地页（未登录）。
 * Warp 式落地结构：导航 → 大标题 Hero（左标题 / 右副文案 + 全宽 CTA 行）→ 产品演示带 → 页脚。
 * 产品演示为 `DashboardDemo`：dashboard 的场景化动态复刻，复用同一套 `--color-base-*` token。
 * 滚动卷曲（ScrollCurlSurface）覆盖整页内容：Hero、演示带、能力网格、页脚各自为独立 surface，
 * 共享同一 curlMotion 与视口位移图，屏幕空间里呈现为一条连续曲线，而非各卡片局部弯折。
 * 文案集中在本文件顶部 COPY 常量，改动只动这里。
 */

/* ── 文案单一来源 ── */

const COPY = {
  brand: "MapleCode",
  tagline: "Agentic AI 调度的崭新思路",
  headline: ["坚守愿景，", "你的品味决定什么值得被创造，", "MapleCode 决定创造的秩序。"],
  sub: "MapleCode 规划工作、梳理依赖，并把每项任务分配给 Codex、Claude、DeepSeek，以及你已经在使用的编码 Agent。",
  primaryCta: "进入控制台",
  secondaryCta: "在 GitHub 查看",
  nav: {
    product: "产品",
    how: "工作方式",
    github: "GitHub",
    docs: "使用文档",
    enter: "进入控制台"
  },
  githubUrl: "https://github.com/parallized/maple",
  install: {
    platforms: {
      windows: "Windows",
      mac: "macOS",
      linux: "Linux"
    },
    copyLabel: "复制安装命令",
    copiedLabel: "已复制",
    commands: {
      windows: "irm https://maplecode.art/install.ps1 | iex",
      mac: "curl -fsSL https://maplecode.art/install.sh | sh",
      linux: "curl -fsSL https://maplecode.art/install.sh | sh"
    }
  },
  footer: {
    tagline: "为那些想法比窗口更多的人而造。",
    docs: "使用文档",
    console: "进入控制台",
    source: "源代码"
  }
} as const;

const THEME_KEY = "maple.desktop.theme";
type ResolvedTheme = "light" | "dark";

/* ── 主题：复用 dashboard 的 .light/.dark + token，跨页一致 ── */

function resolveInitialTheme(): ResolvedTheme {
  /* 直接读 storage 键，避免为了 loadTheme 把 board-ui 整包拉进落地页 chunk。 */
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    /* 私密模式忽略 */
  }
  if (stored === "light" || stored === "dark") return stored;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function syncRootClass(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#121214" : "#ffffff");
}

function useHomeTheme() {
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveInitialTheme());
  useEffect(() => { syncRootClass(theme); }, [theme]);
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: ResolvedTheme = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch { /* 私密模式忽略 */ }
      return next;
    });
  }, []);
  return { theme, toggle };
}

/* ── 版本与下载量胶囊 ── */

function formatDownloads(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatVersion(value: string): string {
  return `v${value.replace(/^v/i, "")}`;
}

function VersionPill({ api }: { api: DashboardApi }) {
  const [stats, setStats] = useState<{ version: string; installShDownloads: number } | null>(null);
  useEffect(() => {
    let active = true;
    api.homeStats()
      .then((data) => { if (active) setStats(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [api]);
  return (
    <div
      className="hidden h-8 items-center gap-2 rounded-full bg-(--color-btn-bg) px-3 text-[11.5px] text-(--color-secondary) md:flex"
      title="版本号与 install.sh 累计下载量"
    >
      <span className="font-mono text-(--color-base-content)">{stats ? formatVersion(stats.version) : "v--"}</span>
      <span className="h-3 w-px bg-(--color-base-300)" />
      <Icon icon="mingcute:download-3-line" className="text-[13px] text-(--color-primary)" />
      <span className="tabular-nums">{stats ? formatDownloads(stats.installShDownloads) : "--"}</span>
    </div>
  );
}

/* ── 主题切换按钮 ── */

function ThemeToggle({ theme, onToggle }: { theme: ResolvedTheme; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
      title={theme === "dark" ? "浅色模式" : "深色模式"}
      className="flex h-8 w-8 items-center justify-center rounded-full text-(--color-base-content) transition-colors hover:bg-(--color-btn-hover)"
    >
      <Icon icon={theme === "dark" ? "mingcute:sun-line" : "mingcute:moon-line"} className="text-[16px]" />
    </button>
  );
}

/* ── 导航 ── */

function HomeNav({
  api,
  theme,
  onToggleTheme,
  onEnter
}: {
  api: DashboardApi;
  theme: ResolvedTheme;
  onToggleTheme: () => void;
  onEnter: () => void;
}) {
  const navLinkClass =
    "text-[12.5px] text-(--color-secondary) transition-colors hover:text-(--color-base-content)";
  return (
    <header className="fixed top-0 z-40 flex w-full items-center gap-6 bg-[color-mix(in_srgb,var(--color-base-200)_85%,transparent)] px-5 py-2.5 backdrop-blur-md sm:px-10 sm:py-3">
      <a href={COPY.githubUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2">
        <Icon icon="mingcute:quill-pen-ai-fill" className="text-[17px] text-(--color-primary)" />
        <span className="text-[14px] font-semibold tracking-tight text-(--color-base-content)">{COPY.brand}</span>
      </a>
      <nav className="ml-2 hidden items-center gap-6 md:flex" aria-label="页面导航">
        <a href={COPY.githubUrl} target="_blank" rel="noreferrer" className={navLinkClass}>
          {COPY.nav.product}
        </a>
        <a href={COPY.githubUrl} target="_blank" rel="noreferrer" className={navLinkClass}>
          {COPY.nav.how}
        </a>
        <a href={COPY.githubUrl} target="_blank" rel="noreferrer" className={`${navLinkClass} flex items-center gap-1`}>
          {COPY.nav.github}
          <Icon icon="mingcute:arrow-right-up-line" className="text-[12px]" />
        </a>
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <VersionPill api={api} />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <button
          type="button"
          onClick={onEnter}
          className="inline-flex h-8 items-center rounded-full bg-(--color-base-content) px-4 text-[12px] font-medium text-(--color-base-200) transition-opacity hover:opacity-90"
        >
          {COPY.nav.enter}
        </button>
      </div>
    </header>
  );
}

/* ── 安装命令胶囊（小号，自动检测系统；图标切换平台，激活的平台图标前置） ── */

type PlatformKey = "windows" | "mac" | "linux";

const PLATFORM_ICONS: Record<PlatformKey, string> = {
  windows: "logos:microsoft-windows-icon",
  mac: "logos:apple",
  linux: "logos:linux-tux"
};

function detectPlatform(): PlatformKey {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent;
  if (/win/i.test(ua)) return "windows";
  if (/mac|iphone|ipad/i.test(ua)) return "mac";
  return "linux";
}

function InstallCommandPill() {
  const [platform, setPlatform] = useState<PlatformKey>(() => detectPlatform());
  const [copied, setCopied] = useState(false);
  const command = COPY.install.commands[platform];

  // logos:apple 是纯黑单色,暗色主题下需反色;windows / tux 是彩色图标不动
  const iconClass = (key: PlatformKey) => `text-[13px]${key === "mac" ? " dark:invert" : ""}`;

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }, [command]);

  return (
    <div className="inline-flex h-9 max-w-full items-center gap-1 rounded-full border border-(--color-base-300) bg-(--color-base-100) p-1 shadow-[var(--card-shadow)]">
      {(Object.keys(COPY.install.platforms) as PlatformKey[]).map((key) => {
        const active = key === platform;
        return (
          <div
            key={key}
            role="button"
            tabIndex={0}
            aria-label={COPY.install.platforms[key]}
            title={COPY.install.platforms[key]}
            onClick={() => setPlatform(key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setPlatform(key);
            }}
            className={`flex h-7 shrink-0 cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-full transition-all duration-300 ease-[cubic-bezier(0.3,0.7,0.3,1)] ${
              active ? "max-w-[400px] bg-(--color-btn-bg)" : "max-w-[28px] opacity-60 hover:bg-(--color-btn-hover) hover:opacity-100"
            }`}
          >
            {/* 固定宽度的图标格:展开/收起时图标位置不动,只有文字区在伸缩 */}
            <span className="flex h-7 w-7 shrink-0 items-center justify-center">
              <Icon icon={PLATFORM_ICONS[key]} className={iconClass(key)} />
            </span>
            <span className={`flex items-center gap-1 pr-1 transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`}>
              <code className="font-mono text-[11px] text-(--color-base-content)">{COPY.install.commands[key]}</code>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void onCopy();
                }}
                aria-label={COPY.install.copyLabel}
                title={copied ? COPY.install.copiedLabel : COPY.install.copyLabel}
                className="flex shrink-0 items-center justify-center rounded-full p-1 text-(--color-secondary) transition-colors hover:bg-(--color-base-100) hover:text-(--color-base-content)"
              >
                <Icon icon={copied ? "mingcute:check-line" : "mingcute:copy-2-line"} className="text-[12px]" />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── ShinyText（reactbits shiny-text）：标题色打底，Maple 紫扫光 ── */

function ShinyText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span
      className={className}
      style={{
        color: "transparent",
        backgroundImage:
          "linear-gradient(120deg, var(--color-primary) 42%, var(--color-base-content) 50%, var(--color-primary) 58%)",
        backgroundSize: "200% 100%",
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        animation: "hp-shine 3.5s linear infinite",
        // background-clip:text 把字形墨迹按背景绘制区裁切,
        // CJK 字形填满 em 框时底部 1~2px 会落到绘制区外被截断。
        // 补一点 padding-bottom 扩展绘制区,负 margin 抵消布局位移。
        paddingBottom: "0.15em",
        marginBottom: "-0.15em"
      }}
    >
      <style>{`@keyframes hp-shine { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }`}</style>
      {text}
    </span>
  );
}

/* ── Hero（Warp 式：左标题 / 右副文案 + 全宽 CTA 行 + 演示带） ── */

function HomeHero({
  onEnter,
  onDocs,
  curlMotion,
  scrollViewportRef
}: {
  onEnter: () => void;
  onDocs: () => void;
  curlMotion: ScrollCurlMotion;
  scrollViewportRef: RefObject<HTMLElement>;
}) {
  return (
    <section className="relative w-full flex-1">
      {/* Hero 上半区（标语 / 大标题 / CTA 行）同样卷曲,与演示带共用同一屏幕空间位移场 */}
      <ScrollCurlSurface motion={curlMotion} viewportRef={scrollViewportRef}>
      <div className="mx-auto grid w-full max-w-[1120px] grid-cols-1 items-end gap-8 px-5 pt-16 sm:px-10 md:grid-cols-[1.25fr_1fr] md:pt-[72px]">
        {/* 左栏：标语 + 大标题（逐行独立弯曲,纸感更软） */}
        <div className="flex flex-col items-start gap-6">
          <span className="block pt-10">
            <ShinyText text={COPY.tagline} className="text-[13px] font-medium" />
          </span>
          <h1 className="font-sans text-[clamp(26px,3.2vw,36px)] font-semibold leading-[1.35] tracking-[0.02em] text-(--color-base-content)">
            <span className="block">{COPY.headline[0]}</span>
            <span className="block">{COPY.headline[1]}</span>
            <span className="block">{COPY.headline[2]}</span>
          </h1>
        </div>
        {/* 右栏：副文案（与标题底部对齐） */}
        <p className="max-w-[420px] text-[13px] leading-[1.8] text-(--color-secondary) md:justify-self-end md:pb-2">
          {COPY.sub}
        </p>
      </div>

      {/* 全宽 CTA 行 */}
      <div className="mx-auto mt-10 flex w-full max-w-[1120px] flex-wrap items-center gap-3 px-5 sm:px-10">
        <button
          type="button"
          onClick={onEnter}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-(--color-base-content) px-5 text-[13px] font-medium text-(--color-base-200) transition-opacity hover:opacity-90"
        >
          {COPY.primaryCta}
          <Icon icon="mingcute:computer-line" className="text-[14px]" />
        </button>
        <InstallCommandPill />
        <a
          href={COPY.githubUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1.5 px-2 text-[12.5px] text-(--color-secondary) transition-colors hover:text-(--color-base-content)"
        >
          <Icon icon="mingcute:github-fill" className="text-[14px]" />
          {COPY.secondaryCta}
          <Icon icon="mingcute:arrow-right-up-line" className="text-[12px]" />
        </a>
        <button
          type="button"
          onClick={onDocs}
          className="ml-auto hidden h-9 items-center gap-1.5 text-[12.5px] text-(--color-secondary) transition-colors hover:text-(--color-base-content) md:inline-flex"
        >
          <Icon icon="mingcute:book-line" className="text-[14px]" />
          {COPY.nav.docs}
        </button>
      </div>
      </ScrollCurlSurface>

      {/* 演示带：Color Bends 流动色带底 + 场景化产品演示 */}
      <div className="relative mt-16 border-t border-(--color-base-300)">
        <ScrollCurlSurface motion={curlMotion} viewportRef={scrollViewportRef}>
          <ColorBends
            className="absolute inset-0 opacity-85 [mask-image:linear-gradient(to_bottom,black_30%,transparent_92%)]"
            colors={["#7a63e8", "#a78bfa", "#c4b5fd"]}
            speed={0.16}
            intensity={0.9}
            noise={0.05}
            mouseInfluence={0.6}
            parallax={0.4}
          />
          <div className="relative mx-auto w-full max-w-[1120px] px-5 pb-20 pt-12 sm:px-10 sm:pb-24">
            <DashboardDemo />
          </div>
        </ScrollCurlSurface>
      </div>
    </section>
  );
}

/* ── 页脚 ── */

function HomeFooter({ onEnter, onDocs }: { onEnter: () => void; onDocs: () => void }) {
  return (
    <footer className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-5 py-8 sm:px-10 md:flex-row md:items-center md:justify-between">
      <p className="text-[12px] text-(--color-secondary)">{COPY.footer.tagline}</p>
      <nav className="flex items-center gap-5 text-[12px]" aria-label="页脚导航">
        <button type="button" onClick={onDocs} className="text-(--color-secondary) transition-colors hover:text-(--color-base-content)">
          {COPY.footer.docs}
        </button>
        <button type="button" onClick={onEnter} className="text-(--color-secondary) transition-colors hover:text-(--color-base-content)">
          {COPY.footer.console}
        </button>
        <a href={COPY.githubUrl} target="_blank" rel="noreferrer" className="text-(--color-secondary) transition-colors hover:text-(--color-base-content)">
          {COPY.footer.source}
        </a>
      </nav>
    </footer>
  );
}

/* ── 页面 ── */

export function HomePage({
  api,
  onEnter,
  onDocs,
  authed = false
}: {
  api: DashboardApi;
  onEnter: () => void;
  onDocs: () => void;
  authed?: boolean;
}) {
  const { theme, toggle } = useHomeTheme();
  const scrollRef = useRef<HTMLDivElement>(null);
  const curlMotion = useMemo(() => createScrollCurlMotion(), []);
  // 进入页面时同步一次，保证与 dashboard 跨页主题一致。
  void authed;

  useEffect(() => {
    applyUiFont("chill-round");
    document.documentElement.classList.add("hp-flat-root");
    return () => document.documentElement.classList.remove("hp-flat-root");
  }, []);

  // Lenis 与卷曲共用同一帧时钟:先更新实际滚动位置,再由显示出来的位移计算卷曲强度。
  useEffect(() => {
    const wrapper = scrollRef.current;
    const content = wrapper?.firstElementChild as HTMLElement | null;
    if (!wrapper || !content) return;
    const lenis = new Lenis({
      wrapper,
      content,
      lerp: 0.1,
      smoothWheel: true,
      syncTouch: true,
      anchors: false,
      autoRaf: false
    });
    let raf = 0;
    let previousTime: number | null = null;
    curlMotion.reset(wrapper.scrollTop);

    const loop = (time: number) => {
      lenis.raf(time);
      const deltaSeconds = previousTime === null ? 1 / 60 : (time - previousTime) / 1000;
      previousTime = time;
      curlMotion.update(wrapper.scrollTop, deltaSeconds);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      curlMotion.reset(wrapper.scrollTop);
      lenis.destroy();
    };
  }, [curlMotion]);

  // 入场「纸张展开」:纯 CSS,无 SVG filter。
  // 整页起始带轻微 X 轴透视倾斜 + 边缘卷起阴影,动画收尾到 transform:none / 无阴影,
  // 结束后容器 100% 原生渲染(文字子像素、渐变色彩都不降级)。
  // 用 CSS animation 而非 transition,是为了让 keyframe 到「归零态」可被
  // animation-fill-mode: forwards 锁定,无需 JS 续帧;同时尊重 prefers-reduced-motion。
  useEffect(() => {
    const wrapper = scrollRef.current;
    if (!wrapper) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return; // 尊重无障碍偏好,跳过入场

    const styleId = "hp-paper-unroll";
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
@keyframes hp-unroll {
  0%   { transform: perspective(1600px) rotateX(3.5deg); filter: drop-shadow(0 -10px 18px rgba(0,0,0,.06)); }
  60%  { transform: perspective(1600px) rotateX(.7deg); filter: drop-shadow(0 -2px 6px rgba(0,0,0,.02)); }
  100% { transform: none; filter: none; }
}
.hp-unrolling {
  animation: hp-unroll 1.15s cubic-bezier(.22,.61,.36,1) forwards;
  transform-origin: 50% 60%;
  will-change: transform, filter;
}`;
      document.head.appendChild(style);
    }

    wrapper.classList.add("hp-unrolling");
    const onEnd = () => {
      wrapper.classList.remove("hp-unrolling");
      wrapper.removeEventListener("animationend", onEnd);
    };
    wrapper.addEventListener("animationend", onEnd);
    return () => {
      wrapper.removeEventListener("animationend", onEnd);
      wrapper.classList.remove("hp-unrolling");
    };
  }, []);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-(--color-base-200) font-sans text-(--color-base-content) antialiased">
      <HomeNav api={api} theme={theme} onToggleTheme={toggle} onEnter={onEnter} />
      <div
        ref={scrollRef}
        data-home-scroll-viewport="true"
        className="relative z-10 flex h-full flex-col overflow-y-auto overflow-x-hidden"
      >
        <div className="flex min-h-full flex-col">
          <HomeHero
            onEnter={onEnter}
            onDocs={onDocs}
            curlMotion={curlMotion}
            scrollViewportRef={scrollRef}
          />
          {/* 卷曲特效覆盖整页:Hero / 演示带 / 能力区块 / 页脚各为独立 surface,
              但共享同一 motion 与视口位移图,屏幕空间里是同一条连续曲线 */}
          <ScrollCurlSurface motion={curlMotion} viewportRef={scrollRef}>
            <CapabilityGrid />
          </ScrollCurlSurface>
          <ScrollCurlSurface motion={curlMotion} viewportRef={scrollRef}>
            <HomeFooter onEnter={onEnter} onDocs={onDocs} />
          </ScrollCurlSurface>
        </div>
      </div>
    </div>
  );
}

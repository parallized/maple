import { applyUiFont } from "@maple/board-ui";
import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import type { DashboardApi } from "../api/client";
import { HomeShowcase } from "./HomeShowcase";

/**
 * Maple Code 产品官网页（未登录落地页）。
 * 纯黑底 + 唯一发光焦点：Canvas 采样的「Maple Code」点阵字标，
 * 微光带缓慢扫过，指针靠近时字面随光亮起。
 */

const MORANDI_PURPLE = "#a08fb8";
const MORANDI_SAGE = "#9aae9a";

/* ── 版本与下载量 ── */

function formatDownloads(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatVersion(value: string): string {
  return `v${value.replace(/^v/i, "")}`;
}

function VersionStats({ api }: { api: DashboardApi }) {
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
      className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11.5px] text-zinc-400"
      title="版本号与 install.sh 累计下载量"
    >
      <span className="font-mono text-zinc-300">{stats ? formatVersion(stats.version) : "v--"}</span>
      <span className="h-3 w-px bg-white/10" />
      <Icon icon="mingcute:download-3-line" className="text-[13px]" style={{ color: MORANDI_SAGE }} />
      <span className="tabular-nums">{stats ? formatDownloads(stats.installShDownloads) : "--"}</span>
    </div>
  );
}

/* ── 发光点阵字标：离屏采样字形 → 网格光点，微光带扫过 + 指针随光 ── */

const WM_W = 1000;
const WM_H = 230;
const WM_GAP = 5;

function LuminousWordmark({ text }: { text: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    let raf = 0;
    let disposed = false;

    const setup = async () => {
      try {
        await Promise.race([
          document.fonts.load('700 160px "ChillRoundF"'),
          new Promise((resolve) => setTimeout(resolve, 1200))
        ]);
      } catch {
        // 字体加载失败则用回退字体采样，不影响渲染。
      }
      if (disposed) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const off = document.createElement("canvas");
      off.width = WM_W;
      off.height = WM_H;
      const octx = off.getContext("2d")!;
      octx.fillStyle = "#000";
      octx.fillRect(0, 0, WM_W, WM_H);
      octx.fillStyle = "#fff";
      octx.font = '700 160px "ChillRoundF", "PingFang SC", "Microsoft YaHei", sans-serif';
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillText(text, WM_W / 2, WM_H / 2 + 8);
      const pixels = octx.getImageData(0, 0, WM_W, WM_H).data;

      const dots: Array<{ x: number; y: number; a: number }> = [];
      for (let y = 0; y < WM_H; y += WM_GAP) {
        for (let x = 0; x < WM_W; x += WM_GAP) {
          const a = pixels[(y * WM_W + x) * 4] / 255;
          if (a > 0.28) dots.push({ x, y, a });
        }
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = WM_W * dpr;
      canvas.height = WM_H * dpr;
      ctx.scale(dpr, dpr);

      const start = performance.now();
      const render = (now: number) => {
        const t = (now - start) / 1000;
        ctx.clearRect(0, 0, WM_W, WM_H);
        const sweep = ((t * 92) % (WM_W + 620)) - 310;
        const { x: px, y: py } = pointer.current;
        const pointerActive = px > -100;
        for (const d of dots) {
          /* 基础亮度压得很低，给扫光与指针光留出对比空间 */
          let light = 0.26 + d.a * 0.3;
          const ds = Math.abs(d.x - sweep);
          if (ds < 160) light += (1 - ds / 160) * 0.7;
          if (pointerActive) {
            const dx = d.x - px;
            const dy = d.y - py;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 200) light += (1 - dist / 200) * 1.1;
          }
          ctx.fillStyle = `rgba(244,244,245,${Math.min(light, 1).toFixed(3)})`;
          ctx.fillRect(d.x, d.y, 2.6, 2.6);
        }
        /* 指针位置的体积光：白核紫缘，叠加在光点之下 */
        if (pointerActive) {
          const glow = ctx.createRadialGradient(px, py, 0, px, py, 230);
          glow.addColorStop(0, "rgba(244,244,245,0.13)");
          glow.addColorStop(0.55, "rgba(160,143,184,0.09)");
          glow.addColorStop(1, "rgba(160,143,184,0)");
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = glow;
          ctx.fillRect(px - 230, py - 230, 460, 460);
          ctx.globalCompositeOperation = "source-over";
        }
        raf = requestAnimationFrame(render);
      };
      raf = requestAnimationFrame(render);
    };
    void setup();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [text]);

  const trackPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    pointer.current = {
      x: ((event.clientX - rect.left) / rect.width) * WM_W,
      y: ((event.clientY - rect.top) / rect.height) * WM_H
    };
  };

  return (
    <div
      className="relative"
      onPointerMove={trackPointer}
      onPointerLeave={() => { pointer.current = { x: -9999, y: -9999 }; }}
    >
      {/* 光晕：白核紫缘，黑底上唯一的体积光 */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -z-10 h-[340px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[90px]"
        style={{
          background: `radial-gradient(closest-side, rgba(244,244,245,0.2), ${MORANDI_PURPLE}38 55%, transparent 75%)`
        }}
      />
      <canvas ref={canvasRef} className="block h-auto w-[min(880px,92vw)]" />
    </div>
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
  useEffect(() => {
    applyUiFont("chill-round");
  }, []);

  return (
    <div className="relative h-screen overflow-y-auto bg-black font-sans text-zinc-200 antialiased">
      {/* ── 导航 ── */}
      <header className="sticky top-0 z-20 mx-auto flex w-full max-w-[1200px] items-center gap-5 bg-black/70 px-6 py-6 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Icon icon="mingcute:quill-pen-ai-fill" className="text-[17px]" style={{ color: MORANDI_PURPLE }} />
          <span className="text-[14px] font-semibold tracking-tight text-zinc-100">
            Maple <span style={{ color: MORANDI_PURPLE }}>Code</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onDocs}
          className="text-[12.5px] text-zinc-500 transition-colors hover:text-zinc-200"
        >
          使用文档
        </button>
        <div className="ml-auto flex items-center gap-3">
          <VersionStats api={api} />
          <button
            type="button"
            onClick={onEnter}
            className="rounded-full border border-white/[0.12] px-4 py-1.5 text-[12px] font-medium text-zinc-200 transition-colors hover:border-white/[0.24] hover:bg-white/[0.04]"
          >
            进入控制台
          </button>
        </div>
      </header>

      {/* ── 焦点 ── */}
      <main className="relative z-10 flex min-h-[calc(100vh-76px)] flex-col items-center justify-center px-6">
        <LuminousWordmark text="Maple Code" />
        <p className="m-0 mt-12 text-[14px] tracking-[0.08em] text-zinc-500">
          让 AI Worker 替你完成每一个 Todo
        </p>
        <div className="mt-9 flex items-center gap-3">
          <button
            type="button"
            onClick={onEnter}
            className="rounded-full bg-[#f4f4f5] px-7 py-2.5 text-[13px] font-semibold text-black transition-transform hover:-translate-y-0.5"
          >
            {authed ? "进入控制台" : "开始使用"}
          </button>
          <button
            type="button"
            onClick={onDocs}
            className="rounded-full border border-white/[0.15] px-7 py-2.5 text-[13px] font-medium text-zinc-300 transition-colors hover:border-white/[0.3] hover:bg-white/[0.03]"
          >
            快速开始
          </button>
        </div>
        <div className="absolute bottom-7 left-1/2 -translate-x-1/2 animate-bounce text-zinc-600">
          <Icon icon="mingcute:arrow-down-line" className="text-[16px]" />
        </div>
      </main>

      {/* ── 亮点展区 ── */}
      <HomeShowcase onEnter={onEnter} authed={authed} />

      {/* ── 底栏 ── */}
      <footer className="relative z-10 mx-auto flex w-full max-w-[1200px] items-center justify-between px-6 py-6 text-[11.5px] tracking-wide text-zinc-600">
        <span>自托管 · 开源 · 数据留在你的服务器</span>
        <span className="hidden sm:inline">看板派发 · 本机执行 · 截图验收</span>
      </footer>
    </div>
  );
}

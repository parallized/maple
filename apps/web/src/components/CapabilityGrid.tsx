import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FoldText } from "./FoldText";

/**
 * 落地页「项目能力」区块（位于产品演示带之后、页脚之前）。
 * 布局参考 Superlist 编辑式排版：双色大标题 + 大留白，文/视左右交替行，弱分隔，不用密集卡片。
 * - 5 条能力行：任务报告 / Leader·Worker 双线同步（Token 纪念碑）/
 *   多设备多人协作 / 克制的安全模型 / 杜绝污染硬盘；
 * - 收尾陈述：FoldText 折起展开的大字宣言，衔接页脚；
 * - Token 视觉为等轴立柱纪念碑（纯 SVG）：Leader 细柱对 Worker 巨柱，FIG 技术图签 + 引线注记，
 *   入视口时立柱从地平面生长，尊重 prefers-reduced-motion；2% 分段为图示下限（真实不足 0.01%）；
 * - 大标题与收尾宣言使用 FoldText（reactbits fold-text 风格）逐字折起展开。
 * 文案集中在顶部 COPY 常量，改动只动这里。
 */

/* ── 文案单一来源 ── */

const COPY = {
  titleLead: "需要各种工具解决不同问题？",
  titleStrong: "Maple 帮你编排，",
  titleMuted: "激发所有现代 Agent 潜能",
  sub: "Maple 使用最优雅的方式同时适配无限种 CLI / GUI，像操作系统大一统软件一样，管理你的所有开发工具。",
  features: {
    report: {
      title: "任务内置详细报告和进行状态",
      desc: "拒绝线性对话。任务中途断连、需要返工等信息，都由看板一网打尽。"
    },
    sync: {
      title: "Leader / Worker 双线同步",
      subtitle: "不仅提供预热信息，还能决定指令去向——无副作用的 Worker 并行与串行抉择。",
      desc: "同时开 2 个窗口解决 A、B 问题时，偶尔会不小心把 B 问题的信息发给 A。Maple 自动把指令交给上下文最足、缓存最优的窗口，至多 16 个 Session 并行，开发效率与 Token 节省真实双赢。"
    },
    device: {
      title: "原生、随时随地、多设备、多人协作",
      desc: "打开 CLI 作为 Runner 常驻开发机，Web 看板在服务端。手机和浏览器都能随时随地加任务、查状态，支持多租户与多工作区，结合 Playwright 可直观验收。"
    },
    security: {
      title: "克制的安全模型",
      desc: "Runner Token 保持最小权限，密码经 Argon2id 哈希，云端 Provider 凭证以 AES-256-GCM 加密——你的数据安全非常重要。Maple 项目启动之初即完整支持自部署、一键离线使用、数据自持。"
    },
    disk: {
      title: "杜绝污染硬盘管理",
      desc: "所有缓存与数据统一收在 ~/.maple，项目目录拒绝残留。Playwright 上传截图后自动销毁——保护你的数据，也避免污染硬盘。"
    }
  },
  token: {
    arrow: "886 TOKENS 完成一次调度",
    leaderTop: "执行输出",
    leaderMid: "最近工作与 Worker 信息",
    leaderBottom: "Leader 提示词 886 Tokens",
    workerTop: "Worker 提示词 368 Tokens + 预热信息",
    workerRun: "Worker Agent 执行",
    workerBottom: "Playwright 截图 / 报告回写",
    footnote: "两侧 2% 分段只是图示下限，真实占比不足 0.01%；双柱亦未按真实差距绘制——几乎所有 token 都花在真实执行上。"
  },
  closing: {
    strong: "别再把时间花在整理任务、切换 Agent 和追问进度上。",
    rest: "Maple 会规划工作、梳理依赖，把任务交给合适的 Coding Agent，并汇总结果与验收——让你专注于真正值得创造的事。"
  }
} as const;

/* ── 能力行：左文右视 / 左右交替，大留白弱分隔 ── */

function FeatureRow({
  title,
  subtitle,
  desc,
  visual,
  flip = false,
  className = ""
}: {
  title: string;
  subtitle?: string;
  desc: string;
  visual: ReactNode;
  flip?: boolean;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-1 items-center gap-10 py-14 md:grid-cols-2 md:gap-16 md:py-[72px] ${className}`}>
      <div className={`flex max-w-[480px] flex-col gap-3.5 ${flip ? "md:order-2 md:justify-self-end" : ""}`}>
        <h3 className="m-0 text-[clamp(18px,2vw,22px)] font-semibold leading-[1.45] tracking-[0.01em] text-(--color-base-content)">
          {title}
        </h3>
        {subtitle ? (
          <p className="m-0 text-[13.5px] font-medium leading-[1.7] text-(--color-base-content)/75">{subtitle}</p>
        ) : null}
        <p className="m-0 text-[13px] leading-[1.85] text-(--color-secondary)">{desc}</p>
      </div>
      <div className={flip ? "md:order-1" : ""}>{visual}</div>
    </div>
  );
}

/* ── 行 1 视觉：真实截图相框（报告 + 状态看板） ── */

function FramedShot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-(--color-base-300) bg-(--color-base-100) transition-colors duration-300 hover:border-[color-mix(in_srgb,var(--color-primary)_35%,var(--color-base-300))]">
      <img src={src} alt={alt} className="block w-full" loading="lazy" decoding="async" />
    </div>
  );
}

function ReportRow() {
  return (
    <div className="flex flex-col gap-8 py-14 md:gap-10 md:py-[72px]">
      {/* 第一行：左标题 / 右副标题 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-16">
        <h3 className="m-0 shrink-0 text-[clamp(18px,2vw,22px)] font-semibold leading-[1.45] tracking-[0.01em] text-(--color-base-content)">
          {COPY.features.report.title}
        </h3>
        <p className="m-0 max-w-[380px] text-[13px] leading-[1.85] text-(--color-secondary)">{COPY.features.report.desc}</p>
      </div>
      {/* 第二行：左任务列表 / 右验收截图 */}
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
        <FramedShot src="/showcase/board-done.webp" alt="真实任务看板：完成状态实时回流" />
        <FramedShot src="/showcase/report-screenshots.png" alt="执行报告自动附验收截图" />
      </div>
    </div>
  );
}

/* ── 行 2 视觉：Token 纪念碑（等轴立柱 FIG 技术图签，非卡片） ── */

/** 等轴投影（2:1）：立柱顶面 / 左面 / 右面多边形点串。 */
function isoPillar(cx: number, base: number, w: number, h: number) {
  const d = w * 0.5;
  return {
    top: `${cx},${base - h} ${cx + w},${base - h + d} ${cx},${base - h + 2 * d} ${cx - w},${base - h + d}`,
    left: `${cx - w},${base - h + d} ${cx},${base - h + 2 * d} ${cx},${base + 2 * d} ${cx - w},${base + d}`,
    right: `${cx},${base - h + 2 * d} ${cx + w},${base - h + d} ${cx + w},${base + d} ${cx},${base + 2 * d}`
  };
}

/** 高度带 [s0, s1] 在左右面上的切片多边形。 */
function isoBand(cx: number, base: number, w: number, s0: number, s1: number) {
  const d = w * 0.5;
  return {
    left: `${cx - w},${base - s1 + d} ${cx},${base - s1 + 2 * d} ${cx},${base - s0 + 2 * d} ${cx - w},${base - s0 + d}`,
    right: `${cx},${base - s1 + 2 * d} ${cx + w},${base - s1 + d} ${cx + w},${base - s0 + d} ${cx},${base - s0 + 2 * d}`
  };
}

/** 高度 s 处的分段发丝线（左面 + 右面）。 */
function isoSeam(cx: number, base: number, w: number, s: number) {
  const d = w * 0.5;
  return {
    left: `${cx - w},${base - s + d} ${cx},${base - s + 2 * d}`,
    right: `${cx},${base - s + 2 * d} ${cx + w},${base - s + d}`
  };
}

/** 进入视口一次性触发；prefers-reduced-motion 直接呈现终态。 */
function useInViewOnce(threshold = 0.35) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, shown };
}

const MONUMENT_STROKE = "color-mix(in srgb, var(--color-base-content) 34%, transparent)";
const MONUMENT_STROKE_SOFT = "color-mix(in srgb, var(--color-base-content) 16%, transparent)";
const MONUMENT_GHOST = "color-mix(in srgb, var(--color-secondary) 18%, transparent)";

const LEADER_SEG_COLORS = [
  "color-mix(in srgb, var(--color-primary) 55%, transparent)",
  "color-mix(in srgb, var(--color-primary) 38%, transparent)",
  "color-mix(in srgb, var(--color-primary) 22%, transparent)"
] as const;

const WORKER_RUN_COLOR = "color-mix(in srgb, var(--color-primary) 88%, transparent)";

function TokenRatioVisual() {
  const { ref, shown } = useInViewOnce();

  /* 双柱几何：共享地平面 y=400；Leader 细柱对 Worker 巨柱，刻意不按真实差距 */
  const leader = { cx: 210, base: 370, w: 30, h: 46 };
  const worker = { cx: 420, base: 342, w: 58, h: 230 };
  const leaderP = isoPillar(leader.cx, leader.base, leader.w, leader.h);
  const workerP = isoPillar(worker.cx, worker.base, worker.w, worker.h);

  /* Leader 分段（底→顶）：提示词 30 / 最近工作与 Worker 信息 50 / 执行输出 20 */
  const lh = leader.h / 100;
  const leaderBands = [
    { s0: 0, s1: 30 * lh, color: LEADER_SEG_COLORS[0] },
    { s0: 30 * lh, s1: 80 * lh, color: LEADER_SEG_COLORS[1] },
    { s0: 80 * lh, s1: 100 * lh, color: LEADER_SEG_COLORS[2] }
  ];
  /* Worker 分段（底→顶）：Playwright / 报告回写 2 · Agent 执行 94 · 预热信息 2 · 提示词 2 */
  const wh = worker.h / 100;
  const workerBands = [
    { s0: 0, s1: 2 * wh, color: MONUMENT_GHOST },
    { s0: 2 * wh, s1: 96 * wh, color: WORKER_RUN_COLOR },
    { s0: 96 * wh, s1: 98 * wh, color: MONUMENT_GHOST },
    { s0: 98 * wh, s1: 100 * wh, color: MONUMENT_GHOST }
  ];

  const grow = (delay: number): CSSProperties => ({
    transform: shown ? "scaleY(1)" : "scaleY(0)",
    transformBox: "fill-box",
    transformOrigin: "50% 100%",
    transition: `transform 0.9s cubic-bezier(0.2,0.7,0.3,1) ${delay}ms`
  });
  const fade = (delay: number): CSSProperties => ({
    opacity: shown ? 1 : 0,
    transition: `opacity 0.6s ease ${delay}ms`
  });

  /* 注记引线：一条发丝线连接文字与柱身分段 */
  const leaderNotes = [
    { label: COPY.token.leaderTop, y: 344 },
    { label: COPY.token.leaderMid, y: 360 },
    { label: COPY.token.leaderBottom, y: 378 }
  ];

  return (
    <div ref={ref} className="select-none">
      <svg
        viewBox="0 0 640 440"
        className="block w-full"
        role="img"
        aria-label="Token 分配纪念碑：Leader 提示词细柱对 Worker 执行巨柱，绝大部分 token 用于真实执行"
      >
        <defs>
          <marker id="tm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L8 4L0 8z" fill="var(--color-primary)" />
          </marker>
        </defs>

        {/* Leader 立柱 */}
        <g style={grow(150)}>
          {leaderBands.map((band) => {
            const pts = isoBand(leader.cx, leader.base, leader.w, band.s0, band.s1);
            return (
              <g key={band.s0}>
                <polygon points={pts.left} fill={band.color} />
                <polygon points={pts.right} fill={band.color} opacity={0.82} />
              </g>
            );
          })}
          <polygon points={leaderP.top} fill="color-mix(in srgb, var(--color-primary) 65%, transparent)" />
          <polygon points={leaderP.left} fill="none" stroke={MONUMENT_STROKE} strokeWidth={1} />
          <polygon points={leaderP.right} fill="none" stroke={MONUMENT_STROKE} strokeWidth={1} />
          <polygon points={leaderP.top} fill="none" stroke={MONUMENT_STROKE} strokeWidth={1} />
          {[30 * lh, 80 * lh].map((s) => {
            const seam = isoSeam(leader.cx, leader.base, leader.w, s);
            return (
              <g key={s} stroke={MONUMENT_STROKE_SOFT} strokeWidth={0.75}>
                <polyline points={seam.left} fill="none" />
                <polyline points={seam.right} fill="none" />
              </g>
            );
          })}
        </g>

        {/* Worker 立柱 */}
        <g style={grow(0)}>
          {workerBands.map((band) => {
            const pts = isoBand(worker.cx, worker.base, worker.w, band.s0, band.s1);
            return (
              <g key={band.s0}>
                <polygon points={pts.left} fill={band.color} />
                <polygon points={pts.right} fill={band.color} opacity={0.82} />
              </g>
            );
          })}
          <polygon points={workerP.top} fill="color-mix(in srgb, var(--color-primary) 92%, transparent)" />
          <polygon points={workerP.left} fill="none" stroke={MONUMENT_STROKE} strokeWidth={1} />
          <polygon points={workerP.right} fill="none" stroke={MONUMENT_STROKE} strokeWidth={1} />
          <polygon points={workerP.top} fill="none" stroke={MONUMENT_STROKE} strokeWidth={1} />
          {[2 * wh, 96 * wh, 98 * wh].map((s) => {
            const seam = isoSeam(worker.cx, worker.base, worker.w, s);
            return (
              <g key={s} stroke={MONUMENT_STROKE_SOFT} strokeWidth={0.75}>
                <polyline points={seam.left} fill="none" />
                <polyline points={seam.right} fill="none" />
              </g>
            );
          })}
        </g>

        {/* 地平面 */}
        <line x1={130} y1={400} x2={510} y2={400} stroke={MONUMENT_STROKE_SOFT} />

        {/* 调度箭头：Leader 柱右下角边缘偏上起弧，指向 Worker 柱顶，止于顶面左边缘、不入柱 */}
        <g style={fade(650)}>
          <path
            d="M240 372 C 300 350, 300 220, 354 145"
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={1.2}
            markerEnd="url(#tm-arrow)"
          />
          <text x={256} y={178} textAnchor="middle" fontSize={10} letterSpacing={0.5} fill="var(--color-primary)" className="font-mono">
            {COPY.token.arrow}
          </text>
        </g>

        {/* Leader 注记：引线连接文字与柱身分段 */}
        <g style={fade(550)} className="font-mono">
          {leaderNotes.map((note) => (
            <g key={note.label}>
              <line x1={180} y1={note.y - 3.5} x2={158} y2={note.y - 3.5} stroke={MONUMENT_STROKE_SOFT} />
              <text x={152} y={note.y} textAnchor="end" fontSize={10.5} fill="var(--color-secondary)">
                {note.label}
              </text>
            </g>
          ))}
        </g>

        {/* Worker 注记：右侧引线 + 底部 */}
        <g style={fade(750)} className="font-mono">
          <line x1={478} y1={146} x2={500} y2={146} stroke={MONUMENT_STROKE_SOFT} />
          <text x={506} y={150} fontSize={10} fill="var(--color-secondary)">
            {COPY.token.workerTop}
          </text>
          <line x1={478} y1={258} x2={500} y2={258} stroke={MONUMENT_STROKE_SOFT} />
          <text x={506} y={262} fontSize={11} fontWeight={600} fill="var(--color-primary)">
            {COPY.token.workerRun}
          </text>
          <line x1={worker.cx} y1={404} x2={worker.cx} y2={412} stroke={MONUMENT_STROKE_SOFT} />
          <text x={worker.cx} y={427} textAnchor="middle" fontSize={9.5} fill="color-mix(in srgb, var(--color-secondary) 70%, transparent)">
            {COPY.token.workerBottom}
          </text>
        </g>
      </svg>

      <p className="m-0 pt-2 font-mono text-[10px] leading-[1.7] text-(--color-secondary)/70">{COPY.token.footnote}</p>
    </div>
  );
}

/* ── 行 3 视觉：多设备多人协作 ── */

/* ── 行 3 视觉：线稿拟物设备阵（设备高度轮廓呈正态分布曲线；设备地线即本节分割线，合体为一） ── */

const DEVICE_LINE = "color-mix(in srgb, var(--color-base-content) 45%, transparent)";
const DEVICE_LINE_SOFT = "color-mix(in srgb, var(--color-base-content) 20%, transparent)";
const DEVICE_GROUND = "color-mix(in srgb, var(--color-base-content) 24%, transparent)";

function DeviceLineArt() {
  return (
    <svg
      viewBox="0 0 560 214"
      className="block w-full overflow-visible"
      role="img"
      aria-label="手机、笔记本、台式显示器与平板的线稿设备阵"
    >
      <g fill="none" stroke={DEVICE_LINE} strokeWidth={1.2}>
        {/* 地线：本节分割线，溢出 SVG 画布延伸至全屏宽（滚动容器 overflow-x-hidden 兜底） */}
        <line x1={-2000} y1={200} x2={2560} y2={200} stroke={DEVICE_GROUND} />

        {/* 手机（左，低） */}
        <rect x={36} y={116} width={44} height={84} rx={10} />
        <line x1={52} y1={124} x2={64} y2={124} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <rect x={41} y={132} width={34} height={56} rx={3} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={46} y1={142} x2={70} y2={142} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={46} y1={151} x2={64} y2={151} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <circle cx={48} cy={164} r={2} stroke="none" fill="var(--color-primary)" />
        <line x1={54} y1={164} x2={70} y2={164} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={52} y1={193} x2={64} y2={193} stroke={DEVICE_LINE_SOFT} />

        {/* 笔记本：CLI Runner（次高） */}
        <rect x={122} y={128} width={116} height={64} rx={5} />
        <rect x={110} y={194} width={140} height={6} rx={3} />
        <polyline points="132,140 138,146 132,152" stroke="var(--color-primary)" strokeWidth={1.4} />
        <line x1={144} y1={146} x2={164} y2={146} stroke={DEVICE_LINE_SOFT} />
        <line x1={132} y1={162} x2={176} y2={162} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={132} y1={171} x2={168} y2={171} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />

        {/* 台式显示器：Web 看板（峰顶，最高） */}
        <rect x={282} y={88} width={140} height={96} rx={6} />
        <rect x={288} y={94} width={128} height={84} rx={3} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={318} y1={94} x2={318} y2={178} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <circle cx={328} cy={108} r={2.2} stroke="none" fill="var(--color-primary)" />
        <line x1={336} y1={108} x2={388} y2={108} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <circle cx={328} cy={122} r={2.2} stroke="none" fill={DEVICE_LINE_SOFT} />
        <line x1={336} y1={122} x2={398} y2={122} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <circle cx={328} cy={136} r={2.2} stroke="none" fill={DEVICE_LINE_SOFT} />
        <line x1={336} y1={136} x2={380} y2={136} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={296} y1={102} x2={310} y2={102} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={296} y1={112} x2={306} y2={112} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={296} y1={122} x2={308} y2={122} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        {/* 显示器支架 */}
        <line x1={348} y1={184} x2={348} y2={194} />
        <line x1={356} y1={184} x2={356} y2={194} />
        <polyline points="334,200 342,194 362,194 370,200" />

        {/* 平板（右，回落） */}
        <rect x={454} y={112} width={64} height={88} rx={9} />
        <circle cx={486} cy={121} r={1.6} stroke="none" fill={DEVICE_LINE} />
        <line x1={464} y1={134} x2={508} y2={134} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={464} y1={146} x2={496} y2={146} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <line x1={464} y1={158} x2={502} y2={158} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
        <circle cx={466} cy={172} r={2} stroke="none" fill="var(--color-primary)" />
        <line x1={472} y1={172} x2={498} y2={172} stroke={DEVICE_LINE_SOFT} strokeWidth={0.75} />
      </g>
    </svg>
  );
}

/* ── 行 4 视觉：克制的安全模型 ── */

function SecurityVisual() {
  const items = [
    { icon: "mingcute:key-2-line", label: "Runner Token 最小权限" },
    { icon: "mingcute:lock-line", label: "Argon2id 密码哈希" },
    { icon: "mingcute:safe-shield-line", label: "AES-256-GCM 凭证加密" },
    { icon: "mingcute:cloud-line", label: "自部署 · 离线可用 · 数据自持" }
  ];
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-2.5 rounded-xl border border-(--color-base-300) bg-(--color-base-100) px-3.5 py-2.5"
        >
          <Icon icon={item.icon} className="text-[13px] text-(--color-primary)" />
          <span className="text-[11.5px] font-medium text-(--color-base-content)/85">{item.label}</span>
          <Icon icon="mingcute:check-line" className="ml-auto text-[12px] text-(--color-success)" />
        </div>
      ))}
    </div>
  );
}

/* ── 行 5 视觉：杜绝污染硬盘 ── */

function DiskVisual() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-(--color-base-300) bg-(--color-base-100) p-6">
      <div className="flex items-center gap-2.5">
        <Icon icon="mingcute:folder-line" className="text-[15px] text-(--color-primary)" />
        <code className="font-mono text-[12.5px] text-(--color-base-content)">~/.maple</code>
        <span className="ml-auto text-[10px] text-(--color-secondary)">缓存与数据统一收纳</span>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-(--color-base-300)/50 pt-3">
        {["项目目录 0 残留", "Playwright 截图用后自动销毁"].map((text) => (
          <div key={text} className="flex items-center gap-1.5">
            <Icon icon="mingcute:check-circle-fill" className="text-[13px] text-(--color-success)" />
            <span className="text-[11.5px] text-(--color-secondary)">{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 区块 ── */

export function CapabilityGrid() {
  return (
    <section className="mx-auto w-full max-w-[1120px] px-5 pb-4 pt-16 sm:px-10 md:pt-24">
      {/* 区块头：设问 + 双色大标题（FoldText 折起展开）+ 副文案，编辑式排版 */}
      <div className="flex max-w-[760px] flex-col gap-5 pb-6 md:pb-10">
        <h2 className="m-0 font-sans text-[clamp(26px,3.8vw,42px)] font-semibold leading-[1.32] tracking-[0.02em]">
          <FoldText text={COPY.titleLead} className="text-(--color-secondary)" stagger={30} />
          <br />
          <FoldText
            text={COPY.titleStrong}
            className="text-(--color-base-content)"
            startDelay={COPY.titleLead.length * 30 + 120}
          />
          <br />
          <FoldText
            text={COPY.titleMuted}
            className="text-(--color-secondary)"
            startDelay={(COPY.titleLead.length + COPY.titleStrong.length) * 30 + 240}
          />
        </h2>
        <p className="m-0 max-w-[560px] text-[13.5px] leading-[1.85] text-(--color-secondary)">{COPY.sub}</p>
      </div>

      {/* 能力行：01 为两行通栏结构，其余文/视左右交替，纯留白拉开节奏 */}
      <div>
        <ReportRow />
        <FeatureRow
          {...COPY.features.sync}
          visual={<TokenRatioVisual />}
          flip
        />
        <FeatureRow
          {...COPY.features.device}
          visual={<DeviceLineArt />}
          className="pb-8 md:pb-10"
        />
        <FeatureRow
          {...COPY.features.security}
          visual={<SecurityVisual />}
          flip
        />
        <FeatureRow
          {...COPY.features.disk}
          visual={<DiskVisual />}
        />
      </div>

      {/* 收尾陈述：FoldText 大字宣言，衔接页脚 */}
      <div className="flex flex-col gap-5 py-20 md:py-28">
        <p className="m-0 max-w-[860px] font-sans text-[clamp(21px,2.8vw,32px)] font-semibold leading-[1.5] tracking-[0.02em]">
          <FoldText text={COPY.closing.strong} className="text-(--color-base-content)" stagger={30} />
        </p>
        <p className="m-0 max-w-[640px] text-[13.5px] leading-[1.85] text-(--color-secondary)">{COPY.closing.rest}</p>
      </div>
    </section>
  );
}

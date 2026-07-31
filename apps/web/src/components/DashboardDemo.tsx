import { Icon } from "@iconify/react";
import { useEffect, useState, type ReactNode } from "react";

/**
 * 落地页产品演示：按真实产品行为复刻的 5 场景自动循环。
 * 接入项目（侧栏真实引导「在 CLI 按 E 添加」，绑定目录后项目行滑入）
 * → 创建任务（卡片左缘绿色「新建任务」页签 → 行内输入标题，生成草稿行）
 * → Leader 派单（LeaderStatusBar 位于看板卡上方，PM 自动诊断并改派 Worker，无需手动指派）
 * → CLI 执行（Maple Runner TUI：品牌行 / 日志流 / Worker 标签栏 / 项目栏 / 状态行）
 * → 完成回报（右侧详情栏：状态 + 描述 + Token 用量 + 真实控制台截图）。
 * - 侧栏透明浮于灰底（真实 .board-sidebar 无 border-r），看板为白色圆角卡（.board-main）。
 * - 任务列表为真实表格结构：任务 / Worker / 状态 / 上次提及；进行中按真实渲染（spinner + 运行时长）。
 * - Worker 图标使用 board-ui 真实 logo（claude / codex / kimi）；Leader 只出现在 LeaderStatusBar。
 * - CLI 与 Web 分离：CLI 场景窗口收窄，独立 Runner 浮窗覆盖其右下角。
 * - 虚拟 cursor 逐场景移动，只在真实可点击处（新建任务页签、状态徽章）按下。
 * 场景时钟是唯一的 `scene` state，视觉全部随场景推导；左上角指示器可点击跳转。
 */

/* ── 场景定义与文案 ── */

const SCENES = [
  { key: "join", label: "接入项目", caption: "在 CLI 按 E 绑定一个目录，项目即刻出现在控制台。", tip: "将你多台电脑上的项目同时归拢至一个面板进行管理", duration: 3200 },
  { key: "create", label: "创建任务", caption: "点卡片左缘「新建任务」，一句话写下要做的事。", tip: "像 Notion 一样优雅管理待办项目，自动走流水线完成开发验收闭环", duration: 3800 },
  { key: "assign", label: "Leader 派单", caption: "Leader PM 自动诊断并派单，无需手动指派。", tip: "待办项目自动进入工作流，由领导模型决定进入哪个窗口、是否创建新 Worker 窗口，且能根据任务自动选择你分配的合适模型", duration: 4600 },
  { key: "cli", label: "CLI 执行", caption: "执行发生在 Runner 主机的终端，看板实时同步。", tip: "CLI 挂接各种工具，你的最后一个终端", duration: 6200 },
  { key: "report", label: "完成回报", caption: "Worker 自报结果与验收截图，自动汇总回控制台。", tip: "Maple 完成后自动将结果写入报告，可配置是否截图记录至服务器（插件形式）", duration: 5000 }
] as const;

const DEMO = {
  project: "orbit-web",
  taskTitle: "为商城接入积分系统",
  leaderModel: "Opus 1M",
  workerModel: "K3 256K",
  doneTask: { title: "修复登录页样式整理", mention: "昨天" },
  reportText: "积分累计与余额查询已实现：下单钩子写入积分流水，余额接口与页面已联调，单测 12/12 通过。",
  reportUsage: "Token 输入 38.2k · 缓存 12.1k · 输出 4.4k"
} as const;

/** Runner 日志流：文案取自真实 runner-loop / process-executor 输出。 */
const TUI_LINES = [
  { tone: "sys", text: "[maple] 领取 Todo：为商城接入积分系统" },
  { tone: "dim", text: "启动 Kimi session：kimi" },
  { tone: "dim", text: "读取 src/order/*.ts …" },
  { tone: "dim", text: "文件修改 src/points/service.ts" },
  { tone: "ok", text: "✓ 单测通过 12/12" },
  { tone: "ok", text: "Kimi 执行完成" }
] as const;

/** cursor 逐场景落点（相对裁切容器的百分比）与点击时机；click 超出场次 = 只指向不按下。 */
const CURSOR_SPOTS = [
  { x: 9, y: 24, click: 99999 },
  { x: 16, y: 16, click: 800 },
  { x: 87, y: 20, click: 1000 },
  { x: 74, y: 58, click: 99999 },
  { x: 72, y: 45, click: 99999 }
] as const;

/* ── 时钟与小动画原语 ── */

function useSceneClock() {
  const [scene, setScene] = useState(0);
  // tick：手动跳场景时重排计时器。
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setScene((s) => (s + 1) % SCENES.length), SCENES[scene].duration);
    return () => clearTimeout(timer);
  }, [scene, tick]);
  const jump = (index: number) => {
    setScene(index);
    setTick((t) => t + 1);
  };
  return { scene, tick, jump };
}

/** 延迟挂载：active 后 ms 毫秒返回 true；active 变回 false 时复位（场景循环重播）。 */
function useDelayed(ms: number, active = true): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) {
      setReady(false);
      return undefined;
    }
    const timer = setTimeout(() => setReady(true), ms);
    return () => clearTimeout(timer);
  }, [ms, active]);
  return ready;
}

/** 演示用运行时长：从 base 秒起每秒 +1，格式与 board-ui RunningElapsed 一致（"45s" / "3m05s"）。 */
function useElapsed(baseSeconds: number): string {
  const [total, setTotal] = useState(baseSeconds);
  useEffect(() => {
    setTotal(baseSeconds);
    const timer = setInterval(() => setTotal((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [baseSeconds]);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
}

/** 打字机文本；caret 为光标。 */
function TypeText({
  text,
  speed = 55,
  caret = false,
  className = ""
}: {
  text: string;
  speed?: number;
  caret?: boolean;
  className?: string;
}) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return (
    <span className={className}>
      {text.slice(0, n)}
      {caret && <span className={`dd-caret ${n >= text.length ? "dd-caret-blink" : ""}`} />}
    </span>
  );
}

/** 延迟淡入容器。 */
function Reveal({ delay = 0, className = "", children }: { delay?: number; className?: string; children: ReactNode }) {
  return (
    <div className={`dd-enter ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ── 通用小件 ── */

type ChipTone = "neutral" | "info" | "planning" | "success";

/** 状态徽章：对齐真实 ui-badge（6px 圆角；待办/队列中/草稿为 base-200 中性底）。 */
function StatusChip({ label, tone, pulse = false }: { label: string; tone: ChipTone; pulse?: boolean }) {
  const color =
    tone === "success"
      ? "var(--color-success)"
      : tone === "info"
        ? "var(--color-info)"
        : tone === "planning"
          ? "color-mix(in srgb, var(--color-planning) 85%, var(--color-base-content))"
          : "var(--color-secondary)";
  const background = tone === "neutral" ? "var(--color-base-200)" : `color-mix(in srgb, ${color} 14%, transparent)`;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-px text-[9px] font-medium"
      style={{ color, background }}
    >
      {pulse && <span className="dd-pulse-dot h-1 w-1 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  );
}

type WorkerKind = "claude" | "codex" | "kimi";

const WORKER_LOGO_SRC: Record<WorkerKind, string> = {
  claude: "/workers/worker-claude.png",
  codex: "/workers/worker-codex.png",
  kimi: "/workers/worker-kimi.png"
};

const WORKER_LOGO_ALT: Record<WorkerKind, string> = {
  claude: "Claude",
  codex: "Codex",
  kimi: "Kimi"
};

/** 真实 Worker logo（与 board-ui 同一套资产）；codex 为黑色透明底，暗色下反白。 */
function WorkerLogo({ kind, size = 14, className = "" }: { kind: WorkerKind; size?: number; className?: string }) {
  return (
    <img
      src={WORKER_LOGO_SRC[kind]}
      alt={WORKER_LOGO_ALT[kind]}
      width={size}
      height={size}
      className={`shrink-0 ${kind === "codex" ? "dd-logo-invert" : ""} ${className}`.trim()}
      loading="lazy"
      decoding="async"
    />
  );
}

/* ── 左侧栏：透明浮于灰底（真实 .board-sidebar 无分割线） ── */

function SideRow({
  icon,
  label,
  active = false,
  trailing
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
        active
          ? "bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-base-content)_10%,transparent)_0%,transparent_100%)] text-(--color-base-content)"
          : "text-(--color-secondary)"
      }`}
    >
      <span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center text-[12px]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </div>
  );
}

function SideGroupLabel({ children }: { children: string }) {
  return (
    <p className="px-2 pb-0.5 pt-3 text-[9px] font-medium uppercase tracking-wider text-(--color-secondary) opacity-70">
      {children}
    </p>
  );
}

/** 空项目引导：复刻 AppSidebar 真实空态「在 CLI 按 E 添加」。 */
function SidebarEmptyHint() {
  return (
    <p className="m-0 mt-1 flex items-center gap-1.5 px-2 text-[10.5px] text-(--color-secondary)/60">
      <Icon icon="mingcute:terminal-box-line" className="flex-none text-[12px] opacity-70" />
      在 CLI 按
      <kbd className="flex h-[16px] min-w-[16px] items-center justify-center rounded-[4px] border border-(--color-base-content)/15 bg-(--color-base-content)/[0.06] px-1 font-mono text-[9px] font-semibold text-(--color-base-content)/70">
        E
      </kbd>
      添加
    </p>
  );
}

function DemoSidebar({ scene }: { scene: number }) {
  const joined = useDelayed(1100, scene === 0);
  const showProject = scene > 0 || joined;
  const working = scene === 3;

  return (
    <aside className="hidden w-[168px] shrink-0 flex-col p-2 sm:flex">
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <Icon icon="mingcute:quill-pen-ai-fill" className="text-[14px] text-(--color-primary)" />
        <span className="text-[12.5px] font-semibold tracking-tight text-(--color-base-content)">MapleCode</span>
      </div>
      <div className="pt-2">
        <SideRow icon={<Icon icon="mingcute:home-3-line" />} label="概览" active={scene === 0} />
      </div>

      <SideGroupLabel>项目</SideGroupLabel>
      <div className="flex flex-col gap-0.5">
        {showProject ? (
          <div className="dd-enter">
            <SideRow
              icon={<Icon icon="mingcute:folder-2-line" />}
              label={DEMO.project}
              active={scene > 0}
              trailing={
                scene === 0 ? (
                  <span className="rounded bg-[color-mix(in_srgb,var(--color-success)_16%,transparent)] px-1 py-px text-[8.5px] font-medium text-(--color-success)">
                    新
                  </span>
                ) : null
              }
            />
          </div>
        ) : (
          <SidebarEmptyHint />
        )}
      </div>

      <SideGroupLabel>Worker</SideGroupLabel>
      <div className="flex flex-col gap-0.5">
        <SideRow icon={<WorkerLogo kind="claude" size={13} />} label={DEMO.leaderModel} />
        <SideRow icon={<WorkerLogo kind="codex" size={13} />} label="5.6 Sol Max" />
        <SideRow
          icon={<WorkerLogo kind="kimi" size={13} />}
          label={DEMO.workerModel}
          trailing={working ? <span className="dd-shimmer text-[10px] font-semibold">x1</span> : null}
        />
      </div>

      <SideGroupLabel>Runner</SideGroupLabel>
      <SideRow
        icon={<Icon icon="mingcute:windows-line" className="text-[#56a8f5]" />}
        label="holybread"
        trailing={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.45)]" />}
      />

      <div className="mt-auto flex items-center gap-2 px-1.5 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-(--color-primary)">
          <Icon icon="mingcute:link-line" className="text-[11px] text-white" />
        </span>
        <span className="truncate text-[11px] font-medium text-(--color-base-content)">用户的工作区</span>
      </div>
    </aside>
  );
}

/* ── 场景 0：执行总览（新项目尚未有数据，全部为 0） ── */

function SceneOverview() {
  const legend = [
    { label: "已完成", count: 0, color: "var(--color-success)" },
    { label: "进行中", count: 0, color: "var(--color-info)" },
    { label: "待处理", count: 0, color: "var(--color-secondary)" },
    { label: "需信息", count: 0, color: "var(--color-warning)" }
  ];
  return (
    <div className="absolute inset-0 overflow-hidden py-2 pl-5 pr-2 sm:py-2.5">
      <header className="mb-3">
        <div className="flex items-center gap-2">
          <Icon icon="mingcute:dashboard-2-line" className="text-[17px] text-(--color-base-content) opacity-80" />
          <h3 className="m-0 text-[17px] font-medium leading-tight tracking-tight text-(--color-base-content)">执行总览</h3>
        </div>
        <p className="m-0 pl-[25px] text-[10px] text-(--color-secondary) opacity-80">Execution Overview</p>
      </header>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-[14px] bg-(--color-base-100) p-3.5">
          <div className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-medium text-(--color-secondary)">
            <Icon icon="mingcute:chart-pie-line" className="text-[12px] opacity-60" />
            <span>任务分布</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative h-[72px] w-[72px] shrink-0">
              <svg viewBox="0 0 84 84" className="h-full w-full">
                <circle
                  cx="42"
                  cy="42"
                  r="30"
                  fill="none"
                  strokeWidth="13"
                  stroke="color-mix(in srgb, var(--color-secondary) 22%, transparent)"
                />
              </svg>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="text-[13px] font-semibold text-(--color-base-content)">0</span>
              </div>
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1.5">
              {legend.map((item) => (
                <div key={item.label} className="flex min-w-0 items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: item.color }} />
                  <span className="truncate text-[10px] text-(--color-secondary)">{item.label}</span>
                  <span className="ml-auto text-[10px] font-medium tabular-nums text-(--color-base-content)">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-[14px] bg-(--color-base-100) p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-(--color-secondary)">
              <Icon icon="mingcute:link-line" className="text-[12px] opacity-60" />
              <span>已连接 Worker</span>
            </div>
            <span className="font-mono text-[10px] tabular-nums text-(--color-secondary)">1/1</span>
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.35)]" />
            <Icon icon="mingcute:windows-line" className="shrink-0 text-[12px] text-[#56a8f5]" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-(--color-base-content)">holybread</span>
            <WorkerLogo kind="claude" size={12} className="opacity-80" />
            <WorkerLogo kind="kimi" size={12} className="opacity-80" />
            <span className="shrink-0 whitespace-nowrap font-mono text-[9.5px] text-(--color-secondary) opacity-70">刚刚</span>
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-[14px] bg-(--color-base-100) p-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-medium text-(--color-secondary)">
          <Icon icon="mingcute:chart-bar-line" className="text-[12px] opacity-60" />
          <span>Token 用量</span>
          <span className="ml-auto hidden text-[9px] font-normal opacity-60 sm:inline">按项目统计，颜色区分 Worker</span>
        </div>
        <div className="flex h-[132px] flex-col items-center justify-center gap-2 opacity-40">
          <Icon icon="mingcute:chart-bar-line" className="text-[22px]" />
          <span className="text-[10.5px]">暂无用量数据</span>
        </div>
      </div>
    </div>
  );
}

/* ── 看板场景（1-4 共用）：LeaderStatusBar + 左缘「新建任务」页签 + 任务表格 ── */

/** 任务行阶段：随场景推进（hidden → typing → draft → todo → planning → queued → running → done）。 */
type RowPhase = "hidden" | "typing" | "draft" | "todo" | "planning" | "queued" | "running" | "done";

/** Leader PM 状态条：复刻真实 LeaderStatusBar（看板卡上方、与卡片同一层）。 */
function LeaderBar({ planning }: { planning: boolean }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] leading-none text-(--color-secondary)">
      <WorkerLogo kind="claude" size={13} className="opacity-80" />
      <span className="font-semibold text-(--color-base-content)/85">领导</span>
      <span className="text-(--color-secondary)/75">{DEMO.leaderModel}</span>
      <span className="ml-auto flex items-center gap-1.5 text-[10px] text-(--color-secondary)/60">
        {planning ? <span className="dd-shimmer dd-fade font-semibold">x1</span> : null}
        <span className="size-1.5 rounded-full bg-(--color-success)" />
        在线
      </span>
    </div>
  );
}

/** 卡片左缘「新建任务」悬浮页签：复刻真实 .board-add-tab（莫兰迪灰绿，收起只露加号）。 */
function AddTaskTab({ expanded }: { expanded: boolean }) {
  return (
    <div
      aria-hidden
      className="absolute right-full top-[26px] z-10 flex h-[24px] items-center overflow-hidden whitespace-nowrap rounded-l-[7px] text-[10px] font-medium text-white/95 transition-[width] duration-200 ease-out"
      style={{
        width: expanded ? 84 : 22,
        background: "#93a894",
        boxShadow: "-3px 3px 12px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.16)"
      }}
    >
      <span className={`flex-1 pl-2.5 ${expanded ? "opacity-100 transition-opacity delay-100 duration-150" : "opacity-0"}`}>
        新建任务
      </span>
      <span className="absolute right-0 top-0 flex h-full w-[22px] items-center justify-center">
        <Icon icon="mingcute:add-line" className="text-[13px]" />
      </span>
    </div>
  );
}

/** 行内状态单元格：running 按真实渲染（spinner + 运行时长，不显示文字）。 */
function RowStatusCell({ phase }: { phase: RowPhase }) {
  const elapsed = useElapsed(82);
  if (phase === "running") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-px text-[9.5px] font-medium"
        style={{ color: "var(--color-info)", background: "color-mix(in srgb, var(--color-info) 14%, transparent)" }}
      >
        <Icon icon="mingcute:loading-3-line" className="animate-spin text-[10px] opacity-80" />
        <span className="tabular-nums">{elapsed}</span>
      </span>
    );
  }
  const chip: Record<Exclude<RowPhase, "hidden" | "running">, { label: string; tone: ChipTone }> = {
    typing: { label: "草稿", tone: "neutral" },
    draft: { label: "草稿", tone: "neutral" },
    todo: { label: "待办", tone: "neutral" },
    planning: { label: "规划中", tone: "planning" },
    queued: { label: "队列中", tone: "neutral" },
    done: { label: "已完成", tone: "success" }
  };
  const { label, tone } = chip[phase as Exclude<RowPhase, "hidden" | "running">];
  return (
    <span key={phase} className="dd-fade inline-flex">
      <StatusChip label={label} tone={tone} />
    </span>
  );
}

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_40px_72px_62px] items-center gap-2";

/** 新任务行：标题（草稿态行内打字）/ Worker logo / 状态 / 上次提及。 */
function BoardTaskRow({ phase }: { phase: Exclude<RowPhase, "hidden"> }) {
  const dispatched = phase === "queued" || phase === "running" || phase === "done";
  return (
    <div className={`dd-enter ${ROW_GRID} border-b border-(--color-base-300)/35 py-2`}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate px-0.5 text-[11.5px] font-medium text-(--color-base-content)">
          {phase === "typing" ? <TypeText text={DEMO.taskTitle} caret speed={65} /> : DEMO.taskTitle}
        </span>
      </span>
      <span className="flex justify-center">
        <span className="flex h-6 w-6 items-center justify-center rounded-md">
          {dispatched ? (
            <span key="kimi" className="dd-enter-fast inline-flex">
              <WorkerLogo kind="kimi" size={15} />
            </span>
          ) : (
            <WorkerLogo kind="claude" size={15} />
          )}
        </span>
      </span>
      <span className="flex items-center">
        <RowStatusCell phase={phase} />
      </span>
      <span className="text-[10px] text-(--color-secondary)">刚刚</span>
    </div>
  );
}

/** 常驻已完成行：让表格在场景 1 也不空。 */
function BoardDoneRow() {
  return (
    <div className={`${ROW_GRID} py-2`}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate px-0.5 text-[11.5px] font-medium text-(--color-base-content)">{DEMO.doneTask.title}</span>
      </span>
      <span className="flex justify-center">
        <span className="flex h-6 w-6 items-center justify-center rounded-md">
          <WorkerLogo kind="codex" size={15} />
        </span>
      </span>
      <span className="flex items-center">
        <StatusChip label="已完成" tone="success" />
      </span>
      <span className="text-[10px] text-(--color-secondary)">{DEMO.doneTask.mention}</span>
    </div>
  );
}

function BoardFrame({ scene }: { scene: number }) {
  // 场景 1：cursor 点击页签（800ms）后 1000ms 插入草稿行，标题行内打字。
  const rowInserted = useDelayed(1000, scene === 1);
  // 场景 2：cursor 点状态徽章（1000ms）→ 待办；PM 诊断 → 规划中；派单 kimi → 队列中。
  const todoSet = useDelayed(1000, scene === 2);
  const planning = useDelayed(1500, scene === 2);
  const queued = useDelayed(3000, scene === 2);

  const phase: RowPhase =
    scene === 1
      ? rowInserted
        ? "typing"
        : "hidden"
      : scene === 2
        ? queued
          ? "queued"
          : planning
            ? "planning"
            : todoSet
              ? "todo"
              : "draft"
        : scene === 3
          ? "running"
          : "done";

  return (
    <div className="absolute inset-0 flex flex-col pb-2 pl-5 pr-2 pt-0.5">
      <LeaderBar planning={phase === "planning"} />
      <div className="relative min-h-0 flex-1">
        <AddTaskTab expanded={scene === 1 && !rowInserted} />
        {/* 白色看板卡（.board-main） */}
        <div className="h-full overflow-hidden rounded-[12px] border border-(--color-base-300)/40 bg-(--color-base-100) px-3">
          {/* 表头：任务 / Worker / 状态 / 上次提及（图标 + 文字，与真实表头一致） */}
          <div className={`${ROW_GRID} border-b border-(--color-base-300)/50 pb-1.5 pt-2.5 text-[10px] font-medium text-(--color-secondary)`}>
            <span className="flex items-center gap-1">
              <Icon icon="mingcute:task-line" className="text-[12px] opacity-70" />
              任务
            </span>
            <span className="flex justify-center">
              <Icon icon="mingcute:robot-line" className="text-[12px] opacity-70" />
            </span>
            <span className="flex items-center gap-1">
              <Icon icon="mingcute:signal-line" className="text-[12px] opacity-70" />
              状态
            </span>
            <span className="flex items-center gap-1">
              <Icon icon="mingcute:time-line" className="text-[12px] opacity-70" />
              上次提及
            </span>
          </div>
          {phase !== "hidden" && <BoardTaskRow key={`task-${scene}`} phase={phase} />}
          <BoardDoneRow />
        </div>
      </div>
    </div>
  );
}

/* ── 场景 3：Maple Runner TUI 浮窗（覆盖收窄后的窗口右下） ── */

function TuiLogLine({ line, delay }: { line: (typeof TUI_LINES)[number]; delay: number }) {
  const show = useDelayed(delay);
  if (!show) return <span className="block min-h-[14px]" />;
  const toneClass = line.tone === "sys" ? "text-zinc-300" : line.tone === "ok" ? "text-emerald-400" : "text-zinc-500";
  return <span className={`dd-enter-fast block ${toneClass}`}>{line.text}</span>;
}

/** 真实 Maple Runner 界面：品牌行 → 日志流 → Worker 标签栏 → 分割线 → 项目栏 → 状态行。 */
function CliFloatWindow() {
  return (
    <div className="dd-popwin absolute bottom-4 right-2 z-20 w-[88%] sm:bottom-6 sm:right-3 sm:w-[46%] md:w-[44%]">
      <div className="overflow-hidden rounded-[14px] border border-white/12 bg-[#111113]/70 backdrop-blur-md">
        <div className="flex items-center gap-2 border-b border-white/8 px-3.5 py-2.5">
          <span className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#ff5f57] opacity-80" />
            <span className="h-2 w-2 rounded-full bg-[#febc2e] opacity-80" />
            <span className="h-2 w-2 rounded-full bg-[#28c840] opacity-80" />
          </span>
          <span className="font-mono text-[10px] text-zinc-400">Maple CLI · holybread</span>
          <span className="ml-auto rounded border border-white/10 px-1.5 py-px text-[8.5px] font-medium uppercase tracking-wider text-zinc-500">
            独立终端
          </span>
        </div>
        <div className="flex flex-col px-3 py-2.5 font-mono text-[10px] leading-relaxed">
          {/* 品牌行 */}
          <p className="m-0">
            <span className="text-violet-400">●</span> <span className="font-semibold text-zinc-100">Maple Runner</span>
            <span className="text-zinc-500"> · 用户的工作区 · holybread</span>
          </p>
          {/* 日志流 */}
          <div className="mt-1.5 flex flex-col gap-[3px]">
            {TUI_LINES.map((line, i) => (
              <TuiLogLine key={line.text} line={line} delay={700 + i * 620} />
            ))}
          </div>
          {/* Worker 标签栏：PM 在前（已结束为空心），执行中的 Worker 标签反色高亮 */}
          <div className="mt-2 flex items-center gap-1 text-[9px]">
            <span className="rounded-[4px] bg-white/5 px-1.5 py-px text-zinc-500">○ PM orbit-web · Claude</span>
            <span className="dd-fade rounded-[4px] bg-white/85 px-1.5 py-px font-medium text-zinc-900" style={{ animationDelay: "700ms" }}>
              ● 1 orbit-web · Kimi
            </span>
            <span className="ml-1 text-[8.5px] text-zinc-600">← → 切换记录</span>
          </div>
          {/* 分割线 */}
          <div className="my-1.5 h-px bg-white/8" />
          {/* 项目栏 */}
          <p className="m-0 text-[9px]">
            <span className="text-violet-400">E</span> <span className="text-zinc-500">添加项目</span>
            <span className="ml-3 text-zinc-500">orbit-web</span>
            <span className="ml-1.5 text-emerald-300/80">PM已派单</span>
          </p>
          {/* 状态行 */}
          <p className="m-0 mt-0.5 flex items-center text-[9px]">
            <span>
              <span className="text-violet-400">Q</span> <span className="text-zinc-600">终止退出</span>
              <span className="ml-2.5 text-emerald-400">●</span> <span className="text-zinc-500">已连接</span>
            </span>
            <span className="ml-auto text-zinc-600">缓存 12 MB</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── 场景 4：完成回报（右侧详情栏 + 压暗底衬 + 真实截图产物） ── */

/** 任务详情右侧栏：加宽复刻 TaskDetailPanel，附真实控制台截图。 */
function ReportPanelOverlay() {
  return (
    <div className="absolute inset-0 z-10">
      {/* 压暗其他区域 */}
      <div className="dd-fade absolute inset-0 bg-black/45" />
      {/* 右侧详情栏 */}
      <aside className="dd-slide-in absolute inset-y-0 right-0 flex w-[86%] flex-col border-l border-(--color-base-300) bg-(--color-base-100) sm:w-[54%] md:w-[46%]">
        <div className="flex items-center gap-2 px-4 pt-3.5">
          <Icon icon="mingcute:file-line" className="text-[13px] text-(--color-secondary)" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-secondary)">任务回报</span>
          <span className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-(--color-secondary)">
            <Icon icon="mingcute:close-line" className="text-[13px]" />
          </span>
        </div>
        <div className="px-4 pt-2.5">
          <h4 className="m-0 text-[14.5px] font-semibold tracking-tight text-(--color-base-content)">{DEMO.taskTitle}</h4>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusChip label="已完成" tone="success" />
            <span className="text-[9.5px] text-(--color-secondary)">用时 6m 12s · 刚刚</span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden px-4 py-3.5">
          {/* 回报正文：仿真实 TaskDetailPanel —— 「执行报告」页签头 + 纯文本正文，无大色块 */}
          <Reveal delay={500}>
            <section>
              <div className="flex items-center gap-3.5 border-b border-(--color-base-300)/40">
                <p className="m-0 flex items-center gap-1.5 pb-1.5 text-[10px] font-medium text-(--color-secondary)">
                  <Icon icon="mingcute:comment-line" className="text-[12px] opacity-70" />
                  执行报告
                </p>
                <span className="relative flex items-center gap-1 self-stretch pb-1.5 text-[9.5px] font-medium text-(--color-primary)">
                  <WorkerLogo kind="kimi" size={11} />
                  刚刚
                  <span className="absolute inset-x-0 bottom-0 h-[1.5px] rounded-t-full bg-(--color-primary)" />
                </span>
              </div>
              <div className="pt-2.5">
                <p className="m-0 text-[10.5px] font-semibold leading-relaxed text-(--color-base-content)">状态：已完成</p>
                <p className="m-0 mt-1 text-[10.5px] leading-relaxed text-(--color-secondary)">{DEMO.reportText}</p>
                <p className="m-0 mt-2 font-mono text-[9px] text-(--color-secondary) opacity-70">{DEMO.reportUsage}</p>
              </div>
            </section>
          </Reveal>

          {/* 验收截图：仿真实附件画廊 —— 小标签 + 缩略图网格，不再整行铺满 */}
          <Reveal delay={1050}>
            <section>
              <p className="m-0 mb-1.5 flex items-center gap-1.5 text-[9.5px] text-(--color-secondary) opacity-80">
                <Icon icon="mingcute:camera-line" className="text-[11px] opacity-70" />
                验收截图 · 1
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div
                  className="relative aspect-video overflow-hidden rounded-[8px] border border-(--color-base-300)/60 bg-(--color-base-200)"
                  title="console-screenshot.png"
                >
                  <img
                    src="/console-screenshot.png"
                    alt="执行现场：MapleCode 控制台截图"
                    className="h-full w-full object-cover object-top"
                    loading="lazy"
                  />
                </div>
              </div>
            </section>
          </Reveal>

          {/* 同步状态：轻量行内提示，不用整条进度条 */}
          <Reveal delay={1600}>
            <div className="mt-auto flex items-center gap-1.5 text-[9.5px] text-(--color-secondary)">
              <Icon icon="mingcute:check-circle-fill" className="text-[12px] text-(--color-success)" />
              回报已同步至控制台与 Leader 会话
            </div>
          </Reveal>
        </div>
      </aside>
    </div>
  );
}

/* ── 虚拟 cursor：逐场景移动；只在真实可点击处按下 ── */

function CursorPress({ at }: { at: number }) {
  const pressed = useDelayed(at);
  return (
    <div className={`relative ${pressed ? "dd-cursor-press" : ""}`}>
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="var(--color-base-content)"
        stroke="var(--color-base-200)"
        strokeWidth="1.5"
        className="drop-shadow-[0_2px_5px_rgba(0,0,0,0.5)]"
      >
        <path d="M5 3l14 8-6 2-3 6L5 3z" strokeLinejoin="round" />
      </svg>
      {pressed && (
        <span className="dd-ripple absolute -left-[9px] -top-[9px] h-10 w-10 rounded-full border-2 border-(--color-primary)" />
      )}
    </div>
  );
}

function DemoCursor({ scene, tick }: { scene: number; tick: number }) {
  const spot = CURSOR_SPOTS[scene];
  // 光标靠近右半区时 tooltip 翻到左侧，避免被裁切窗口 overflow-hidden 切掉
  const flipX = spot.x > 55;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-30 hidden sm:block"
      style={{
        left: `${spot.x}%`,
        top: `${spot.y}%`,
        transition: "left 0.7s cubic-bezier(0.3, 0.7, 0.3, 1), top 0.7s cubic-bezier(0.3, 0.7, 0.3, 1)"
      }}
    >
      <CursorPress key={`${scene}-${tick}`} at={spot.click} />
      {/* 跟随光标的场景说明 tooltip（极简卡片风） */}
      <div
        key={`tip-${scene}-${tick}`}
        className={`dd-fade absolute top-[26px] w-[220px] rounded-[8px] bg-(--color-base-100) px-2.5 py-2 text-[10.5px] leading-relaxed text-(--color-base-content)/80 shadow-[0_1px_4px_color-mix(in_srgb,var(--color-primary)_12%,transparent)] ${
          flipX ? "right-[26px]" : "left-[26px]"
        }`}
      >
        {SCENES[scene].tip}
      </div>
    </div>
  );
}

/* ── 演示窗口 + 场景指示器 ── */

const DEMO_STYLES = `
@keyframes dd-fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes dd-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dd-popwin { from { opacity: 0; transform: translateY(18px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes dd-slide-in { from { opacity: 0; transform: translateX(56px); } to { opacity: 1; transform: none; } }
@keyframes dd-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes dd-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes dd-ripple { 0% { opacity: 0.75; transform: scale(0.35); } 100% { opacity: 0; transform: scale(1.7); } }
@keyframes dd-cursor-press { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.8); } }
@keyframes dd-pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.45); } 70% { box-shadow: 0 0 0 5px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
@keyframes dd-shimmer-sweep { from { background-position: 200% 0; } to { background-position: 0 0; } }
.dd-enter { animation: dd-fade-up 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.dd-enter-fast { animation: dd-fade-up 0.25s ease-out both; }
.dd-fade { animation: dd-fade 0.4s ease-out both; }
.dd-popwin { animation: dd-popwin 0.55s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.dd-slide-in { animation: dd-slide-in 0.55s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.dd-ripple { animation: dd-ripple 0.65s ease-out both; }
.dd-cursor-press { animation: dd-cursor-press 0.28s ease-in-out both; }
.dd-pulse-dot { animation: dd-pulse-ring 1.4s ease-out infinite; }
.dd-caret { display: inline-block; width: 0.5em; height: 1em; margin-left: 1px; background: currentColor; vertical-align: -0.12em; }
.dd-caret-blink { animation: dd-blink 1s step-end infinite; }
.dd-shimmer {
  background: linear-gradient(110deg, color-mix(in srgb, var(--color-base-content) 35%, transparent) 30%, var(--color-base-content) 50%, color-mix(in srgb, var(--color-base-content) 35%, transparent) 70%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: dd-shimmer-sweep 2.2s linear infinite;
}
.dark .dd-logo-invert { filter: invert(0.88); }
@media (prefers-reduced-motion: reduce) {
  .dd-enter, .dd-enter-fast, .dd-fade, .dd-popwin, .dd-slide-in, .dd-ripple, .dd-cursor-press, .dd-pulse-dot, .dd-caret-blink, .dd-shimmer { animation: none !important; }
}
`;

export function DashboardDemo() {
  const { scene, tick, jump } = useSceneClock();
  const current = SCENES[scene];

  return (
    <div>
      <style>{DEMO_STYLES}</style>

      {/* 场景切换条：纯文字页签，当前项底部细线表示进度 */}
      <div className="mb-4 flex items-center gap-5" role="tablist" aria-label="演示场景">
        {SCENES.map((s, i) => {
          const active = i === scene;
          return (
            <button
              key={active ? `${s.key}-${tick}` : s.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={s.label}
              onClick={() => jump(i)}
              className={`relative shrink-0 cursor-pointer pb-[7px] pt-[3px] text-[12px] font-medium leading-none transition-colors duration-200 ${
                active
                  ? "text-(--color-base-content)"
                  : "text-(--color-secondary)/55 hover:text-(--color-base-content)"
              }`}
            >
              {s.label}
              {active ? (
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden rounded-full bg-(--color-base-300)/45">
                  <span
                    className="absolute inset-0 origin-left rounded-full bg-(--color-primary)"
                    style={{ animation: `dd-progress ${s.duration}ms linear both` }}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
        <p className="m-0 ml-auto hidden min-w-0 truncate text-[11.5px] text-(--color-secondary)/70 lg:block" aria-live="polite">
          {current.caption}
        </p>
      </div>

      {/* 裁切窗口：CLI 场景下窗口收窄，CLI 浮窗覆盖其右下 */}
      <div className="relative h-[430px] overflow-hidden md:h-[500px]">
        {/* 控制台窗口（宽度可动画）；底色对齐真实 .app-frame 中间层 */}
        <div
          className={`h-full transition-[width] duration-700 ease-[cubic-bezier(0.2,0.7,0.3,1)] ${
            scene === 3 ? "sm:w-[72%]" : "w-full"
          }`}
        >
          <div
            className="relative h-full w-full overflow-hidden rounded-[16px] border border-(--color-base-300) text-left backdrop-blur-xl"
            style={{ background: "color-mix(in srgb, var(--color-base-100) 38%, transparent)" }}
          >
            <div className="flex h-full gap-2.5 p-2.5">
              {/* key=tick：手动跳场景时侧栏重挂载，「接入项目」动画可重播；自动轮换不重挂载避免闪烁 */}
              <DemoSidebar key={`side-${tick}`} scene={scene} />
              <main className="relative min-w-0 flex-1">
                {scene === 0 ? <SceneOverview key={`s0-${tick}`} /> : <BoardFrame key={`sb-${scene}-${tick}`} scene={scene} />}
              </main>
            </div>
            {/* CLI 场景：窗口内压暗 */}
            {scene === 3 && <div key={`dim-${tick}`} className="dd-fade absolute inset-0 z-10 bg-black/45" />}
            {/* 回报场景：右侧详情栏 */}
            {scene === 4 && <ReportPanelOverlay key={`rp-${tick}`} />}
          </div>
        </div>

        {/* 独立 CLI 浮窗：覆盖控制台窗口右下角 */}
        {scene === 3 && <CliFloatWindow key={`cli-${tick}`} />}

        {/* 虚拟 cursor */}
        <DemoCursor scene={scene} tick={tick} />
      </div>
    </div>
  );
}

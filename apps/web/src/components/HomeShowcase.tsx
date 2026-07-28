import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";

/**
 * 官网亮点展区：左侧手风琴文案（自动轮播），右侧动态舞台。
 * 四个亮点各配一个专属微可视化，全部 CSS/SVG 动画，无依赖。
 */

const MORANDI_PURPLE = "#a08fb8";
const MORANDI_SAGE = "#9aae9a";

const POINTS = [
  {
    title: "每个任务，都交给最合适的大脑",
    body: "前端、后端、测试各配各的模型，MCP、Skills、CLI 软件按需挂载。任务自动路由，你不再当调度员。"
  },
  {
    title: "一个目标，自动长成一支团队",
    body: "大目标拆成任务树，多任务并发与串行自动编排。不用开十个窗口来回切，心智负担直接归零。"
  },
  {
    title: "你只管去喝咖啡",
    body: "任务跑完自动截图、归档、提醒你。改动长什么样，证据会自己排好队等你点头。"
  },
  {
    title: "不为切换多花一分 token",
    body: "Claude Code、Codex、Kimi 照常接入，会话上下文完整复用。现有工作流零改动，窗口切换的浪费归零。"
  }
] as const;

const ROTATE_MS = 5600;

/* ── 可视化 1：模型自动路由 ── */

const ROUTES = [
  { label: "前端", model: "Claude", chips: ["MCP", "Skills"], top: "16%" },
  { label: "后端", model: "Codex", chips: ["Skills", "CLI"], top: "50%" },
  { label: "测试", model: "Kimi", chips: ["MCP", "CLI"], top: "84%" }
] as const;

function RouterViz() {
  return (
    <div className="absolute inset-0">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {[
          "M 15 50 C 42 50, 52 16, 82 16",
          "M 15 50 C 42 50, 52 50, 82 50",
          "M 15 50 C 42 50, 52 84, 82 84"
        ].map((d) => (
          <g key={d}>
            <path d={d} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path
              d={d}
              fill="none"
              stroke={MORANDI_PURPLE}
              strokeWidth="1.4"
              strokeDasharray="4 8"
              vectorEffect="non-scaling-stroke"
              className="viz-dashflow"
            />
          </g>
        ))}
      </svg>

      <div className="viz-node-pulse absolute left-[2%] top-1/2 w-[13%] min-w-[104px] -translate-y-1/2 rounded-xl bg-[#18181b] px-3 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <p className="m-0 text-[12px] font-medium text-zinc-100">重写鉴权</p>
        <p className="m-0 mt-1 text-[9.5px] tracking-widest text-zinc-500">一个任务</p>
      </div>

      {ROUTES.map((route) => (
        <div
          key={route.label}
          className="absolute right-[2%] w-[16%] min-w-[136px] -translate-y-1/2 rounded-xl bg-[#141416] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          style={{ top: route.top }}
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-zinc-500">{route.label}</span>
            <span className="text-[12.5px] font-medium text-zinc-100">{route.model}</span>
          </div>
          <div className="mt-1.5 flex gap-1">
            {route.chips.map((chip) => (
              <span key={chip} className="rounded-full bg-white/[0.07] px-1.5 py-0.5 font-mono text-[8.5px] text-zinc-400">
                {chip}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── 可视化 2：任务树自动调度 ── */

function TreeViz() {
  return (
    <div className="absolute inset-0">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {[
          { d: "M 50 18 C 50 30, 24 32, 24 44", cls: "tree-line tree-line-a" },
          { d: "M 50 18 C 50 30, 50 32, 50 44", cls: "tree-line tree-line-a" },
          { d: "M 50 18 C 50 30, 76 32, 76 44", cls: "tree-line tree-line-b" },
          { d: "M 76 48 C 76 58, 66 60, 66 70", cls: "tree-line tree-line-c" },
          { d: "M 76 48 C 76 58, 86 60, 86 70", cls: "tree-line tree-line-c" }
        ].map((line) => (
          <path
            key={line.d}
            d={line.d}
            fill="none"
            stroke="rgba(160,143,184,0.55)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className={line.cls}
          />
        ))}
      </svg>

      <div className="tree-root absolute left-1/2 top-[10%] -translate-x-1/2 rounded-lg bg-[#18181b] px-4 py-2 text-[12px] font-medium text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        重写鉴权模块
      </div>

      <div className="tree-node tree-lit-a absolute left-[24%] top-[44%] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#141416] px-3.5 py-2 text-[11.5px] text-zinc-200">
        数据层
      </div>
      <div className="tree-node tree-lit-a absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#141416] px-3.5 py-2 text-[11.5px] text-zinc-200">
        接口
      </div>
      <div className="tree-node tree-lit-b absolute left-[76%] top-[44%] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#141416] px-3.5 py-2 text-[11.5px] text-zinc-200">
        页面
      </div>
      <div className="tree-node tree-lit-c absolute left-[66%] top-[72%] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#141416] px-3 py-1.5 text-[10.5px] text-zinc-300">
        登录页
      </div>
      <div className="tree-node tree-lit-c absolute left-[86%] top-[72%] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#141416] px-3 py-1.5 text-[10.5px] text-zinc-300">
        授权页
      </div>

      <div className="tree-badge tree-badge-a absolute left-[37%] top-[34%] rounded-full px-2 py-0.5 text-[9.5px]" style={{ background: `${MORANDI_PURPLE}26`, color: MORANDI_PURPLE }}>
        并发 × 2
      </div>
      <div className="tree-badge tree-badge-b absolute left-[80%] top-[56%] rounded-full px-2 py-0.5 text-[9.5px]" style={{ background: `${MORANDI_SAGE}22`, color: MORANDI_SAGE }}>
        串行接力
      </div>
    </div>
  );
}

/* ── 可视化 3：完成自动验收（截图 + 提醒） ── */

function CompletionViz() {
  return (
    <div className="absolute inset-0">
      <div className="comp-shot absolute left-1/2 top-[42%] w-[300px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-[#161618] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <span className="size-1.5 rounded-full bg-[#3a3a3e]" />
          <span className="size-1.5 rounded-full bg-[#3a3a3e]" />
          <span className="size-1.5 rounded-full" style={{ background: `${MORANDI_PURPLE}77` }} />
          <span className="ml-1.5 h-3.5 flex-1 rounded-full bg-white/[0.05]" />
        </div>
        <div className="mx-2.5 mb-2.5 rounded-lg bg-[#0f0f11] p-2.5">
          <div className="h-10 rounded-md" style={{ background: `linear-gradient(120deg, ${MORANDI_PURPLE}59, ${MORANDI_PURPLE}1f)` }} />
          <div className="mt-2 h-1.5 w-3/4 rounded-full bg-white/[0.14]" />
          <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-white/[0.08]" />
        </div>
        <div className="flex items-center gap-1.5 px-3 pb-2.5">
          <Icon icon="mingcute:camera-line" className="text-[12px]" style={{ color: MORANDI_SAGE }} />
          <span className="text-[10px] text-zinc-400">验收截图已自动回传</span>
        </div>
      </div>

      <div className="comp-toast absolute bottom-[10%] left-1/2 flex w-[264px] -translate-x-1/2 items-center gap-2.5 rounded-xl bg-[#1c1c20] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full" style={{ background: `${MORANDI_SAGE}26` }}>
          <Icon icon="mingcute:check-line" className="text-[14px]" style={{ color: MORANDI_SAGE }} />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-[11.5px] font-medium text-zinc-100">任务已完成</p>
          <p className="m-0 mt-0.5 truncate text-[10px] text-zinc-500">报告与截图已归档 · 现在提醒你</p>
        </div>
      </div>
    </div>
  );
}

/* ── 可视化 4：上下文兼容，零浪费 ── */

function ContextViz() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 px-[12%]">
      <div className="w-full">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-zinc-500">窗口来回切换</span>
          <span className="font-mono text-[10px] text-zinc-600">上下文反复重读</span>
        </div>
        <div className="mt-2 flex h-7 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-1 overflow-hidden rounded-md bg-white/[0.03]">
              <div className="ctx-waste-block h-full w-[55%] bg-zinc-600/50" style={{ animationDelay: `${i * 0.35}s` }} />
              <div className="h-full flex-1" style={{ background: `${MORANDI_PURPLE}33` }} />
            </div>
          ))}
        </div>
        <p className="m-0 mt-1.5 text-[10px] text-zinc-600">每一段灰色，都是白白烧掉的 token</p>
      </div>

      <div className="w-full">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-zinc-300">Maple 会话延续</span>
          <span className="font-mono text-[10px]" style={{ color: MORANDI_SAGE }}>≈ 0 浪费</span>
        </div>
        <div className="mt-2 h-7 overflow-hidden rounded-md bg-white/[0.03]">
          <div
            className="ctx-fill h-full w-full origin-left"
            style={{ background: `linear-gradient(90deg, ${MORANDI_SAGE}59, ${MORANDI_SAGE}26)` }}
          />
        </div>
        <p className="m-0 mt-1.5 text-[10px] text-zinc-600">上下文只加载一次，现有工作流零改动</p>
      </div>
    </div>
  );
}

const VIZ = [RouterViz, TreeViz, CompletionViz, ContextViz] as const;

/* ── 展区 ── */

export function HomeShowcase({ onEnter, authed }: { onEnter: () => void; authed: boolean }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setActive((value) => (value + 1) % POINTS.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  const ActiveViz = VIZ[active];

  return (
    <section
      className="relative mx-auto w-full max-w-[1120px] px-6 py-24"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <style>{`
        .viz-dashflow { animation: viz-dashflow 1.1s linear infinite; }
        @keyframes viz-dashflow { to { stroke-dashoffset: -12; } }
        .viz-node-pulse { animation: viz-node-pulse 2.6s ease-in-out infinite; }
        @keyframes viz-node-pulse {
          0%, 100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 0 rgba(160,143,184,0.28); }
          55% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 7px rgba(160,143,184,0); }
        }
        .tree-node { opacity: 0.28; transition: none; }
        .tree-lit-a { animation: tree-lit 8s ease-in-out infinite; }
        .tree-lit-b { animation: tree-lit 8s ease-in-out 1.9s infinite; }
        .tree-lit-c { animation: tree-lit 8s ease-in-out 3.4s infinite; }
        @keyframes tree-lit {
          0%, 6% { opacity: 0.28; box-shadow: none; }
          16%, 72% { opacity: 1; box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), 0 0 18px rgba(160,143,184,0.22); }
          86%, 100% { opacity: 0.28; box-shadow: none; }
        }
        .tree-line { stroke-dasharray: 60; stroke-dashoffset: 60; }
        .tree-line-a { animation: tree-draw 8s ease-out 0.4s infinite; }
        .tree-line-b { animation: tree-draw 8s ease-out 2.3s infinite; }
        .tree-line-c { animation: tree-draw 8s ease-out 3.8s infinite; }
        @keyframes tree-draw {
          0% { stroke-dashoffset: 60; opacity: 0; }
          8% { opacity: 1; }
          16%, 80% { stroke-dashoffset: 0; opacity: 1; }
          92%, 100% { stroke-dashoffset: 0; opacity: 0; }
        }
        .tree-badge { opacity: 0; }
        .tree-badge-a { animation: tree-badge 8s ease-in-out 1.0s infinite; }
        .tree-badge-b { animation: tree-badge 8s ease-in-out 3.2s infinite; }
        @keyframes tree-badge {
          0%, 8% { opacity: 0; transform: translateY(4px); }
          18%, 70% { opacity: 1; transform: none; }
          84%, 100% { opacity: 0; }
        }
        .comp-shot { animation: comp-shot 7s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
        @keyframes comp-shot {
          0%, 10% { opacity: 0; transform: translate(calc(-50% + 56px), -50%) rotate(1.5deg); }
          24%, 78% { opacity: 1; transform: translate(-50%, -50%); }
          92%, 100% { opacity: 0; transform: translate(calc(-50% - 24px), -50%); }
        }
        .comp-toast { animation: comp-toast 7s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
        @keyframes comp-toast {
          0%, 30% { opacity: 0; transform: translate(-50%, 22px); }
          42%, 80% { opacity: 1; transform: translate(-50%, 0); }
          94%, 100% { opacity: 0; transform: translate(-50%, 10px); }
        }
        .ctx-waste-block { animation: ctx-flicker 2.4s ease-in-out infinite; }
        @keyframes ctx-flicker { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.95; } }
        .ctx-fill { animation: ctx-fill 4.6s ease-in-out infinite; }
        @keyframes ctx-fill {
          0% { transform: scaleX(0); }
          55%, 82% { transform: scaleX(1); }
          100% { transform: scaleX(0); }
        }
        .showcase-stage-enter { animation: showcase-stage-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both; }
        @keyframes showcase-stage-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .showcase-progress { transform-origin: left; animation: showcase-progress ${ROTATE_MS}ms linear both; }
        @keyframes showcase-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .showcase-list:hover .showcase-progress { animation-play-state: paused; }
      `}</style>

      <p className="m-0 text-center text-[12px] font-medium tracking-[0.2em]" style={{ color: MORANDI_PURPLE }}>
        PARADIGM
      </p>
      <h2 className="m-0 mt-3 text-center text-[26px] font-semibold tracking-tight text-zinc-100 sm:text-[32px]">
        这不是工具升级，是工作流换代
      </h2>
      <p className="m-0 mt-3 text-center text-[13.5px] text-zinc-500">
        你描述结果，Maple 组织一群 AI Worker 把它做完。
      </p>

      <div className="mt-14 grid items-start gap-12 md:grid-cols-[400px_1fr]">
        {/* 左侧：手风琴亮点 */}
        <div className="showcase-list">
          {POINTS.map((point, index) => {
            const isActive = index === active;
            return (
              <button
                key={point.title}
                type="button"
                onClick={() => setActive(index)}
                className="relative block w-full border-t border-white/[0.07] py-5 text-left last:border-b"
              >
                <div className="flex items-baseline gap-4">
                  <span className="font-mono text-[11px] text-zinc-600">0{index + 1}</span>
                  <span
                    className={`text-[17px] font-semibold tracking-tight transition-colors duration-300 ${
                      isActive ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {point.title}
                  </span>
                </div>
                <div
                  className="grid transition-[grid-template-rows,opacity] duration-500 ease-out"
                  style={{ gridTemplateRows: isActive ? "1fr" : "0fr", opacity: isActive ? 1 : 0 }}
                >
                  <div className="overflow-hidden">
                    <p className="m-0 pl-9 pt-2.5 text-[12.5px] leading-6 text-zinc-500">{point.body}</p>
                  </div>
                </div>
                {isActive && !paused ? (
                  <span
                    key={active}
                    className="showcase-progress absolute bottom-0 left-0 h-px w-full"
                    style={{ background: MORANDI_PURPLE }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* 右侧：动态舞台 */}
        <div className="relative h-[340px] overflow-hidden rounded-2xl bg-[#0e0e10] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:h-[380px]">
          <div key={active} className="showcase-stage-enter absolute inset-0">
            <ActiveViz />
          </div>
        </div>
      </div>

      {/* 收尾 CTA */}
      <div className="mt-20 text-center">
        <p className="m-0 text-[15px] text-zinc-400">终端窗口，可以关掉了。</p>
        <button
          type="button"
          onClick={onEnter}
          className="mt-5 rounded-full bg-[#f4f4f5] px-7 py-2.5 text-[13px] font-semibold text-black transition-transform hover:-translate-y-0.5"
        >
          {authed ? "进入控制台" : "开始使用"}
        </button>
      </div>
    </section>
  );
}

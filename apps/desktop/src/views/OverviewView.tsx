import { Icon } from "@iconify/react";
import { CountUp, FadeContent, SpotlightCard, SplitText } from "../components/ReactBits";
import BlurText from "../components/reactbits/BlurText";
import ShinyText from "../components/reactbits/ShinyText";
import GradientText from "../components/reactbits/GradientText";
import AnimatedList from "../components/reactbits/AnimatedList";
import type { McpServerStatus, WorkerKind } from "../domain";

type OverviewViewProps = {
  metrics: {
    pending: number;
    runningCount: number;
    projectCount: number;
    completedCount: number;
    tokenUsageTotal: number;
  };
  mcpStatus: McpServerStatus;
  workerAvailability: Array<{
    kind: WorkerKind;
    label: string;
    executable: string;
    available: boolean;
  }>;
  workerPool: Array<{
    workerId: string;
    workerLabel: string;
    projectName: string;
    mode: "interactive" | "task" | "mixed";
  }>;
};

function formatTokenCompact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} M`;
  return value.toLocaleString("en-US");
}

function formatMode(mode: "interactive" | "task" | "mixed"): string {
  if (mode === "mixed") return "交互 + 任务";
  if (mode === "interactive") return "交互会话";
  return "任务执行";
}

export function OverviewView({ metrics, mcpStatus, workerAvailability, workerPool }: OverviewViewProps) {
  return (
    <section className="h-full flex flex-col p-2 relative z-0">
      <header className="mb-4 px-2">
        <h2 className="text-2xl font-bold tracking-tight m-0 text-primary flex items-center gap-2">
          <Icon icon="mingcute:dashboard-2-fill" className="text-3xl opacity-80" />
          <SplitText text="执行总览" delay={50} />
        </h2>
      </header>

      <div className="flex-1 min-h-0 flex flex-col gap-4">
        {/* Top Row: Metrics & Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-none">
          <FadeContent delay={0} className="flex">
            <SpotlightCard className="w-full rounded-xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col justify-between h-auto min-h-[140px]">
              <div className="text-muted text-sm font-medium flex items-center gap-2 font-sans mb-3">
                <Icon icon="mingcute:check-circle-line" className="text-lg opacity-80" />
                总完成任务数量
              </div>
              <div className="text-5xl font-serif font-semibold tracking-tight text-(--color-base-content) mt-auto">
                <CountUp from={0} to={metrics.completedCount} duration={0.7} />
              </div>
              <p className="m-0 text-xs text-muted font-sans mt-2">全项目累计已完成任务数。</p>
            </SpotlightCard>
          </FadeContent>

          <FadeContent delay={100} className="flex">
            <SpotlightCard className="w-full rounded-xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col justify-between h-auto min-h-[140px]">
              <div className="text-muted text-sm font-medium flex items-center gap-2 font-sans mb-3">
                <Icon icon="mingcute:coin-line" className="text-lg opacity-80" />
                总消耗 Token
              </div>
              <div className="text-4xl font-serif font-semibold tracking-tight text-(--color-base-content) mt-auto">
                <GradientText
                  colors={["#40ffaa", "#4079ff", "#40ffaa", "#4079ff"]}
                  animationSpeed={3}
                  showBorder={false}
                >
                  {formatTokenCompact(metrics.tokenUsageTotal)}
                </GradientText>
              </div>
              <BlurText 
                text={`原始值：${metrics.tokenUsageTotal.toLocaleString("en-US")} tokens`}
                className="m-0 text-xs text-muted font-sans mt-2"
                delay={50}
                animationFrom={{ filter: 'blur(10px)', opacity: 0, y: -10 }}
                animationTo={[{ filter: 'blur(5px)', opacity: 0.5, y: 5 }, { filter: 'blur(0px)', opacity: 1, y: 0 }]}
                onAnimationComplete={() => {}}
              />
            </SpotlightCard>
          </FadeContent>

          <FadeContent delay={200} className="flex">
            <SpotlightCard className="w-full rounded-xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col justify-between h-auto min-h-[140px]">
              <div className="text-muted text-sm font-medium flex items-center gap-2 font-sans mb-3">
                <Icon icon="mingcute:server-line" className="text-lg opacity-80" />
                MCP 运行情况
              </div>
              <div className="flex items-center gap-2 text-base font-sans mt-auto">
                <span className={`w-2 h-2 rounded-full ${mcpStatus.running ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]"}`} />
                <span className="font-medium text-(--color-base-content)">
                  <ShinyText text={mcpStatus.running ? "运行中" : "未运行"} disabled={!mcpStatus.running} speed={3} className="" />
                </span>
              </div>
              <p className="m-0 text-xs text-muted break-all font-mono mt-2">PID: {mcpStatus.pid ?? "—"} | {mcpStatus.command || "内置 N/A"}</p>
            </SpotlightCard>
          </FadeContent>
        </div>

        {/* Bottom Row: Workers & Queues */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          <FadeContent delay={300} className="flex lg:col-span-1">
            <SpotlightCard className="w-full h-full rounded-xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col gap-4">
              <div className="text-muted text-sm font-medium flex items-center gap-2 font-sans flex-none">
                <Icon icon="mingcute:ai-line" className="text-lg opacity-80" />
                Worker 配置情况
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 font-sans pr-2">
                {workerAvailability.map((worker) => (
                  <div key={worker.kind} className="flex items-center justify-between gap-3 group">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2 h-2 rounded-full ${worker.available ? "bg-green-500" : "bg-(--color-base-300)"}`} />
                      <span className="font-medium text-[13px] text-(--color-base-content) group-hover:text-primary transition-colors">{worker.label}</span>
                    </div>
                    <code className="text-[11px] text-muted max-w-[50%] truncate bg-(--color-base-200) px-1.5 py-0.5 rounded border border-(--color-base-300)">{worker.executable || "未配置"}</code>
                  </div>
                ))}
              </div>
            </SpotlightCard>
          </FadeContent>

          <FadeContent delay={400} className="flex lg:col-span-2 relative h-full min-h-[250px]">
            <SpotlightCard className="w-full h-full rounded-xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-0 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 relative z-10 p-6 flex-none border-b border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-base-200)_30%,transparent)]">
                <div className="text-muted text-sm font-medium flex items-center gap-2 font-sans">
                  <Icon icon="mingcute:layers-line" className="text-lg opacity-80" />
                  Worker 运行队列
                </div>
                <div className="flex gap-4 text-[13px] font-sans">
                  <span className="flex items-center gap-1.5 text-blue-500/80"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>运行中 {metrics.runningCount}</span>
                  <span className="flex items-center gap-1.5 text-amber-500/80"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>待办 {metrics.pending}</span>
                  <span className="flex items-center gap-1.5 text-muted"><span className="w-1.5 h-1.5 rounded-full bg-current opacity-50"></span>项目 {metrics.projectCount}</span>
                </div>
              </div>

              <div className="flex-1 overflow-hidden relative z-10">
                {workerPool.length === 0 ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted gap-3">
                    <Icon icon="mingcute:sleep-line" className="text-4xl opacity-30" />
                    <p className="m-0 text-sm font-sans">当前没有运行中的 Worker</p>
                  </div>
                ) : (
                  <AnimatedList
                    items={workerPool.map((entry) => (
                      <div key={entry.workerId} className="w-full flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-(--color-base-200) border border-(--color-base-300) flex items-center justify-center flex-none">
                            <Icon icon="mingcute:terminal-box-line" className="text-lg text-(--color-base-content) opacity-70" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium text-sm text-(--color-base-content) truncate">{entry.workerLabel}</span>
                            <span className="text-[11px] text-muted font-mono mt-0.5">ID: {entry.workerId.slice(0, 8)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-none text-right">
                          <div className="flex flex-col items-end">
                            <span className="text-xs font-medium text-(--color-base-content) truncate max-w-[120px]">{entry.projectName}</span>
                            <span className="text-[11px] text-muted bg-[color-mix(in_srgb,var(--color-base-300)_30%,transparent)] border border-(--color-base-300) px-1.5 py-0.5 rounded mt-1 inline-block">{formatMode(entry.mode)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    onItemSelect={() => {}}
                    showGradients={true}
                    className="w-full h-full p-2 md:p-4"
                    itemClassName="!p-3 !bg-transparent hover:!bg-(--color-base-200) !border-b !border-l-0 !border-r-0 !border-t-0 !border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] !rounded-none !mb-0 transition-colors last:!border-b-0"
                  />
                )}
              </div>
            </SpotlightCard>
          </FadeContent>
        </div>
      </div>
    </section>
  );
}

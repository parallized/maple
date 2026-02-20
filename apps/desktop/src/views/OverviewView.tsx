import { Icon } from "@iconify/react";
import { CountUp, FadeContent, SpotlightCard, SplitText } from "../components/ReactBits";
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
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  return value.toLocaleString("en-US");
}

function formatMode(mode: "interactive" | "task" | "mixed"): string {
  if (mode === "mixed") return "混合模式";
  if (mode === "interactive") return "交互会话";
  return "任务执行";
}

export function OverviewView({ metrics, mcpStatus, workerAvailability, workerPool }: OverviewViewProps) {
  return (
    <section className="h-full flex flex-col p-8 md:p-12 max-w-6xl mx-auto w-full overflow-y-auto overflow-x-hidden bg-transparent">
      {/* Notion-style Header */}
      <FadeContent delay={0} className="flex-none">
        <header className="mb-12">
          <div className="flex items-center gap-3 mb-2">
            <Icon icon="mingcute:dashboard-2-line" className="text-[28px] text-(--color-base-content) opacity-80" />
            <h2 className="text-[32px] leading-tight font-serif font-medium tracking-tight m-0 text-(--color-base-content)">
              <SplitText text="执行总览" delay={30} />
            </h2>
          </div>
          <p className="m-0 text-[14px] text-muted font-sans opacity-80 pl-10">
            Execution Overview
          </p>
        </header>
      </FadeContent>

      <div className="flex-1 min-h-0 flex flex-col gap-8 md:gap-10">
        {/* Top Row: Key Metrics with lots of whitespace */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-none">
          <FadeContent delay={100} className="flex">
            <div className="w-full h-full rounded-[20px] bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-8 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_12%,transparent)] group">
              <div className="flex items-center gap-2.5 text-[14px] font-medium text-muted font-sans">
                <Icon icon="mingcute:check-circle-line" className="text-xl opacity-60 group-hover:opacity-100 transition-opacity" />
                <span>完成任务</span>
              </div>
              <div className="mt-6 mb-8">
                <span className="text-[3.5rem] leading-none font-serif tracking-tight text-(--color-base-content)">
                  <CountUp from={0} to={metrics.completedCount} duration={1.2} />
                </span>
              </div>
              <div className="mt-auto">
                <span className="text-[13px] text-muted opacity-70 font-sans">全项目累计已完成任务数</span>
              </div>
            </div>
          </FadeContent>

          <FadeContent delay={200} className="flex">
            <div className="w-full h-full rounded-[20px] bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-8 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_12%,transparent)] group">
              <div className="flex items-center gap-2.5 text-[14px] font-medium text-muted font-sans">
                <Icon icon="mingcute:coin-line" className="text-xl opacity-60 group-hover:opacity-100 transition-opacity" />
                <span>消耗 Token</span>
              </div>
              <div className="mt-6 mb-8">
                <span className="text-[3.5rem] leading-none font-serif tracking-tight text-(--color-base-content)">
                  {formatTokenCompact(metrics.tokenUsageTotal)}
                </span>
              </div>
              <div className="mt-auto">
                <span className="text-[13px] text-muted opacity-70 font-sans tracking-wide">
                  原始值：{metrics.tokenUsageTotal.toLocaleString("en-US")}
                </span>
              </div>
            </div>
          </FadeContent>

          <FadeContent delay={300} className="flex">
            <div className="w-full h-full rounded-[20px] bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-8 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_12%,transparent)] group">
              <div className="flex items-center gap-2.5 text-[14px] font-medium text-muted font-sans">
                <Icon icon="mingcute:server-line" className="text-xl opacity-60 group-hover:opacity-100 transition-opacity" />
                <span>MCP 状态</span>
              </div>
              <div className="mt-6 mb-8 flex items-center gap-4">
                 <span className="relative flex h-4 w-4 flex-none">
                   <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-30 ${mcpStatus.running ? 'bg-green-500' : 'bg-red-500'}`}></span>
                   <span className={`relative inline-flex rounded-full h-4 w-4 ${mcpStatus.running ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]'}`}></span>
                 </span>
                 <span className="text-[3rem] leading-none font-serif tracking-tight text-(--color-base-content)">
                   {mcpStatus.running ? "Active" : "Offline"}
                 </span>
              </div>
              <div className="mt-auto">
                <span className="text-[13px] text-muted opacity-70 font-mono tracking-wide">PID: {mcpStatus.pid ?? "—"} • {mcpStatus.command || "Built-in"}</span>
              </div>
            </div>
          </FadeContent>
        </div>

        {/* Bottom Row: Workers & Queues */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1 min-h-0">
          
          {/* Left: Configuration (Col 4) */}
          <FadeContent delay={400} className="lg:col-span-4 flex flex-col h-full min-h-[350px]">
            <div className="flex items-center gap-2.5 mb-6 px-1">
              <Icon icon="mingcute:ai-line" className="text-xl text-muted opacity-80" />
              <h3 className="text-[18px] font-serif font-medium m-0 text-(--color-base-content)">
                Worker 配置
              </h3>
            </div>
            
            <div className="flex-1 flex flex-col gap-3">
              {workerAvailability.map((worker) => (
                <div key={worker.kind} className="group p-5 rounded-[16px] border border-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)] bg-[color-mix(in_srgb,var(--color-base-content)_1%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-base-content)_3%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_10%,transparent)] transition-all duration-300 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`w-2.5 h-2.5 rounded-full ${worker.available ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-(--color-base-300)"}`} />
                      <span className="font-medium text-[15px] font-sans text-(--color-base-content)">{worker.label}</span>
                    </div>
                  </div>
                  <div className="text-[12px] text-muted font-mono opacity-60 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                    <Icon icon="mingcute:terminal-box-line" className="text-sm" />
                    <span className="truncate">{worker.executable || "未配置"}</span>
                  </div>
                </div>
              ))}
            </div>
          </FadeContent>

          {/* Right: Pool Queue (Col 8) */}
          <FadeContent delay={500} className="lg:col-span-8 flex flex-col h-full relative min-h-[350px]">
            <div className="flex items-end justify-between mb-6 px-1">
              <div className="flex items-center gap-2.5">
                <Icon icon="mingcute:layers-line" className="text-xl text-muted opacity-80" />
                <h3 className="text-[18px] font-serif font-medium m-0 text-(--color-base-content)">
                  运行队列
                </h3>
              </div>
              <div className="flex gap-5 text-[13px] font-sans text-muted">
                <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500 opacity-80"></span>{metrics.runningCount} 运行</span>
                <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-500 opacity-80"></span>{metrics.pending} 待办</span>
                <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-current opacity-30"></span>{metrics.projectCount} 项目</span>
              </div>
            </div>
            
            <div className="flex-1 rounded-[20px] border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] bg-[color-mix(in_srgb,var(--color-base-content)_1%,transparent)] relative overflow-hidden flex flex-col transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_12%,transparent)]">
              <div className="flex-1 overflow-y-auto p-4">
                {workerPool.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-5 opacity-40 hover:opacity-60 transition-opacity duration-500">
                    <div className="w-20 h-20 rounded-[24px] bg-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)] flex items-center justify-center border border-[color-mix(in_srgb,var(--color-base-content)_8%,transparent)]">
                      <Icon icon="mingcute:sleep-line" className="text-3xl" />
                    </div>
                    <span className="text-[14px] font-sans tracking-widest uppercase">Idle State</span>
                  </div>
                ) : (
                  <AnimatedList
                    items={workerPool.map((entry) => (
                      <div key={entry.workerId} className="flex items-center justify-between p-5 rounded-[16px] border border-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)] bg-(--color-base-100) mb-3 hover:border-[color-mix(in_srgb,var(--color-base-content)_15%,transparent)] transition-colors shadow-sm group">
                        <div className="flex items-center gap-5">
                          <div className="w-12 h-12 rounded-xl bg-[color-mix(in_srgb,var(--color-base-content)_3%,transparent)] flex items-center justify-center flex-none border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] group-hover:bg-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] transition-colors">
                            <Icon icon="mingcute:terminal-box-line" className="text-xl opacity-70 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="flex flex-col gap-1 min-w-0">
                            <span className="text-[15px] font-medium font-sans text-(--color-base-content) truncate tracking-wide">{entry.workerLabel}</span>
                            <span className="text-[12px] text-muted font-mono opacity-60">ID: {entry.workerId.slice(0, 8)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 flex-none pl-6">
                          <span className="text-[14px] font-medium font-sans text-(--color-base-content) max-w-[180px] truncate opacity-90">{entry.projectName}</span>
                          <span className="text-[11px] text-muted tracking-wide bg-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)] px-2.5 py-1 rounded-lg border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)]">{formatMode(entry.mode)}</span>
                        </div>
                      </div>
                    ))}
                    onItemSelect={() => {}}
                    showGradients={false}
                    className="w-full h-full"
                    itemClassName="!p-0 !bg-transparent !border-none !rounded-xl !mb-0 transition-all duration-300"
                  />
                )}
              </div>
            </div>
          </FadeContent>
        </div>
      </div>
    </section>
  );
}

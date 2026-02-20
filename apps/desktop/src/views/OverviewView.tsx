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
    <section className="h-full w-full flex flex-col p-4 md:p-6 lg:p-8 max-w-6xl mx-auto overflow-hidden bg-transparent">
      {/* Notion-style Header */}
      <FadeContent delay={0} className="flex-none mb-4 lg:mb-6">
        <header>
          <div className="flex items-center gap-3 mb-1.5">
            <Icon icon="mingcute:dashboard-2-line" className="text-[24px] text-(--color-base-content) opacity-80" />
            <h2 className="text-[26px] leading-tight font-serif font-medium tracking-tight m-0 text-(--color-base-content)">
              <SplitText text="执行总览" delay={30} />
            </h2>
          </div>
          <p className="m-0 text-[13px] text-muted font-sans opacity-80 pl-9">
            Execution Overview
          </p>
        </header>
      </FadeContent>

      <div className="flex-1 min-h-0 flex flex-col gap-4 lg:gap-6 overflow-hidden">
        {/* Top Row: Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 lg:gap-4 flex-none">
          <FadeContent delay={100} className="flex min-h-0">
            <div className="w-full rounded-[16px] bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-4 lg:p-5 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_12%,transparent)] group">
              <div className="flex items-center gap-2 text-[12px] lg:text-[13px] font-medium text-muted font-sans">
                <Icon icon="mingcute:check-circle-line" className="text-[16px] lg:text-lg opacity-60 group-hover:opacity-100 transition-opacity" />
                <span>完成任务</span>
              </div>
              <div className="mt-3 mb-4 flex-1">
                <span className="text-[2rem] lg:text-[2.5rem] leading-none font-serif tracking-tight text-(--color-base-content)">
                  <CountUp from={0} to={metrics.completedCount} duration={1.2} />
                </span>
              </div>
              <div className="mt-auto flex-none">
                <span className="text-[11px] lg:text-[12px] text-muted opacity-70 font-sans">全项目累计已完成任务数</span>
              </div>
            </div>
          </FadeContent>

          <FadeContent delay={200} className="flex min-h-0">
            <div className="w-full rounded-[16px] bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-4 lg:p-5 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_12%,transparent)] group">
              <div className="flex items-center gap-2 text-[12px] lg:text-[13px] font-medium text-muted font-sans">
                <Icon icon="mingcute:coin-line" className="text-[16px] lg:text-lg opacity-60 group-hover:opacity-100 transition-opacity" />
                <span>消耗 Token</span>
              </div>
              <div className="mt-3 mb-4 flex-1">
                <span className="text-[2rem] lg:text-[2.5rem] leading-none font-serif tracking-tight text-(--color-base-content)">
                  {formatTokenCompact(metrics.tokenUsageTotal)}
                </span>
              </div>
              <div className="mt-auto flex-none">
                <span className="text-[11px] lg:text-[12px] text-muted opacity-70 font-sans tracking-wide">
                  原始值：{metrics.tokenUsageTotal.toLocaleString("en-US")}
                </span>
              </div>
            </div>
          </FadeContent>

          <FadeContent delay={300} className="flex min-h-0">
            <div className="w-full rounded-[16px] bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-4 lg:p-5 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_12%,transparent)] group">
              <div className="flex items-center gap-2 text-[12px] lg:text-[13px] font-medium text-muted font-sans">
                <Icon icon="mingcute:server-line" className="text-[16px] lg:text-lg opacity-60 group-hover:opacity-100 transition-opacity" />
                <span>MCP 状态</span>
              </div>
              <div className="mt-3 mb-4 flex items-center gap-2.5 flex-1">
                <span className="relative flex h-2.5 w-2.5 flex-none">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-30 ${mcpStatus.running ? 'bg-green-500' : 'bg-red-500'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${mcpStatus.running ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]'}`}></span>
                </span>
                <span className="text-[2rem] lg:text-[2.5rem] leading-none font-serif tracking-tight text-(--color-base-content)">
                  {mcpStatus.running ? "Active" : "Offline"}
                </span>
              </div>
              <div className="mt-auto flex-none">
                <span className="text-[11px] lg:text-[12px] text-muted opacity-70 font-mono tracking-wide">PID: {mcpStatus.pid ?? "—"} • {mcpStatus.command || "Built-in"}</span>
              </div>
            </div>
          </FadeContent>
        </div>

        {/* Bottom Row: Workers & Queues */}
        <div className="grid grid-cols-1 lg:grid-cols-12 grid-rows-[minmax(0,1fr)_minmax(0,1.5fr)] lg:grid-rows-1 gap-4 lg:gap-5 flex-1 min-h-0">
          
          {/* Left: Configuration (Col 4) */}
          <FadeContent delay={400} className="lg:col-span-4 flex flex-col min-h-0 relative">
            <div className="flex items-center gap-2 mb-3 lg:mb-4 px-1 flex-none">
              <Icon icon="mingcute:ai-line" className="text-[16px] lg:text-lg text-muted opacity-80" />
              <h3 className="text-[15px] lg:text-[16px] font-serif font-medium m-0 text-(--color-base-content)">
                Worker 配置
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 lg:pr-2 flex flex-col gap-2 min-h-0 pb-2">
              {workerAvailability.map((worker) => (
                <div key={worker.kind} className="group p-3 lg:p-4 rounded-[12px] lg:rounded-[14px] border border-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)] bg-[color-mix(in_srgb,var(--color-base-content)_1%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-base-content)_3%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_10%,transparent)] transition-all duration-300 flex flex-col gap-1.5 lg:gap-2 flex-none">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 lg:w-2 lg:h-2 rounded-full flex-none ${worker.available ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-(--color-base-300)"}`} />
                      <span className="font-medium text-[13px] lg:text-[14px] font-sans text-(--color-base-content) truncate">{worker.label}</span>
                    </div>
                  </div>
                  <div className="text-[10px] lg:text-[11px] text-muted font-mono opacity-60 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 pl-3 lg:pl-4">
                    <Icon icon="mingcute:terminal-box-line" className="text-[12px] lg:text-[13px] flex-none" />
                    <span className="truncate">{worker.executable || "未配置"}</span>
                  </div>
                </div>
              ))}
            </div>
          </FadeContent>

          {/* Right: Pool Queue (Col 8) */}
          <FadeContent delay={500} className="lg:col-span-8 flex flex-col min-h-0 relative">
            <div className="flex items-end justify-between mb-3 lg:mb-4 px-1 flex-none">
              <div className="flex items-center gap-2">
                <Icon icon="mingcute:layers-line" className="text-[16px] lg:text-lg text-muted opacity-80" />
                <h3 className="text-[15px] lg:text-[16px] font-serif font-medium m-0 text-(--color-base-content)">
                  运行队列
                </h3>
              </div>
              <div className="flex gap-3 lg:gap-4 text-[11px] lg:text-[12px] font-sans text-muted">
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 opacity-80"></span>{metrics.runningCount} 运行</span>
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 opacity-80"></span>{metrics.pending} 待办</span>
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-current opacity-30"></span>{metrics.projectCount} 项目</span>
              </div>
            </div>
            
            <div className="flex-1 rounded-[16px] border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] bg-[color-mix(in_srgb,var(--color-base-content)_1%,transparent)] relative flex flex-col transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] hover:border-[color-mix(in_srgb,var(--color-base-content)_12%,transparent)] min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-2 lg:p-3 min-h-0">
                {workerPool.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 lg:gap-4 opacity-40 hover:opacity-60 transition-opacity duration-500">
                    <div className="w-12 h-12 lg:w-16 lg:h-16 rounded-[16px] lg:rounded-[20px] bg-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)] flex items-center justify-center border border-[color-mix(in_srgb,var(--color-base-content)_8%,transparent)]">
                      <Icon icon="mingcute:sleep-line" className="text-xl lg:text-2xl" />
                    </div>
                    <span className="text-[12px] lg:text-[13px] font-sans tracking-widest uppercase">Idle State</span>
                  </div>
                ) : (
                  <AnimatedList
                    items={workerPool.map((entry) => (
                      <div key={entry.workerId} className="flex items-center justify-between p-3 lg:p-4 rounded-[12px] lg:rounded-[14px] border border-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)] bg-(--color-base-100) mb-2 hover:border-[color-mix(in_srgb,var(--color-base-content)_15%,transparent)] transition-colors shadow-sm group">
                        <div className="flex items-center gap-3 lg:gap-4 min-w-0">
                          <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg lg:rounded-xl bg-[color-mix(in_srgb,var(--color-base-content)_3%,transparent)] flex items-center justify-center flex-none border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] group-hover:bg-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] transition-colors">
                            <Icon icon="mingcute:terminal-box-line" className="text-[16px] lg:text-lg opacity-70 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-[13px] lg:text-[14px] font-medium font-sans text-(--color-base-content) truncate tracking-wide">{entry.workerLabel}</span>
                            <span className="text-[10px] lg:text-[11px] text-muted font-mono opacity-60">ID: {entry.workerId.slice(0, 8)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-none pl-3 lg:pl-4">
                          <span className="text-[12px] lg:text-[13px] font-medium font-sans text-(--color-base-content) max-w-[100px] lg:max-w-[180px] truncate opacity-90">{entry.projectName}</span>
                          <span className="text-[9px] lg:text-[10px] text-muted tracking-wide bg-[color-mix(in_srgb,var(--color-base-content)_4%,transparent)] px-2 py-0.5 rounded-md border border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)]">{formatMode(entry.mode)}</span>
                        </div>
                      </div>
                    ))}
                    onItemSelect={() => {}}
                    showGradients={false}
                    className="w-full"
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

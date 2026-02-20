import { Icon } from "@iconify/react";
import { CountUp, FadeContent, SpotlightCard } from "../components/ReactBits";
import type { McpServerStatus } from "../domain";

type OverviewViewProps = {
  metrics: { pending: number; runningCount: number; projectCount: number };
  mcpStatus: McpServerStatus;
};

export function OverviewView({ metrics, mcpStatus }: OverviewViewProps) {
  return (
    <FadeContent duration={400}>
      <section className="h-full flex flex-col p-2">
        <header className="mb-4 px-2 flex items-center justify-between shrink-0">
          <h2 className="text-2xl font-bold tracking-tight m-0 text-primary flex items-center gap-2">
            <Icon icon="mingcute:dashboard-2-fill" className="text-3xl opacity-80" />
            概览空间
          </h2>
          <div className="flex items-center gap-2 text-sm font-medium px-3 py-1 rounded-full bg-(--color-base-200) text-muted border border-(--color-base-300)">
            <span className={`w-2 h-2 rounded-full ${mcpStatus.running ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-red-500"}`} />
            {mcpStatus.running ? "MCP Server Online" : "MCP Server Offline"}
          </div>
        </header>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 auto-rows-fr">
          {/* Projects Card */}
          <SpotlightCard 
            spotlightColor="rgba(242, 114, 60, 0.15)" 
            className="col-span-1 md:col-span-2 lg:col-span-2 rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] shadow-[0_8px_30px_rgba(0,0,0,0.02)] p-6 md:p-8 flex flex-col justify-between group"
          >
            <div className="flex items-center justify-between text-muted mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider m-0 flex items-center gap-2">
                <Icon icon="mingcute:folder-open-line" className="text-lg" />
                托管项目
              </h3>
              <Icon icon="mingcute:right-line" className="opacity-0 group-hover:opacity-100 transition-all transform translate-x-[-8px] group-hover:translate-x-0" />
            </div>
            <div>
              <p className="text-6xl md:text-8xl font-bold m-0 tracking-tighter text-primary/90 leading-none">
                <CountUp from={0} to={metrics.projectCount} duration={0.8} />
              </p>
              <p className="text-muted mt-2 m-0 text-sm">当前由 Maple 管理的工作区总数</p>
            </div>
          </SpotlightCard>

          {/* Pending Tasks Card */}
          <SpotlightCard 
            spotlightColor="rgba(47, 111, 179, 0.12)" 
            className="col-span-1 rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] shadow-[0_8px_30px_rgba(0,0,0,0.02)] p-6 md:p-8 flex flex-col justify-between group relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
              <Icon icon="mingcute:task-2-line" className="text-8xl" />
            </div>
            <div className="flex items-center justify-between text-muted mb-4 relative z-10">
              <h3 className="text-sm font-semibold uppercase tracking-wider m-0 flex items-center gap-2">
                <Icon icon="mingcute:task-2-line" className="text-lg" />
                待办任务
              </h3>
            </div>
            <div className="relative z-10">
              <p className="text-5xl md:text-6xl font-bold m-0 tracking-tighter leading-none text-(--color-base-content)">
                <CountUp from={0} to={metrics.pending} duration={0.8} />
              </p>
              <p className="text-muted mt-2 m-0 text-sm">队列中等待处理的需求</p>
            </div>
          </SpotlightCard>

          {/* Running Workers Card */}
          <SpotlightCard 
            spotlightColor="rgba(34, 197, 94, 0.12)" 
            className="col-span-1 rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] shadow-[0_8px_30px_rgba(0,0,0,0.02)] p-6 flex flex-col justify-between relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
              <Icon icon="mingcute:ai-line" className="text-8xl" />
            </div>
            <div className="flex items-center justify-between text-muted mb-4 relative z-10">
              <h3 className="text-sm font-semibold uppercase tracking-wider m-0 flex items-center gap-2">
                <Icon icon="mingcute:ai-line" className="text-lg" />
                活跃实例
              </h3>
              {metrics.runningCount > 0 && (
                <span className="flex w-3 h-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full w-3 h-3 bg-green-500"></span>
                </span>
              )}
            </div>
            <div className="relative z-10">
              <div className="flex items-baseline gap-2">
                <p className="text-5xl md:text-6xl font-bold m-0 tracking-tighter leading-none text-(--color-base-content)">
                  <CountUp from={0} to={metrics.runningCount} duration={0.8} />
                </p>
                <span className="text-muted font-medium">Workers</span>
              </div>
              <p className="text-muted mt-2 m-0 text-sm">正在后台执行任务的引擎</p>
            </div>
          </SpotlightCard>

          {/* MCP Status Detailed Card */}
          <SpotlightCard 
            spotlightColor="rgba(47, 111, 179, 0.08)" 
            className="col-span-1 md:col-span-2 lg:col-span-2 rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] shadow-[0_8px_30px_rgba(0,0,0,0.02)] p-6 flex flex-col relative overflow-hidden"
          >
            <div className="flex items-center gap-3 text-muted mb-6">
              <Icon icon="mingcute:server-line" className="text-xl" />
              <h3 className="text-sm font-semibold uppercase tracking-wider m-0">
                Core System Status
              </h3>
            </div>
            
            <div className="grid grid-cols-2 gap-8 flex-1">
              <div className="flex flex-col justify-center">
                <span className="text-xs text-muted font-medium mb-1 uppercase tracking-wider">Protocol</span>
                <span className="text-lg font-medium text-(--color-base-content)">Maple MCP</span>
              </div>
              <div className="flex flex-col justify-center">
                <span className="text-xs text-muted font-medium mb-1 uppercase tracking-wider">Process ID</span>
                <span className="text-lg font-mono text-(--color-base-content)">{mcpStatus.pid ? mcpStatus.pid : "—"}</span>
              </div>
              <div className="flex flex-col justify-center col-span-2 border-t border-(--color-base-300)/30 pt-4 mt-auto">
                <span className="text-xs text-muted font-medium mb-1 uppercase tracking-wider">Command</span>
                <code className="text-sm font-mono text-muted bg-(--color-base-200)/50 px-3 py-2 rounded-lg truncate border border-(--color-base-300)/50">
                  {mcpStatus.command || "Built-in / Not available"}
                </code>
              </div>
            </div>
          </SpotlightCard>
        </div>
      </section>
    </FadeContent>
  );
}

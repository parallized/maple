import { Icon } from "@iconify/react";
import { CountUp, FadeContent, SpotlightCard } from "../components/ReactBits";
import type { McpServerStatus } from "../domain";

type OverviewViewProps = {
  metrics: { pending: number; runningCount: number; projectCount: number };
  mcpStatus: McpServerStatus;
};

export function OverviewView({ metrics, mcpStatus }: OverviewViewProps) {
  return (
    <FadeContent duration={300}>
      <section>
        <h2 className="text-xl font-semibold m-0">概览</h2>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <SpotlightCard spotlightColor="rgba(47, 111, 179, 0.15)" className="ui-card p-4">
            <h3 className="text-muted text-sm font-normal m-0">待处理任务</h3>
            <p className="text-2xl font-semibold mt-1 m-0">
              <CountUp from={0} to={metrics.pending} duration={0.6} />
            </p>
          </SpotlightCard>
          <SpotlightCard spotlightColor="rgba(47, 111, 179, 0.15)" className="ui-card p-4">
            <h3 className="text-muted text-sm font-normal m-0">运行中 Worker</h3>
            <p className="text-2xl font-semibold mt-1 m-0">
              <CountUp from={0} to={metrics.runningCount} duration={0.6} />
            </p>
          </SpotlightCard>
          <SpotlightCard spotlightColor="rgba(47, 111, 179, 0.15)" className="ui-card p-4">
            <h3 className="text-muted text-sm font-normal m-0">项目数量</h3>
            <p className="text-2xl font-semibold mt-1 m-0">
              <CountUp from={0} to={metrics.projectCount} duration={0.6} />
            </p>
          </SpotlightCard>
        </div>

        <div className="ui-card p-4 mt-3">
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:plug-2-line" />
            MCP Server
          </h3>
          <p className="text-muted text-sm mt-2">
            状态：{mcpStatus.running ? `运行中（PID ${mcpStatus.pid ?? "?"}）` : "未运行"}
            {mcpStatus.command ? ` | ${mcpStatus.command}` : ""}
          </p>
        </div>
      </section>
    </FadeContent>
  );
}

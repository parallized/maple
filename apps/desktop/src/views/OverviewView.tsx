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

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 auto-rows-fr">
        <FadeContent delay={0} className="flex">
          <SpotlightCard className="w-full rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col gap-4">
            <div className="text-muted text-sm font-medium flex items-center gap-2">
              <Icon icon="mingcute:check-circle-line" />
              总完成任务数量
            </div>
            <div className="text-5xl font-bold tracking-tight text-(--color-base-content)">
              <CountUp from={0} to={metrics.completedCount} duration={0.7} />
            </div>
            <p className="m-0 text-xs text-muted">全项目累计已完成任务数。</p>
          </SpotlightCard>
        </FadeContent>

        <FadeContent delay={100} className="flex">
          <SpotlightCard className="w-full rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col gap-4">
            <div className="text-muted text-sm font-medium flex items-center gap-2">
              <Icon icon="mingcute:coin-line" />
              总消耗 Token
            </div>
            <div className="text-4xl font-bold tracking-tight text-(--color-base-content)">
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
              className="m-0 text-xs text-muted"
              delay={50}
              animationFrom={{ filter: 'blur(10px)', opacity: 0, y: -50 }}
              animationTo={[{ filter: 'blur(5px)', opacity: 0.5, y: 5 }, { filter: 'blur(0px)', opacity: 1, y: 0 }]}
              onAnimationComplete={() => {}}
            />
          </SpotlightCard>
        </FadeContent>

        <FadeContent delay={200} className="flex">
          <SpotlightCard className="w-full rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col gap-4">
            <div className="text-muted text-sm font-medium flex items-center gap-2">
              <Icon icon="mingcute:server-line" />
              MCP 运行情况
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${mcpStatus.running ? "bg-green-500" : "bg-red-500"}`} />
              <span className="font-medium">
                <ShinyText text={mcpStatus.running ? "运行中" : "未运行"} disabled={false} speed={3} className="" />
              </span>
            </div>
            <p className="m-0 text-xs text-muted break-all">PID: {mcpStatus.pid ?? "—"} | {mcpStatus.command || "Built-in / N/A"}</p>
          </SpotlightCard>
        </FadeContent>

        <FadeContent delay={300} className="flex">
          <SpotlightCard className="w-full rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col gap-3">
            <div className="text-muted text-sm font-medium flex items-center gap-2">
              <Icon icon="mingcute:ai-line" />
              Worker 配置情况
            </div>
            <div className="space-y-2 text-sm">
              {workerAvailability.map((worker) => (
                <div key={worker.kind} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${worker.available ? "bg-green-500" : "bg-(--color-base-300)"}`} />
                    <span>{worker.label}</span>
                  </div>
                  <code className="text-xs text-muted max-w-[60%] truncate">{worker.executable || "未配置"}</code>
                </div>
              ))}
            </div>
          </SpotlightCard>
        </FadeContent>

        <FadeContent delay={400} className="flex md:col-span-2 lg:col-span-2 relative">
          <SpotlightCard className="w-full h-full rounded-2xl bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)] p-6 flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between gap-3 relative z-10">
              <div className="text-muted text-sm font-medium flex items-center gap-2">
                <Icon icon="mingcute:layers-line" />
                Worker 运行队列 Pool
              </div>
              <span className="text-xs text-muted">运行中 {metrics.runningCount} / 待办 {metrics.pending} / 项目 {metrics.projectCount}</span>
            </div>

            <div className="flex-1 overflow-hidden relative z-10 -mx-6 px-6">
              {workerPool.length === 0 ? (
                <p className="m-0 text-sm text-muted">当前没有运行中的 Worker。</p>
              ) : (
                <AnimatedList
                  items={workerPool.map((entry) => (
                    <div key={entry.workerId} className="w-full flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon icon="mingcute:terminal-line" />
                        <span className="font-medium">{entry.workerLabel}</span>
                        <span className="text-xs text-muted">({formatMode(entry.mode)})</span>
                      </div>
                      <span className="text-xs text-muted truncate max-w-[50%]">{entry.projectName}</span>
                    </div>
                  ))}
                  onItemSelect={() => {}}
                  showGradients={true}
                  className="w-full h-full"
                  itemClassName="!p-3 !mb-2 !bg-(--color-base-200) !border !border-[color-mix(in_srgb,var(--color-base-300)_40%,transparent)]"
                />
              )}
            </div>
          </SpotlightCard>
        </FadeContent>
      </div>
    </section>
  );
}

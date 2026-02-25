import { Icon } from "@iconify/react";
import { CountUp, CurvedLoop, FadeContent, FallingText, SpotlightCard, SplitText } from "../components/ReactBits";
import { McpSkillsInstallCard } from "../components/McpSkillsInstallCard";
import { WorkerLogo } from "../components/WorkerLogo";
import AnimatedList from "../components/reactbits/AnimatedList";
import type { McpServerStatus, WorkerKind } from "../domain";
import type { UiLanguage } from "../lib/constants";
import { Group } from "@visx/group";
import { Pie } from "@visx/shape";
import { motion } from "framer-motion";

type OverviewViewProps = {
  uiLanguage: UiLanguage;
  metrics: {
    pending: number;
    runningCount: number;
    projectCount: number;
    completedCount: number;
    inProgressCount: number;
    allCount: number;
    statusDistribution: Record<string, number>;
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
    mode: "task";
    kind: WorkerKind | null;
  }>;
  onRefreshMcp?: () => void;
};

function formatMode(mode: "task"): string {
  return "任务执行";
}

interface StatusData {
  label: string;
  value: number;
  color: string;
}

export function OverviewView({ uiLanguage, metrics, mcpStatus, workerAvailability, workerPool, onRefreshMcp }: OverviewViewProps) {
  const pieData: StatusData[] = [
    { label: "已完成", value: metrics.statusDistribution["已完成"] || 0, color: "var(--color-success)" },
    { label: "进行中", value: metrics.statusDistribution["进行中"] || 0, color: "var(--color-primary)" },
    {
      label: "待处理",
      value:
        (metrics.statusDistribution["待办"] || 0) +
        (metrics.statusDistribution["队列中"] || 0) +
        (metrics.statusDistribution["待返工"] || 0) +
        (metrics.statusDistribution["草稿"] || 0),
      color: "var(--color-secondary)",
    },
    { label: "需信息", value: metrics.statusDistribution["需要更多信息"] || 0, color: "var(--color-warning)" },
    { label: "已阻塞", value: metrics.statusDistribution["已阻塞"] || 0, color: "var(--color-error)" },
  ].filter((d) => d.value > 0);

  const totalTasks = metrics.allCount;
  const pieSize = 96;
  const half = pieSize / 2;

  return (
    <section className="h-full w-full flex flex-col p-4 md:p-6 lg:p-8 max-w-6xl mx-auto overflow-hidden bg-transparent relative">
      {/* Background Falling Text */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.1] -z-10 overflow-hidden">
        <FallingText 
          text="MAPLE AI WORKER MAPLE MAPLE AUTOMATION AGENTIC MAPLE MAPLE WORKFLOW INTELLIGENCE INNOVATION MAPLE MAPLE AUTONOMY COGNITIVE TASK FLOW"
          fontSize="3rem"
          colors={["#d97757", "#f5f5f7", "#6366f1"]}
          gravity={0.9}
          friction={0.5}
          restitution={0.25}
        />
      </div>

      {/* Notion-style Header */}
      <FadeContent delay={0} className="flex-none mb-4 lg:mb-6 relative z-10">
        <header>
          <div className="flex items-center gap-3 mb-1.5">
            <Icon icon="mingcute:dashboard-2-line" className="text-[24px] text-(--color-base-content) opacity-80" />
            <h2 className="text-[26px] leading-tight font-sans font-medium tracking-tight m-0 text-(--color-base-content)">
              <SplitText text="执行总览" delay={30} />
            </h2>
          </div>
          <p className="m-0 text-[13px] text-muted font-sans opacity-80 pl-9">
            Execution Overview
          </p>
        </header>
      </FadeContent>

      <div className="flex-1 min-h-0 flex flex-col gap-4 lg:gap-6 overflow-hidden relative z-10">
        {/* Top Row: Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:gap-4 flex-none">
          <FadeContent delay={100} className="flex min-h-0">
            <div className="w-full rounded-[16px] bg-(--color-base-100) p-4 lg:p-5 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] group">
              <div className="flex items-center gap-2 text-[12px] lg:text-[13px] font-medium text-muted font-sans mb-3">
                <Icon icon="mingcute:chart-pie-line" className="text-[16px] lg:text-lg opacity-60 group-hover:opacity-100 transition-opacity" />
                <span>任务分布</span>
              </div>
              
              <div className="flex items-center gap-6 flex-1 min-h-[100px]">
                {/* Visx Pie Chart */}
                <div className="relative w-20 h-20 lg:w-24 lg:h-24 flex-none">
                  <svg width="100%" height="100%" viewBox={`0 0 ${pieSize} ${pieSize}`}>
                    <Group top={half} left={half}>
                      <Pie
                        data={pieData.length > 0 ? pieData : [{ label: "empty", value: 1, color: "var(--color-base-300)" }]}
                        pieValue={(d) => d.value}
                        outerRadius={half}
                        innerRadius={half * 0.7}
                        padAngle={0.02}
                      >
                        {(pie) => {
                          return pie.arcs.map((arc, index) => {
                            const { label } = arc.data;
                            const [centroidX, centerY] = pie.path.centroid(arc);
                            return (
                              <g key={`arc-${label}-${index}`}>
                                <motion.path
                                  d={pie.path(arc) || ""}
                                  fill={arc.data.color}
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.5, delay: index * 0.05 }}
                                  className="transition-colors duration-300"
                                />
                              </g>
                            );
                          });
                        }}
                      </Pie>
                    </Group>
                  </svg>
                  {/* Inner Total */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[14px] lg:text-[16px] font-sans font-semibold text-(--color-base-content)">
                      {totalTasks}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-(--color-success) flex-none" />
                      <span className="text-[11px] lg:text-[12px] text-muted truncate">已完成</span>
                      <span className="text-[11px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
                        {metrics.completedCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-(--color-primary) flex-none" />
                      <span className="text-[11px] lg:text-[12px] text-muted truncate">进行中</span>
                      <span className="text-[11px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
                        {metrics.statusDistribution["进行中"] || 0}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-(--color-secondary) flex-none opacity-60" />
                      <span className="text-[11px] lg:text-[12px] text-muted truncate">待处理</span>
                      <span className="text-[11px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
                        {(metrics.statusDistribution["待办"] || 0) +
                          (metrics.statusDistribution["队列中"] || 0) +
                          (metrics.statusDistribution["待返工"] || 0) +
                          (metrics.statusDistribution["草稿"] || 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-2 h-2 rounded-full bg-(--color-warning) flex-none" />
                      <span className="text-[11px] lg:text-[12px] text-muted truncate">需信息</span>
                      <span className="text-[11px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
                        {metrics.statusDistribution["需要更多信息"] || 0}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeContent>

          <FadeContent delay={300} className="flex min-h-0">
            <div className="w-full rounded-[16px] bg-(--color-base-100) p-4 lg:p-5 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] group overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-[12px] lg:text-[13px] font-medium text-muted font-sans">
                  <Icon icon="mingcute:server-line" className="text-[16px] lg:text-lg opacity-60 group-hover:opacity-100 transition-opacity" />
                  <span>MCP 状态</span>
                </div>
                {onRefreshMcp && (
                  <button 
                    onClick={onRefreshMcp}
                    className="p-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--color-base-content)_5%,transparent)] text-muted hover:text-(--color-base-content) transition-all active:scale-95 group/refresh"
                    title="重新同步"
                  >
                    <Icon icon="mingcute:refresh-3-line" className="text-[16px] lg:text-[18px] group-active/refresh:rotate-180 transition-transform duration-500" />
                  </button>
                )}
              </div>
              <div className="mt-1 mb-4 flex items-center gap-2.5 flex-1 relative z-10">
                <span className="relative flex h-2.5 w-2.5 flex-none">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-30 ${mcpStatus.running ? 'bg-green-500' : 'bg-red-500'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${mcpStatus.running ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]'}`}></span>
                </span>
                <span className="text-[2rem] lg:text-[2.5rem] leading-none font-sans font-semibold tracking-tight text-(--color-base-content)">
                  {mcpStatus.running ? "Active" : "Offline"}
                </span>
              </div>
              <div className="mt-auto flex-none flex flex-col gap-1 relative z-10">
                <div className="flex items-center gap-2 text-[11px] lg:text-[12px] text-muted opacity-70 font-mono tracking-wide">
                  <span className="px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-base-content)_5%,transparent)]">PID: {mcpStatus.pid ?? "—"}</span>
                  <span className="w-1 h-1 rounded-full bg-current opacity-30" />
                  <span className="truncate">{mcpStatus.command || "Maple MCP"}</span>
                </div>
              </div>

              {/* Status Indicator Decoration */}
              {mcpStatus.running && (
                <div className="absolute -right-6 -bottom-6 opacity-[0.15] group-hover:opacity-25 transition-opacity pointer-events-none rotate-12">
                  <CurvedLoop 
                    text="运行中 RUNNING" 
                    radius={60} 
                    speed={15} 
                    fontSize="13px" 
                    color="var(--color-success)" 
                  />
                </div>
              )}
            </div>
          </FadeContent>
        </div>

        {/* Bottom Row: Workers & Queues */}
        <div className="grid grid-cols-1 lg:grid-cols-12 grid-rows-[minmax(0,1fr)_minmax(0,1.5fr)] lg:grid-rows-1 gap-4 lg:gap-5 flex-1 min-h-0">
          
          {/* Left: Configuration (Col 4) */}
          <FadeContent delay={400} className="lg:col-span-4 flex flex-col min-h-0 relative">
            <div className="flex items-center gap-2 mb-3 lg:mb-4 px-1 flex-none">
              <Icon icon="mingcute:ai-line" className="text-[16px] lg:text-lg text-muted opacity-80" />
              <h3 className="text-[15px] lg:text-[16px] font-sans font-medium m-0 text-(--color-base-content)">
                Worker 配置
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 lg:pr-2 flex flex-col gap-2 min-h-0 pb-2">
              <McpSkillsInstallCard uiLanguage={uiLanguage} />
              {workerAvailability.map((worker) => (
                <div key={worker.kind} className="group p-3 lg:p-4 rounded-[12px] lg:rounded-[14px] bg-(--color-base-100) hover:bg-(--color-base-200) transition-all duration-300 flex flex-col gap-1.5 lg:gap-2 flex-none">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="relative w-6 h-6 rounded-lg bg-(--color-base-200) flex items-center justify-center flex-none">
                        <WorkerLogo kind={worker.kind} size={16} />
                        <span
                          className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-(--color-base-100) ${worker.available ? "bg-green-500" : "bg-(--color-base-300)"}`}
                          aria-label={worker.available ? "可用" : "未配置"}
                        />
                      </div>
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
                <h3 className="text-[15px] lg:text-[16px] font-sans font-medium m-0 text-(--color-base-content)">
                  运行队列
                </h3>
              </div>
              <div className="flex gap-3 lg:gap-4 text-[11px] lg:text-[12px] font-sans text-muted">
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 opacity-80"></span>{metrics.runningCount} 运行</span>
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 opacity-80"></span>{metrics.pending} 待办</span>
                <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-current opacity-30"></span>{metrics.projectCount} 项目</span>
              </div>
            </div>
            
            <div className="flex-1 rounded-[16px] bg-(--color-base-100) relative flex flex-col transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-2 lg:p-3 min-h-0">
                {workerPool.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center gap-3 lg:gap-4 opacity-40 hover:opacity-60 transition-opacity duration-500">
                    <div className="w-12 h-12 lg:w-16 lg:h-16 rounded-[16px] lg:rounded-[20px] bg-(--color-base-200) flex items-center justify-center">
                      <Icon icon="mingcute:sleep-line" className="text-xl lg:text-2xl" />
                    </div>
                    <span className="text-[12px] lg:text-[13px] font-sans tracking-widest uppercase">Idle State</span>
                  </div>
                ) : (
                  <AnimatedList
                    items={workerPool.map((entry) => (
                      <div key={entry.workerId} className="flex items-center justify-between p-3 lg:p-4 rounded-[12px] lg:rounded-[14px] bg-(--color-base-100) mb-2 transition-colors shadow-sm group">
                        <div className="flex items-center gap-3 lg:gap-4 min-w-0">
                          <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-lg lg:rounded-xl bg-(--color-base-200) flex items-center justify-center flex-none group-hover:bg-(--color-base-300) transition-colors">
                            {entry.kind ? (
                              <WorkerLogo kind={entry.kind} size={18} className="opacity-90 group-hover:opacity-100 transition-opacity" />
                            ) : (
                              <Icon icon="mingcute:terminal-box-line" className="text-[16px] lg:text-lg opacity-70 group-hover:opacity-100 transition-opacity" />
                            )}
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-[13px] lg:text-[14px] font-medium font-sans text-(--color-base-content) truncate tracking-wide">{entry.workerLabel}</span>
                            <span className="text-[10px] lg:text-[11px] text-muted font-mono opacity-60">ID: {entry.workerId.slice(0, 8)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-none pl-3 lg:pl-4">
                          <span className="text-[12px] lg:text-[13px] font-medium font-sans text-(--color-base-content) max-w-[100px] lg:max-w-[180px] truncate opacity-90">{entry.projectName}</span>
                          <span className="text-[9px] lg:text-[10px] text-muted tracking-wide bg-(--color-base-200) px-2 py-0.5 rounded-md">{formatMode(entry.mode)}</span>
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

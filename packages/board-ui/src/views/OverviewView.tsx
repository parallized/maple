import { Icon } from "@iconify/react";
import { CountUp, FadeContent, SpotlightCard, SplitText } from "../components/ReactBits";
import { WorkerConfigCard, type WorkerProbe } from "../components/WorkerConfigCard";
import AnimatedList from "../components/reactbits/AnimatedList";
import { WorkerLogo } from "../components/WorkerLogo";
import { ProjectTokenChart, type ProjectTokenChartEntry } from "../components/ProjectTokenChart";
import type { RunnerSummary, WorkerKind } from "../domain";
import type { UiLanguage } from "../lib/constants";
import type { InstallTargetId } from "../lib/install-targets";
import { runnerPlatformIcon } from "../lib/runner-icon";
import { statusColorVar, statusDotClass } from "../lib/status-colors";
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
  runners: RunnerSummary[];
  workerAvailability: Array<{
    kind: WorkerKind;
    label: string;
    executable: string;
    available: boolean;
  }>;
  installProbes: Partial<Record<InstallTargetId, WorkerProbe>>;
  workerPool: Array<{
    workerId: string;
    workerLabel: string;
    projectName: string;
    mode: "task";
    kind: WorkerKind | null;
  }>;
  projectTokenUsage: ProjectTokenChartEntry[];
  onRefreshProbes?: () => void;
};

/**
 * 概览页底部「Worker 配置」与「运行队列」面板的显示开关。
 * 暂时隐藏这两块；如需恢复，改为 true 即可。
 */
const SHOW_WORKER_PANELS = false;

function formatMode(mode: "task"): string {
  return "任务执行";
}

/** ISO 时间 → 相对描述（"12s 前" / "3m 前" / "2h 前" / "—"）。 */
function formatRelativeTime(iso: string, now: number): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "刚刚";
  if (sec < 60) return `${sec}s 前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m 前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h 前`;
  const day = Math.floor(hr / 24);
  return `${day}d 前`;
}

interface StatusData {
  label: string;
  value: number;
  color: string;
}

export function OverviewView({ uiLanguage, metrics, runners, workerAvailability, installProbes, workerPool, projectTokenUsage, onRefreshProbes }: OverviewViewProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const now = Date.now();
  const onlineCount = runners.filter((r) => r.state === "online").length;

  // Show all workers on overview (install buttons available per-card)
  const allWorkers = workerAvailability;

  const pieData: StatusData[] = [
    { label: "已完成", value: metrics.statusDistribution["已完成"] || 0, color: statusColorVar("已完成") },
    { label: "进行中", value: metrics.statusDistribution["进行中"] || 0, color: statusColorVar("进行中") },
    { label: "规划中", value: metrics.statusDistribution["规划中"] || 0, color: statusColorVar("规划中") },
    {
      label: "待处理",
      value:
        (metrics.statusDistribution["待办"] || 0) +
        (metrics.statusDistribution["队列中"] || 0) +
        (metrics.statusDistribution["待返工"] || 0) +
        (metrics.statusDistribution["草稿"] || 0),
      color: statusColorVar("待办"),
    },
    { label: "需信息", value: metrics.statusDistribution["需要更多信息"] || 0, color: statusColorVar("需要更多信息") },
    { label: "已阻塞", value: metrics.statusDistribution["已阻塞"] || 0, color: statusColorVar("已阻塞") },
  ].filter((d) => d.value > 0);

  const totalTasks = metrics.allCount;
  const pieSize = 96;
  const half = pieSize / 2;

  return (
    <section className="h-full w-full flex flex-col p-4 md:p-6 lg:p-8 max-w-6xl mx-auto overflow-hidden bg-[color-mix(in_srgb,var(--color-base-100)_70%,var(--color-base-200))] rounded-none md:rounded-[16px] relative">
      {/* Notion-style Header */}
      <FadeContent delay={0} className="flex-none mb-4 lg:mb-6 relative z-10">
        <header>
          <div className="flex items-center gap-3 mb-1.5">
            <Icon icon="mingcute:dashboard-2-line" className="text-[24px] text-(--color-base-content) opacity-80" />
            <h2 className="text-[26px] leading-tight font-sans font-medium tracking-tight m-0 text-(--color-base-content)">
              <SplitText text="执行总览" delay={30} />
            </h2>
          </div>
          <p className="m-0 text-[14px] text-muted font-sans opacity-80 pl-9">
            Execution Overview
          </p>
        </header>
      </FadeContent>

      <div className="overview-scroll flex-1 min-h-0 flex flex-col gap-4 lg:gap-6 overflow-y-auto md:overflow-hidden relative z-10">
        {/* Top Row: Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:gap-4 flex-none">
          <FadeContent delay={100} className="flex min-h-0">
            <div className="w-full rounded-[16px] bg-(--color-base-100) p-4 lg:p-5 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] group">
              <div className="flex items-center gap-2 text-[12px] lg:text-[14px] font-medium text-muted font-sans mb-3">
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
                      <div className={`w-2 h-2 rounded-full ${statusDotClass("已完成")} flex-none`} />
                      <span className="text-[12px] lg:text-[12px] text-muted truncate">已完成</span>
                      <span className="text-[12px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
                        {metrics.completedCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${statusDotClass("进行中")} flex-none`} />
                      <span className="text-[12px] lg:text-[12px] text-muted truncate">进行中</span>
                      <span className="text-[12px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
                        {metrics.statusDistribution["进行中"] || 0}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${statusDotClass("规划中")} flex-none`} />
                      <span className="text-[12px] lg:text-[12px] text-muted truncate">规划中</span>
                      <span className="text-[12px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
                        {metrics.statusDistribution["规划中"] || 0}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${statusDotClass("待办")} flex-none`} />
                      <span className="text-[12px] lg:text-[12px] text-muted truncate">待处理</span>
                      <span className="text-[12px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
                        {(metrics.statusDistribution["待办"] || 0) +
                          (metrics.statusDistribution["队列中"] || 0) +
                          (metrics.statusDistribution["待返工"] || 0) +
                          (metrics.statusDistribution["草稿"] || 0)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${statusDotClass("需要更多信息")} flex-none`} />
                      <span className="text-[12px] lg:text-[12px] text-muted truncate">需信息</span>
                      <span className="text-[12px] lg:text-[12px] font-medium text-(--color-base-content) ml-auto">
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
                <div className="flex items-center gap-2 text-[12px] lg:text-[14px] font-medium text-muted font-sans">
                  <Icon icon="mingcute:link-line" className="text-[16px] lg:text-lg opacity-60 group-hover:opacity-100 transition-opacity" />
                  <span>{t("已连接 Worker", "Connected Workers")}</span>
                </div>
                <span className="text-[12px] lg:text-[12px] text-muted font-mono tabular-nums">
                  {onlineCount}/{runners.length}
                </span>
              </div>

              {runners.length === 0 ? (
                <div className="flex-1 min-h-[100px] flex flex-col items-center justify-center gap-2 opacity-40 hover:opacity-60 transition-opacity duration-500">
                  <Icon icon="mingcute:sleep-line" className="text-xl lg:text-2xl" />
                  <span className="text-[12px] lg:text-[12px] font-sans tracking-widest uppercase">{t("暂无连接", "Idle State")}</span>
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pr-0.5 -mr-0.5">
                  {runners.map((runner) => {
                    const online = runner.state === "online";
                    return (
                      <div key={runner.id} className="flex items-center gap-2.5 py-1.5 min-w-0">
                        <span
                          className={`relative inline-flex rounded-full h-2 w-2 flex-none ${online ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.35)]" : "bg-zinc-400"}`}
                          title={online ? t("在线", "Online") : t("离线", "Offline")}
                        />
                        <Icon icon={runnerPlatformIcon(runner.platform)} className="text-[14px] lg:text-sm flex-none" />
                        <span className="text-[12px] lg:text-[14px] font-medium font-sans text-(--color-base-content) truncate flex-1 min-w-0">
                          {runner.name || runner.hostname || runner.id.slice(0, 8)}
                        </span>
                        {runner.supportedWorkers && runner.supportedWorkers.length > 0 ? (
                          <span
                            className="flex items-center gap-1 flex-none"
                            title={t("该执行端支持的 Worker", "Workers available on this runner")}
                          >
                            {runner.supportedWorkers.map((kind) => (
                              <WorkerLogo key={kind} kind={kind} size={13} className="opacity-70" />
                            ))}
                          </span>
                        ) : null}
                        <span className="text-[10px] lg:text-[12px] text-muted opacity-70 font-mono whitespace-nowrap flex-none">
                          {formatRelativeTime(runner.lastSeenAt, now)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </FadeContent>
        </div>

        {/* Token Usage by Project */}
        <FadeContent delay={200} className="flex-none">
          <div className="w-full rounded-[16px] bg-(--color-base-100) p-4 lg:p-5 flex flex-col relative transition-all duration-500 hover:shadow-[0_8px_30px_-4px_color-mix(in_srgb,var(--color-base-content)_4%,transparent)] group">
            <div className="flex items-center gap-2 text-[12px] lg:text-[13px] font-medium text-muted font-sans mb-3">
              <Icon icon="mingcute:chart-bar-line" className="text-[16px] lg:text-lg opacity-60 group-hover:opacity-100 transition-opacity" />
              <span>{t("Token 用量", "Token Usage")}</span>
              <span className="ml-auto text-[10px] lg:text-[11px] text-muted opacity-60 font-normal hidden sm:inline">
                {t("按项目统计，颜色区分 Worker", "By project, colored by worker")}
              </span>
            </div>
            <div className="min-h-[180px]">
              <ProjectTokenChart data={projectTokenUsage} />
            </div>
          </div>
        </FadeContent>

        {/* Bottom Row: Workers & Queues（暂时隐藏，恢复请改 SHOW_WORKER_PANELS） */}
        {SHOW_WORKER_PANELS && (
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
              {allWorkers.map((worker) => {
                const nativeProbe = installProbes[worker.kind as InstallTargetId];
                const wslProbe = installProbes[`wsl:${worker.kind}` as InstallTargetId];
                return (
                  <WorkerConfigCard
                    key={worker.kind}
                    kind={worker.kind}
                    label={worker.label}
                    executable={worker.executable}
                    available={worker.available}
                    nativeProbe={nativeProbe}
                    wslProbe={wslProbe}
                    uiLanguage={uiLanguage}
                    variant="overview"
                    onRefreshProbes={onRefreshProbes}
                  />
                );
              })}
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
              <div className="flex gap-3 lg:gap-4 text-[12px] lg:text-[12px] font-sans text-muted">
                <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${statusDotClass("进行中")} opacity-80`}></span>{metrics.runningCount} 运行</span>
                <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${statusDotClass("待办")} opacity-80`}></span>{metrics.pending} 待办</span>
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
                    <span className="text-[12px] lg:text-[14px] font-sans tracking-widest uppercase">Idle State</span>
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
                            <span className="text-[14px] lg:text-[14px] font-medium font-sans text-(--color-base-content) truncate tracking-wide">{entry.workerLabel}</span>
                            <span className="text-[10px] lg:text-[12px] text-muted font-mono opacity-60">ID: {entry.workerId.slice(0, 8)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-none pl-3 lg:pl-4">
                          <span className="text-[12px] lg:text-[14px] font-medium font-sans text-(--color-base-content) max-w-[100px] lg:max-w-[180px] truncate opacity-90">{entry.projectName}</span>
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
        )}
      </div>
    </section>
  );
}

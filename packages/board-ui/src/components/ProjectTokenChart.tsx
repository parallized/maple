import { Icon } from "@iconify/react";
import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { BarStack } from "@visx/shape";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { WorkerKind } from "../domain";
import { WORKER_KINDS, type UiLanguage } from "../lib/constants";
import { USD_TO_CNY_RATE } from "../lib/token-cost";

export interface ProjectTokenRoleUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  /** models.dev 定价估算的该角色 USD 成本；无定价数据时为 null。 */
  costUsd: number | null;
}

export interface ProjectTokenChartEntry {
  projectId: string;
  name: string;
  totalTokens: number;
  /** Worker（任务执行）产生的用量，按 Worker 类型分桶。 */
  byWorker: Partial<Record<WorkerKind, number>>;
  /** Leader（调度决策）产生的用量，按 Worker 类型分桶。 */
  byLeader: Partial<Record<WorkerKind, number>>;
  /** 分角色的 token 明细与成本（hover 判定共用整柱，数值按角色独立计算）。 */
  worker: ProjectTokenRoleUsage;
  leader: ProjectTokenRoleUsage;
  /** 项目任务数，用于计算平均每任务成本。 */
  taskCount: number;
}

interface ProjectTokenChartProps {
  data: ProjectTokenChartEntry[];
  /** 中文界面成本按人民币展示（粗略汇率换算）。 */
  uiLanguage?: UiLanguage;
}

const ALL_WORKER_KINDS = WORKER_KINDS.map((item) => item.kind);
const WORKER_COLOR: Record<WorkerKind, string> = WORKER_KINDS.reduce(
  (acc, item) => {
    acc[item.kind] = item.color;
    return acc;
  },
  {} as Record<WorkerKind, string>
);
const WORKER_LABEL: Record<WorkerKind, string> = WORKER_KINDS.reduce(
  (acc, item) => {
    acc[item.kind] = item.label;
    return acc;
  },
  {} as Record<WorkerKind, string>
);

/** 堆叠 key 前缀：同一柱子上 Leader 段排在 Worker 段之上。 */
const LEADER_KEY_PREFIX = "leader:";
const kindOfKey = (key: string): WorkerKind => key.replace(LEADER_KEY_PREFIX, "") as WorkerKind;
const isLeaderKey = (key: string): boolean => key.startsWith(LEADER_KEY_PREFIX);

/** 出现在数据中的 worker 类型（用于 legend 与堆叠顺序，保持稳定）。 */
function usedStackKeys(data: ProjectTokenChartEntry[]): { workerKinds: WorkerKind[]; keys: string[] } {
  const workerSet = new Set<WorkerKind>();
  const leaderSet = new Set<WorkerKind>();
  for (const entry of data) {
    for (const key of Object.keys(entry.byWorker) as WorkerKind[]) {
      if ((entry.byWorker[key] ?? 0) > 0) workerSet.add(key);
    }
    for (const key of Object.keys(entry.byLeader) as WorkerKind[]) {
      if ((entry.byLeader[key] ?? 0) > 0) leaderSet.add(key);
    }
  }
  const workerKinds = ALL_WORKER_KINDS.filter((kind) => workerSet.has(kind));
  const leaderKinds = ALL_WORKER_KINDS.filter((kind) => leaderSet.has(kind));
  return {
    workerKinds,
    keys: [...workerKinds, ...leaderKinds.map((kind) => `${LEADER_KEY_PREFIX}${kind}`)]
  };
}

/** 数字 → 带 K/M 的简短形式，用于坐标轴与图例。 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

/** 成本金额：中文按人民币（粗略汇率），英文按 USD 原价；大额两位小数，小额保留四位。 */
function formatCost(usd: number, uiLanguage: UiLanguage | undefined): string {
  if (uiLanguage === "en") return `$${usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(4)}`;
  const cny = usd * USD_TO_CNY_RATE;
  return `¥${cny >= 0.1 ? cny.toFixed(2) : cny.toFixed(4)}`;
}

/** 监听容器宽度变化（ResizeObserver），供响应式柱状图使用。deps 变化时重新测量——空态不渲染容器，数据到达后需重新挂载观察。 */
function useContainerWidth(deps: unknown[] = []): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => update());
    observer?.observe(node);
    return () => observer?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, width];
}

const MARGIN = { top: 12, right: 8, bottom: 28, left: 40 };
/** Leader 段远小于 Worker 段时的最小可视高度（px），保证虚线描边可辨认。 */
const LEADER_MIN_HEIGHT = 6;

export function ProjectTokenChart({ data, uiLanguage }: ProjectTokenChartProps) {
  const { workerKinds, keys } = usedStackKeys(data);
  const maxValue = Math.max(1, ...data.map((entry) => entry.totalTokens));

  const [containerRef, width] = useContainerWidth([data.length]);
  // 整柱 hover：记录悬停的项目与鼠标在容器内的坐标（tooltip 跟随）。
  const [hover, setHover] = useState<{ projectId: string; x: number; y: number } | null>(null);
  const height = 200;
  const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerHeight = Math.max(0, height - MARGIN.top - MARGIN.bottom);

  // 条目越多越细，但单条/少条时不要占满全宽显得过粗。
  // 给每条限定最大宽度，超出部分留白，整体居中。
  const MAX_BAR_WIDTH = 48;
  const bandCount = data.length;
  const idealBandWidth = bandCount > 0 ? innerWidth / bandCount : innerWidth;
  const cappedBandWidth = Math.min(idealBandWidth, MAX_BAR_WIDTH + MAX_BAR_WIDTH * 0.35 * 2);
  const bandRangeWidth = cappedBandWidth * bandCount;
  const bandOffset = (innerWidth - bandRangeWidth) / 2;

  const xScale = scaleBand<string>({
    domain: data.map((entry) => entry.projectId),
    range: [Math.max(0, bandOffset), Math.max(0, bandOffset) + bandRangeWidth],
    padding: 0.35
  });
  const yScale = scaleLinear<number>({
    domain: [0, maxValue],
    range: [innerHeight, 0],
    nice: true
  });

  const tickValues: number[] = yScale.ticks(4);
  const hoveredEntry = hover ? data.find((entry) => entry.projectId === hover.projectId) ?? null : null;

  if (data.length === 0) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-2 opacity-40">
        <Icon icon="mingcute:chart-bar-line" className="text-xl lg:text-2xl" />
        <span className="text-[11px] lg:text-[12px] font-sans tracking-wide">暂无用量数据</span>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col gap-3 min-h-0">
      <div ref={containerRef} className="w-full flex-1 min-h-0 relative">
        <svg width="100%" height={height} role="img" aria-label="项目 token 用量">
          <Group top={MARGIN.top} left={MARGIN.left}>
            {/* 横向参考线 */}
            {tickValues.map((tick: number) => (
              <g key={`tick-${tick}`}>
                <line
                  x1={0}
                  x2={innerWidth}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  stroke="var(--color-base-300)"
                  strokeOpacity={0.5}
                  strokeDasharray="2 3"
                />
                <text
                  x={-8}
                  y={yScale(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={9}
                  fill="var(--color-base-content)"
                  fillOpacity={0.5}
                >
                  {formatTokens(tick)}
                </text>
              </g>
            ))}

            {/* 整柱高亮：悬停时铺满整个 band，把多段堆叠视觉上合成一根柱子 */}
            {hoveredEntry ? (
              <rect
                x={xScale(hoveredEntry.projectId) ?? 0}
                y={0}
                width={xScale.bandwidth()}
                height={innerHeight}
                rx={4}
                fill="var(--color-base-content)"
                fillOpacity={0.06}
                pointerEvents="none"
              />
            ) : null}

            <BarStack<ProjectTokenChartEntry, string>
              data={data}
              keys={keys}
              x={(entry) => entry.projectId}
              value={(entry, key) =>
                isLeaderKey(key) ? entry.byLeader[kindOfKey(key)] ?? 0 : entry.byWorker[kindOfKey(key)] ?? 0
              }
              xScale={xScale}
              yScale={yScale}
              color={(key) => WORKER_COLOR[kindOfKey(key)]}
            >
              {(barStacks) =>
                barStacks.map((bar) =>
                  bar.bars.map((barPart) => {
                    const leader = isLeaderKey(barPart.key);
                    const kind = kindOfKey(barPart.key);
                    const datum = barPart.bar.data as ProjectTokenChartEntry;
                    // codex 品牌色为纯白，浅色主题下在白色卡片上不可见；改用前景色（深色主题下本来就是近白）。
                    const isWhite = WORKER_COLOR[kind].toLowerCase() === "#ffffff";
                    const color = isWhite ? "var(--color-base-content)" : barPart.color;
                    const value = leader ? datum.byLeader[kind] ?? 0 : datum.byWorker[kind] ?? 0;
                    // Leader 段用量小时会缩成一条线，抬高到最小高度（向上扩展，柱顶有 12px 上边距余量）。
                    const minHeightAdjust = leader && value > 0 && barPart.height < LEADER_MIN_HEIGHT;
                    const barHeight = minHeightAdjust ? LEADER_MIN_HEIGHT : Math.max(0, barPart.height);
                    const barY = minHeightAdjust ? barPart.y - (LEADER_MIN_HEIGHT - barPart.height) : barPart.y;
                    // 同一柱子上的两种设计：Worker 段实心品牌色；Leader 段半透明 + 同色虚线描边。
                    return (
                      <motion.rect
                        key={`bar-${bar.index}-${barPart.key}`}
                        x={barPart.x}
                        y={barY}
                        width={barPart.width}
                        height={barHeight}
                        fill={color}
                        fillOpacity={leader ? 0.16 : 1}
                        stroke={leader ? color : "none"}
                        strokeWidth={leader ? 1 : 0}
                        strokeDasharray={leader ? "3 2" : undefined}
                        initial={{ opacity: 0, scaleY: 0.6 }}
                        animate={{ opacity: leader ? 1 : 0.92, scaleY: 1 }}
                        transition={{ duration: 0.4, delay: bar.index * 0.04 }}
                        style={{ transformOrigin: "bottom" }}
                      >
                        <title>
                          {datum.name} · {WORKER_LABEL[kind]} · {leader ? "Leader" : "Worker"}：{formatTokens(value)}
                        </title>
                      </motion.rect>
                    );
                  })
                )
              }
            </BarStack>

            {/* x 轴：项目名 */}
            {data.map((entry) => {
              const cx = (xScale(entry.projectId) ?? 0) + xScale.bandwidth() / 2;
              return (
                <text
                  key={`xlabel-${entry.projectId}`}
                  x={cx}
                  y={innerHeight + 16}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--color-base-content)"
                  fillOpacity={0.6}
                >
                  {entry.name.length > 8 ? `${entry.name.slice(0, 7)}…` : entry.name}
                </text>
              );
            })}

            {/* 整柱 hover 捕获层（置顶透明 rect，覆盖所有堆叠段） */}
            {data.map((entry) => (
              <rect
                key={`hover-${entry.projectId}`}
                x={xScale(entry.projectId) ?? 0}
                y={0}
                width={xScale.bandwidth()}
                height={innerHeight}
                fill="transparent"
                onMouseMove={(event) => {
                  const bounds = containerRef.current?.getBoundingClientRect();
                  if (!bounds) return;
                  setHover({
                    projectId: entry.projectId,
                    x: event.clientX - bounds.left,
                    y: event.clientY - bounds.top
                  });
                }}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </Group>
        </svg>

        {/* 跟随鼠标的用量明细 tooltip：hover 判定整柱共用，数值按 Leader / Worker 分开 */}
        {hoveredEntry && hover ? (
          <div
            className="pointer-events-none absolute z-10 rounded-[10px] border border-(--color-base-300) bg-(--color-base-100) px-3 py-2.5"
            style={{
              left: Math.min(Math.max(hover.x, 150), Math.max(150, width - 150)),
              top: hover.y,
              transform: "translate(-50%, calc(-100% - 10px))"
            }}
          >
            <div className="mb-1.5 w-[264px] truncate text-[12px] font-semibold text-(--color-base-content)">{hoveredEntry.name}</div>
            <div className="grid grid-cols-2 gap-3">
              {([
                ["Worker", hoveredEntry.worker],
                ["Leader", hoveredEntry.leader]
              ] as const).map(([role, usage]) => (
                <div key={role} className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-(--color-secondary)/60">{role}</span>
                  {([
                    ["输入", usage.inputTokens],
                    ["缓存", usage.cachedInputTokens],
                    ["输出", usage.outputTokens],
                    ["推理", usage.reasoningOutputTokens]
                  ] as const).map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between text-[11px]">
                      <span className="text-(--color-secondary)/70">{label}</span>
                      <span className="font-mono text-(--color-base-content)/85">{formatTokens(value)}</span>
                    </div>
                  ))}
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="text-(--color-secondary)/70">成本</span>
                    <span className="font-mono text-(--color-base-content)/85">
                      {usage.costUsd !== null ? formatCost(usage.costUsd, uiLanguage) : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="my-1.5 border-t border-(--color-base-300)/60" />
            {(() => {
              const totalCost =
                hoveredEntry.worker.costUsd !== null || hoveredEntry.leader.costUsd !== null
                  ? (hoveredEntry.worker.costUsd ?? 0) + (hoveredEntry.leader.costUsd ?? 0)
                  : null;
              return (
                <div className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="text-(--color-secondary)/70">合计</span>
                    <span className="font-mono font-semibold text-(--color-base-content)">
                      {formatTokens(hoveredEntry.totalTokens)}
                      {totalCost !== null ? ` · ${formatCost(totalCost, uiLanguage)}` : ""}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="text-(--color-secondary)/70">平均每任务</span>
                    <span className="font-mono text-(--color-primary)">
                      {totalCost !== null && hoveredEntry.taskCount > 0
                        ? formatCost(totalCost / hoveredEntry.taskCount, uiLanguage)
                        : "—"}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : null}
      </div>

      {/* Legend：颜色区分 Worker 类型；实心 / 虚线区分 Worker / Leader 角色 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 flex-none">
        {workerKinds.map((kind) => (
          <span key={kind} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-sm flex-none"
              style={{
                backgroundColor:
                  WORKER_COLOR[kind].toLowerCase() === "#ffffff" ? "var(--color-base-content)" : WORKER_COLOR[kind]
              }}
            />
            <span className="text-[10px] lg:text-[11px] text-muted font-sans">{WORKER_LABEL[kind]}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5 ml-auto">
          <span className="w-2 h-2 rounded-sm flex-none bg-(--color-secondary)/70" />
          <span className="text-[10px] lg:text-[11px] text-muted font-sans">Worker</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm flex-none border border-dashed border-(--color-secondary)/70 bg-(--color-secondary)/15" />
          <span className="text-[10px] lg:text-[11px] text-muted font-sans">Leader</span>
        </span>
      </div>
    </div>
  );
}

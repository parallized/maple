/**
 * Leader 派单的活动看门狗，独立于返工 / 执行报告：
 * - 空闲超时：完全无动静（无任何输出 / 事件）持续超过上限就终止，默认 30 秒。
 * - 硬性兜底：无论是否有动静，单次派单总时长超过上限就强制终止，默认 2 分钟，
 *   防止“看似有动静实则卡死”。
 */
export const DEFAULT_MANAGER_IDLE_TIMEOUT_MS = 30_000;
export const DEFAULT_MANAGER_HARD_TIMEOUT_MS = 120_000;
/** 兼容旧名：等同 Leader 空闲超时。 */
export const DEFAULT_MANAGER_TIMEOUT_MS = DEFAULT_MANAGER_IDLE_TIMEOUT_MS;

export type LeaderTimeoutReason = "idle" | "hard";

export interface LeaderTimeoutConfig {
  idleTimeoutMs: number;
  hardTimeoutMs: number;
}

function durationText(timeoutMs: number): string {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1_000));
  return seconds % 60 === 0
    ? `${seconds / 60} 分钟`
    : `${seconds} 秒`;
}

export function leaderIdleTimeoutMessage(timeoutMs: number): string {
  return `Leader PM 已连续 ${durationText(timeoutMs)}无动静，已自动停止本次派单。`;
}

export function leaderHardTimeoutMessage(timeoutMs: number): string {
  return `Leader PM 执行超过 ${durationText(timeoutMs)}，已强制停止本次派单。`;
}

function boundedTimeout(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed >= 1_000
    ? parsed
    : fallback;
}

export function leaderIdleTimeoutFromEnv(
  env: Record<string, string | undefined> = process.env
): number {
  return boundedTimeout(env.MAPLE_MANAGER_IDLE_TIMEOUT_MS, DEFAULT_MANAGER_IDLE_TIMEOUT_MS);
}

export function leaderHardTimeoutFromEnv(
  env: Record<string, string | undefined> = process.env
): number {
  return boundedTimeout(env.MAPLE_MANAGER_HARD_TIMEOUT_MS, DEFAULT_MANAGER_HARD_TIMEOUT_MS);
}

export interface LeaderTimeoutOverrides {
  timeoutMs?: number;
  hardTimeoutMs?: number;
}

export function resolveLeaderTimeoutConfig(
  overrides: LeaderTimeoutOverrides = {},
  env: Record<string, string | undefined> = process.env
): LeaderTimeoutConfig {
  return {
    idleTimeoutMs: overrides.timeoutMs ?? leaderIdleTimeoutFromEnv(env),
    hardTimeoutMs: overrides.hardTimeoutMs ?? leaderHardTimeoutFromEnv(env)
  };
}

export interface LeaderTimeoutWatchdog {
  config: LeaderTimeoutConfig;
  /** 调用方收到 Leader 输出 / 事件时上报动静，重置空闲计时。 */
  markActivity(): void;
  /** 已触发的超时原因；未超时为 null。 */
  readonly reason: LeaderTimeoutReason | null;
  /** 清除计时器；Leader 派单结束（含异常）时必须调用。 */
  dispose(): void;
}

export function createLeaderTimeoutWatchdog(
  onTimeout: (reason: LeaderTimeoutReason, message: string) => void,
  overrides: LeaderTimeoutOverrides = {},
  env: Record<string, string | undefined> = process.env
): LeaderTimeoutWatchdog {
  const config = resolveLeaderTimeoutConfig(overrides, env);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  let reason: LeaderTimeoutReason | null = null;
  const stopTimers = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (hardTimer) clearTimeout(hardTimer);
    hardTimer = null;
  };
  /** 只允许先到的超时生效，避免进程收尾阶段被另一个计时器改写成错误原因。 */
  const fire = (firedReason: LeaderTimeoutReason, message: string) => {
    if (reason !== null) return;
    reason = firedReason;
    stopTimers();
    onTimeout(firedReason, message);
  };
  /** 每次 Leader 有动静都重置空闲计时；一旦连续无动静超过上限即触发空闲超时。 */
  const markActivity = () => {
    if (reason !== null) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      fire("idle", leaderIdleTimeoutMessage(config.idleTimeoutMs));
    }, config.idleTimeoutMs);
  };
  markActivity();
  /** 总时长兜底：无论是否有动静，超过上限就强制触发，避免“看似有动静实则卡死”。 */
  hardTimer = setTimeout(() => {
    hardTimer = null;
    fire("hard", leaderHardTimeoutMessage(config.hardTimeoutMs));
  }, config.hardTimeoutMs);
  return {
    config,
    markActivity,
    get reason() {
      return reason;
    },
    dispose() {
      stopTimers();
    }
  };
}

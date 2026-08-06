import { describe, expect, it } from "bun:test";
import {
  createLeaderTimeoutWatchdog,
  DEFAULT_MANAGER_HARD_TIMEOUT_MS,
  DEFAULT_MANAGER_IDLE_TIMEOUT_MS,
  DEFAULT_MANAGER_TIMEOUT_MS,
  leaderHardTimeoutFromEnv,
  leaderIdleTimeoutFromEnv,
  resolveLeaderTimeoutConfig,
  type LeaderTimeoutReason
} from "../src/manager/leader-timeout";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Leader timeout watchdog", () => {
  it("defaults to a 30-second idle limit with a 2-minute hard fallback", () => {
    expect(DEFAULT_MANAGER_IDLE_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_MANAGER_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_MANAGER_HARD_TIMEOUT_MS).toBe(120_000);
  });

  it("reads env overrides and falls back to defaults for invalid values", () => {
    expect(leaderIdleTimeoutFromEnv({ MAPLE_MANAGER_IDLE_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(leaderHardTimeoutFromEnv({ MAPLE_MANAGER_HARD_TIMEOUT_MS: "180000" })).toBe(180_000);
    expect(leaderIdleTimeoutFromEnv({ MAPLE_MANAGER_IDLE_TIMEOUT_MS: "abc" })).toBe(DEFAULT_MANAGER_IDLE_TIMEOUT_MS);
    expect(leaderHardTimeoutFromEnv({ MAPLE_MANAGER_HARD_TIMEOUT_MS: "0" })).toBe(DEFAULT_MANAGER_HARD_TIMEOUT_MS);
  });

  it("lets explicit overrides win over the environment", () => {
    const config = resolveLeaderTimeoutConfig(
      { timeoutMs: 1_500, hardTimeoutMs: 3_000 },
      {
        MAPLE_MANAGER_IDLE_TIMEOUT_MS: "45000",
        MAPLE_MANAGER_HARD_TIMEOUT_MS: "180000"
      }
    );
    expect(config).toEqual({ idleTimeoutMs: 1_500, hardTimeoutMs: 3_000 });
  });

  it("fires the idle timeout when no activity is reported", async () => {
    const fired: Array<{ reason: LeaderTimeoutReason; message: string }> = [];
    const watchdog = createLeaderTimeoutWatchdog((reason, message) => {
      fired.push({ reason, message });
    }, { timeoutMs: 30, hardTimeoutMs: 400 });

    await wait(80);
    watchdog.dispose();

    expect(fired).toEqual([{
      reason: "idle",
      message: "Leader PM 已连续 1 秒无动静，已自动停止本次派单。"
    }]);
    expect(watchdog.reason).toBe("idle");
  });

  it("resets the idle deadline whenever activity is reported", async () => {
    const fired: Array<{ reason: LeaderTimeoutReason; message: string }> = [];
    const watchdog = createLeaderTimeoutWatchdog((reason, message) => {
      fired.push({ reason, message });
    }, { timeoutMs: 40, hardTimeoutMs: 300 });

    for (let index = 0; index < 10; index += 1) {
      await wait(15);
      watchdog.markActivity();
    }
    watchdog.dispose();

    expect(fired).toEqual([]);
    expect(watchdog.reason).toBeNull();
  });

  it("hard-stops a busy-but-stuck watchdog that keeps seeing activity", async () => {
    const fired: Array<{ reason: LeaderTimeoutReason; message: string }> = [];
    const watchdog = createLeaderTimeoutWatchdog((reason, message) => {
      fired.push({ reason, message });
    }, { timeoutMs: 100, hardTimeoutMs: 60 });

    const interval = setInterval(() => watchdog.markActivity(), 5);
    await wait(120);
    clearInterval(interval);
    watchdog.dispose();

    expect(fired).toEqual([{
      reason: "hard",
      message: "Leader PM 执行超过 1 秒，已强制停止本次派单。"
    }]);
    expect(watchdog.reason).toBe("hard");
  });

  it("stops timing out once disposed", async () => {
    const fired: Array<{ reason: LeaderTimeoutReason; message: string }> = [];
    const watchdog = createLeaderTimeoutWatchdog((reason, message) => {
      fired.push({ reason, message });
    }, { timeoutMs: 30, hardTimeoutMs: 60 });

    watchdog.dispose();
    await wait(100);

    expect(fired).toEqual([]);
    expect(watchdog.reason).toBeNull();
  });
});

import type { AgentCommandOptions, SandboxLevel } from "./adapters/types";

/**
 * Worker 沙箱自动提权。
 *
 * codex 系 Worker（codex / deepseek）有真实的沙箱档位：
 *   workspace-write → danger-full-access → sandbox-bypass
 * 其余 Worker（claude / gemini / kimi / glm / opencode / iflow）默认已处于各自
 * 的最高放行档，没有可再提的档位。
 *
 * 自动提权只针对 Worker 自身的内层沙箱；若 Maple CLI 本身运行在外层受限沙箱内
 * （如 Codex Windows 沙箱会话），内层 Worker 无论提到哪一档都受外层约束，此时
 * 由 permission-blocker 给出宿主侧引导，而不是反复空转。
 */

/** 单次任务自动提权最大步数：从最低档一路提到最高档后即止。 */
export const MAX_AUTO_ELEVATION_STEPS = 2;

export interface SandboxLevelContext {
  readOnly?: boolean;
  fullAccess?: boolean;
  windowsSandboxBypass?: boolean;
}

/** 调用方当前显式配置对应的初始档位。 */
export function initialSandboxLevel(input: SandboxLevelContext): SandboxLevel {
  if (input.readOnly) return "read-only";
  if (input.windowsSandboxBypass) return "sandbox-bypass";
  return input.fullAccess ? "danger-full-access" : "workspace-write";
}

/** 下一更高档位；已是最高档或只读场景返回 null（不做提权）。 */
export function nextSandboxLevel(level: SandboxLevel): SandboxLevel | null {
  switch (level) {
    case "read-only":
      return null;
    case "workspace-write":
      return "danger-full-access";
    case "danger-full-access":
      return "sandbox-bypass";
    case "sandbox-bypass":
      return null;
  }
}

/** 从初始档位到最高档的完整提权阶梯（首项即初始档位）。 */
export function sandboxElevationLadder(input: SandboxLevelContext): SandboxLevel[] {
  const ladder: SandboxLevel[] = [initialSandboxLevel(input)];
  let current = ladder[0];
  for (let steps = 0; steps < MAX_AUTO_ELEVATION_STEPS; steps += 1) {
    const next = nextSandboxLevel(current);
    if (!next) break;
    ladder.push(next);
    current = next;
  }
  return ladder;
}

/** 面向用户的档位名称。 */
export function sandboxLevelLabel(level: SandboxLevel): string {
  switch (level) {
    case "read-only":
      return "只读";
    case "workspace-write":
      return "工作区可写";
    case "danger-full-access":
      return "完全放行";
    case "sandbox-bypass":
      return "绕过沙箱";
  }
}

/** 把某个档位落到具体的启动参数。 */
export function applySandboxLevel(
  options: AgentCommandOptions,
  level: SandboxLevel
): AgentCommandOptions {
  switch (level) {
    case "read-only":
      return { ...options, readOnly: true, fullAccess: false, bypassSandbox: false };
    case "workspace-write":
      return { ...options, readOnly: false, fullAccess: false, bypassSandbox: false };
    case "danger-full-access":
      return { ...options, readOnly: false, fullAccess: true, bypassSandbox: false };
    case "sandbox-bypass":
      return { ...options, readOnly: false, fullAccess: true, bypassSandbox: true };
  }
}

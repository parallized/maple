import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Codex Windows 沙箱宿主级环境适配。
 *
 * 在原生 Windows + workspace-write 下，Codex 每条命令执行前都会调用
 * codex-windows-sandbox-setup.exe 做 setup refresh：重写工作区目录 DACL，给沙箱主体
 * （CodexSandboxUsers 等）补显式可继承 Modify ACE。若工作区目录只有继承 ACL、
 * 且当前用户没有 WRITE_DAC（非所有者 / 未提权），刷新失败会阻塞整个会话，
 * 表现为 `helper_unknown_error: setup refresh had errors` 或 OS error 740
 * （openai/codex #14585 / #10601 / #24098 同类）。该问题定位在宿主环境，不在仓库代码。
 *
 * 这里提供两层兜底：
 * 1. prepareCodexWindowsSandbox：启动前自愈，若工作区缺少沙箱主体的显式 Modify ACE
 *    则尽力补齐；补不了时给出可执行提示，避免用户被"全命令报错"困住。
 * 2. describeWindowsSandboxFailure：进程失败后识别已知错误签名，给出同样的可执行提示。
 */

/** codex-windows-sandbox-setup.exe 使用的本地组名（各机器一致）。 */
export const CODEX_SANDBOX_GROUP = "CodexSandboxUsers";

/** 启动前自愈最多覆盖的"直接子目录"数量，避免大仓库拖慢启动。 */
const MAX_IMMEDIATE_SUBDIR_TARGETS = 32;

const NO_MAPPING_PATTERN =
  /(?:no mapping between account names|account names?.*not found|cannot find|找不到|没有完成.*映射)/i;

export interface IcaclsResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** 预检使用的宿主原语；默认实现走 icacls，测试可注入假实现。 */
export interface WindowsSandboxTools {
  isWindows: boolean;
  listImmediateSubdirectories: (dir: string) => string[];
  readAcl: (dir: string) => IcaclsResult | Promise<IcaclsResult>;
  grantModify: (dir: string, principal: string) => IcaclsResult | Promise<IcaclsResult>;
  currentUserPrincipal: () => string;
}

export interface WindowsSandboxPreparation {
  /** 面向用户的简短说明；为空表示无需提示。 */
  note?: string;
  /** note 属于需要用户介入的警告，而非已完成的自愈。 */
  warning?: boolean;
}

function defaultIcacls(...args: string[]): IcaclsResult {
  const result = Bun.spawnSync(["icacls", ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  };
}

export function defaultWindowsSandboxTools(): WindowsSandboxTools {
  return {
    isWindows: process.platform === "win32",
    listImmediateSubdirectories: (dir) => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .slice(0, MAX_IMMEDIATE_SUBDIR_TARGETS)
          .map((entry) => join(dir, entry.name));
      } catch {
        return [];
      }
    },
    readAcl: (dir) => defaultIcacls(dir),
    grantModify: (dir, principal) => defaultIcacls(dir, "/grant", `${principal}:(OI)(CI)M`),
    currentUserPrincipal: () => {
      const domain = process.env.USERDOMAIN?.trim();
      const username = process.env.USERNAME?.trim();
      return domain && username ? `${domain}\\${username}` : username || "";
    }
  };
}

/** 判断 icacls 输出里指定主体是否已有"显式 + 可继承 + Modify/Full"的 ACE。 */
export function hasExplicitInheritableModifyAce(icaclsOutput: string, principal: string): boolean {
  const escaped = principal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 本地组在 icacls 输出里可能带域名前缀（如 holybread\CodexSandboxUsers），也可能不带。
  const pattern = new RegExp(`^\\s*(?:.*\\\\)?${escaped}\\s*:(.+)$`, "im");
  const line = icaclsOutput.match(pattern)?.[1] ?? "";
  if (!line) return false;
  if (/\(I\)/.test(line)) return false;
  return /\(OI\)/.test(line) && /\(CI\)/.test(line) && /\(M\)|\(F\)/.test(line);
}

const SETUP_REFRESH_SIGNATURES = [
  /helper_unknown_error\s*:\s*setup\s+refresh\s+had\s+errors/i,
  /setup\s+refresh\s+(?:had errors|failed(?: with status)?)/i,
  /windows\s+sandbox.{0,80}(?:setup|refresh).{0,40}(?:failed|error)/is
];

const ELEVATION_SIGNATURES = [
  /\bOS error 740\b/i,
  /requested operation requires elevation/i,
  /requires elevation/i
];

const REFRESH_GUIDANCE =
  "Codex Windows 沙箱初始化失败：工作区目录 ACL 刷新被拒绝（Codex 宿主环境已知问题，非项目代码问题）。"
  + "请依次尝试：① 完全退出并重启 Codex；② 以管理员身份运行 Codex；③ 用管理员 PowerShell 执行 "
  + `icacls "<工作区目录>" /grant "${CODEX_SANDBOX_GROUP}:(OI)(CI)M"；④ /clear 重开会话。`;

const ELEVATION_GUIDANCE =
  "Codex Windows 沙箱需要管理员权限启动辅助进程（OS error 740）。"
  + `请完全退出后以管理员身份运行 Codex；仍失败时可在管理员 PowerShell 执行 icacls "<工作区目录>" `
  + `/grant "${CODEX_SANDBOX_GROUP}:(OI)(CI)M" 后重试。`;

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

/** 识别 Codex Windows 沙箱 setup refresh 失败 / 提权失败的已知错误签名。 */
export function describeWindowsSandboxFailure(output: string): string | null {
  const refreshBlocked = matchesAny(output, SETUP_REFRESH_SIGNATURES);
  const needsElevation = matchesAny(output, ELEVATION_SIGNATURES);
  if (!refreshBlocked && !needsElevation) return null;
  return refreshBlocked ? REFRESH_GUIDANCE : ELEVATION_GUIDANCE;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

/**
 * 启动前的 Windows 沙箱自愈（仅 workspace-write）。
 *
 * 快速路径：工作区根目录已有沙箱主体的显式可继承 Modify ACE 时直接返回，不做任何写入。
 * 缺失时：为工作区根目录、显式可写目录与直接子目录尽力补齐；补不了则返回管理员介入提示。
 */
export async function prepareCodexWindowsSandbox(
  cwd: string,
  options: { readOnly?: boolean; additionalWritableDirectories?: string[] } = {},
  tools: WindowsSandboxTools = defaultWindowsSandboxTools()
): Promise<WindowsSandboxPreparation> {
  if (!tools.isWindows) return {};
  if (options.readOnly) return {};

  const rootAcl = await tools.readAcl(cwd);
  if (hasExplicitInheritableModifyAce(rootAcl.stdout, CODEX_SANDBOX_GROUP)) return {};

  const subdirectories = tools.listImmediateSubdirectories(cwd);
  const targets = uniquePaths([
    cwd,
    ...(options.additionalWritableDirectories ?? []),
    ...subdirectories
  ]);
  if (targets.length === 0) return {};

  const fallbackPrincipal = tools.currentUserPrincipal();
  let repaired = 0;
  const failed: string[] = [];

  for (const target of targets) {
    let grant = await tools.grantModify(target, CODEX_SANDBOX_GROUP);
    if (!grant.ok && NO_MAPPING_PATTERN.test(grant.stderr) && fallbackPrincipal) {
      grant = await tools.grantModify(target, fallbackPrincipal);
    }
    if (grant.ok) {
      repaired += 1;
    } else {
      failed.push(target);
    }
  }

  if (failed.length === 0) {
    return repaired > 0
      ? { note: `已为 Codex Windows 沙箱补齐工作区写入权限（${repaired} 个目录），可继续执行。` }
      : {};
  }

  return {
    warning: true,
    note:
      "Codex Windows 沙箱需要工作区写入权限，但当前用户没有目录 ACL 修改权限"
      + `（${failed.join("、")}）。请以管理员身份运行 Maple / Codex，或用管理员 PowerShell 执行 `
      + `icacls "<工作区目录>" /grant "${CODEX_SANDBOX_GROUP}:(OI)(CI)M" 后重试。`
  };
}

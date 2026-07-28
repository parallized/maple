/**
 * 终端能力探测：决定 TUI 使用全量绘制还是降级为逐行文本。
 * 全部逻辑基于注入的环境变量与 TTY 标志，方便针对各种 Shell 环境做单元测试。
 */

export type ShellFlavor =
  | "bash"
  | "zsh"
  | "fish"
  | "sh"
  | "git-bash"
  | "pwsh"
  | "powershell"
  | "cmd"
  | "unknown";

export interface TerminalCapabilities {
  /** 可以进入全屏交互（raw mode + ANSI 重绘）。 */
  interactive: boolean;
  /** 终端理解 ANSI 转义序列。 */
  ansi: boolean;
  /** 可以使用颜色（受 NO_COLOR 约束）。 */
  color: boolean;
  /** 可以安全输出 Unicode 符号（否则退回 ASCII）。 */
  unicode: boolean;
  /** 当前运行所处的 Shell 类型（尽力识别）。 */
  shell: ShellFlavor;
  columns: number;
  rows: number;
}

export interface CapabilityInput {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform | string;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  columns?: number;
  rows?: number;
}

export function detectShellFlavor(env: Record<string, string | undefined>, platform: string): ShellFlavor {
  if (env.MSYSTEM) return "git-bash";
  const shellPath = env.SHELL?.trim();
  if (shellPath) {
    const name = shellPath.replace(/\\/g, "/").split("/").pop()?.replace(/\.exe$/i, "") ?? "";
    if (name === "bash" || name === "zsh" || name === "fish" || name === "sh" || name === "dash" || name === "ash") {
      return name === "dash" || name === "ash" ? "sh" : name;
    }
    if (name) return "unknown";
  }
  if (platform === "win32") {
    if (env.PSModulePath) return "powershell";
    if (env.COMSPEC?.toLowerCase().includes("cmd.exe")) return "cmd";
  }
  return "unknown";
}

/**
 * Windows 的 MSYS pty（Git Bash / MinTTY）会话。Bun 不像 libuv 那样识别
 * MSYS 管道名，会把 pty 上的 stdin/stdout 误判为 pipe（isTTY 为 false），
 * 需要按环境变量兜底，否则 TUI 会误以为终端不可交互。
 */
export function isMsysPtySession(env: Record<string, string | undefined>, platform: string): boolean {
  return platform === "win32" && Boolean(env.MSYSTEM);
}

export function detectCapabilities(input: CapabilityInput): TerminalCapabilities {
  const { env, platform } = input;
  const term = env.TERM ?? "";
  const dumb = term === "dumb";
  const onWindows = platform === "win32";
  const msys = isMsysPtySession(env, platform);
  const stdinIsTTY = input.stdinIsTTY || msys;
  const stdoutIsTTY = input.stdoutIsTTY || msys;

  const ansi = stdoutIsTTY && !dumb;
  const color = ansi && !(env.NO_COLOR !== undefined && env.NO_COLOR !== "");
  const interactive = ansi && stdinIsTTY && !env.CI;

  let unicode = !dumb;
  if (onWindows) {
    // Windows Terminal / ConEmu / mintty / 类 Unix 终端都能正确处理 Unicode；
    // 裸 conhost（cmd、旧版 PowerShell 窗口）退回 ASCII，避免乱码。
    const modern =
      Boolean(env.WT_SESSION) ||
      Boolean(env.TERM_PROGRAM) ||
      env.ConEmuANSI === "ON" ||
      Boolean(env.ANSICON) ||
      Boolean(env.MSYSTEM) ||
      Boolean(env.TERM) ||
      /utf-?8/i.test(env.LANG ?? "") ||
      /utf-?8/i.test(env.LC_ALL ?? "");
    unicode = unicode && modern;
  }

  return {
    interactive,
    ansi,
    color,
    unicode,
    shell: detectShellFlavor(env, platform),
    columns: Math.max(40, input.columns ?? 80),
    rows: Math.max(10, input.rows ?? 24)
  };
}

export function detectTerminalCapabilities(): TerminalCapabilities {
  return detectCapabilities({
    env: process.env,
    platform: process.platform,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    columns: process.stdout.columns,
    rows: process.stdout.rows
  });
}

const SHELL_LABELS: Record<ShellFlavor, string> = {
  bash: "Bash",
  zsh: "Zsh",
  fish: "Fish",
  sh: "POSIX Sh",
  "git-bash": "Git Bash",
  pwsh: "PowerShell 7",
  powershell: "PowerShell",
  cmd: "命令提示符",
  unknown: "未知 Shell"
};

export function shellLabel(flavor: ShellFlavor): string {
  return SHELL_LABELS[flavor];
}

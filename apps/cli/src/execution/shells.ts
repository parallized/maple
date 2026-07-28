import type { WorkerCommand } from "./adapters/types";

/**
 * Worker 启动 Shell：direct 表示不经 Shell 直接启动；其余值经对应 Shell 包装启动。
 * POSIX 系 Shell 通过 `"$@"` / `$argv` 透传参数，PowerShell 通过 -EncodedCommand，
 * 均不会对 prompt 做字符串插值，参数中的引号与换行保持原样。
 */
export const WORKER_SHELLS = ["direct", "sh", "bash", "zsh", "fish", "pwsh", "powershell", "cmd"] as const;
export type WorkerShell = (typeof WORKER_SHELLS)[number];

export function isWorkerShell(value: string): value is WorkerShell {
  return (WORKER_SHELLS as readonly string[]).includes(value);
}

function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * cmd.exe 没有统一的转义规则，这里按 CommandLineToArgvW 的约定加引号：
 * 引号前的反斜杠翻倍、内部引号以 \" 表示。对 node 系 .cmd shim 可用，
 * 但包含 %VAR% 之类内容时仍可能被 cmd 展开，属于尽力而为。
 */
function quoteCmdArg(value: string): string {
  let output = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      output += `${"\\".repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
      continue;
    }
    if (backslashes > 0) {
      output += "\\".repeat(backslashes);
      backslashes = 0;
    }
    output += char;
  }
  return `${output}${"\\".repeat(backslashes * 2)}"`;
}

export function wrapWorkerCommand(shell: WorkerShell, command: WorkerCommand): WorkerCommand {
  switch (shell) {
    case "direct":
      return command;
    case "sh":
    case "bash":
    case "zsh":
      // $0 位置占位（这里用 shell 名），其后参数进入 "$@"，不做字符串拼接。
      return {
        executable: shell,
        args: ["-c", 'exec "$@"', shell, command.executable, ...command.args],
        env: command.env,
        stdin: command.stdin
      };
    case "fish":
      // fish 没有 $0 语义，-c 之后的参数全部进入 $argv。
      return {
        executable: "fish",
        args: ["-c", "exec $argv", command.executable, ...command.args],
        env: command.env,
        stdin: command.stdin
      };
    case "pwsh":
    case "powershell": {
      const invoke = ["&", quotePowerShellArg(command.executable), ...command.args.map(quotePowerShellArg)].join(" ");
      const script = `$ErrorActionPreference='Stop'; try { ${invoke}; exit $LASTEXITCODE } catch { exit 1 }`;
      const encoded = Buffer.from(script, "utf16le").toString("base64");
      return {
        executable: shell,
        args: ["-NoProfile", "-EncodedCommand", encoded],
        env: command.env,
        stdin: command.stdin
      };
    }
    case "cmd": {
      const line = [command.executable, ...command.args].map(quoteCmdArg).join(" ");
      return {
        executable: "cmd",
        args: ["/d", "/s", "/c", `"${line}"`],
        env: command.env,
        stdin: command.stdin
      };
    }
  }
}

const SHELL_CANDIDATES: ReadonlyArray<readonly [WorkerShell, string]> = [
  ["sh", "sh"],
  ["bash", "bash"],
  ["zsh", "zsh"],
  ["fish", "fish"],
  ["pwsh", "pwsh"],
  ["powershell", "powershell"],
  ["cmd", "cmd"]
];

function bunWhich(bin: string): string | null {
  try {
    return Bun.which(bin);
  } catch {
    return null;
  }
}

/** 探测本机可用的 Shell（不含 direct），which 可注入以便测试。 */
export function detectAvailableShells(which: (bin: string) => string | null = bunWhich): WorkerShell[] {
  const found: WorkerShell[] = [];
  for (const [shell, bin] of SHELL_CANDIDATES) {
    try {
      if (which(bin)) found.push(shell);
    } catch {
      // 忽略单个 Shell 的探测失败
    }
  }
  return found;
}

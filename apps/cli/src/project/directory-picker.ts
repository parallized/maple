import { existsSync } from "node:fs";
import { join } from "node:path";

export interface PickerPlan {
  executable: string;
  args: string[];
  cancelledExitCodes: number[];
  cancelledPattern?: RegExp;
}

const WINDOWS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.ShowInTaskbar = $false
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.TopMost = $true
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 Maple 项目目录'
$dialog.ShowNewFolderButton = $false
try {
  $owner.Show()
  $owner.Activate()
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::WriteLine($dialog.SelectedPath)
  }
} finally {
  $dialog.Dispose()
  $owner.Dispose()
}
`;

export type DirectoryPicker = (signal?: AbortSignal) => Promise<string | null>;

export function directoryPickerPlans(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env
): PickerPlan[] {
  if (platform === "win32") {
    const systemPowerShell = env.SystemRoot
      ? join(env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
    return [
      {
        executable: systemPowerShell,
        args: ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SCRIPT],
        cancelledExitCodes: []
      },
      {
        executable: "powershell.exe",
        args: ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SCRIPT],
        cancelledExitCodes: []
      }
    ];
  }

  if (platform === "darwin") {
    return [
      {
        executable: "osascript",
        args: ["-e", "POSIX path of (choose folder with prompt \"选择 Maple 项目目录\")"],
        cancelledExitCodes: [1],
        cancelledPattern: /user canceled|-128/i
      }
    ];
  }

  if (platform === "linux") {
    return [
      {
        executable: "zenity",
        args: ["--file-selection", "--directory", "--title=选择 Maple 项目目录"],
        cancelledExitCodes: [1]
      },
      {
        executable: "kdialog",
        args: ["--getexistingdirectory", ".", "--title", "选择 Maple 项目目录"],
        cancelledExitCodes: [1]
      },
      {
        executable: "yad",
        args: ["--file-selection", "--directory", "--title=选择 Maple 项目目录"],
        cancelledExitCodes: [1, 252]
      }
    ];
  }

  return [];
}

function availableExecutable(executable: string): string | null {
  if (executable.includes("/") || executable.includes("\\")) return existsSync(executable) ? executable : null;
  return Bun.which(executable);
}

async function runPicker(plan: PickerPlan, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return null;
  const process = Bun.spawn([plan.executable, ...plan.args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true
  });
  const abort = () => process.kill();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const stdoutPromise = new Response(process.stdout).text();
    const stderrPromise = new Response(process.stderr).text();
    const exitCode = await process.exited;
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    if (signal?.aborted) return null;
    if (exitCode === 0) return stdout.trim() || null;
    if (plan.cancelledExitCodes.includes(exitCode) && (!plan.cancelledPattern || plan.cancelledPattern.test(stderr))) {
      return null;
    }
    throw new Error(stderr.trim() || `目录选择器退出码：${exitCode}`);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export const selectProjectDirectory: DirectoryPicker = async (signal) => {
  if (signal?.aborted) return null;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error("当前 Linux 执行端没有可用的桌面会话。");
  }

  const plans = directoryPickerPlans();
  for (const plan of plans) {
    const executable = availableExecutable(plan.executable);
    if (!executable) continue;
    return runPicker({ ...plan, executable }, signal);
  }
  throw new Error("当前系统没有可用的原生目录选择器。");
};

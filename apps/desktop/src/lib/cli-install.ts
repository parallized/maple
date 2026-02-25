import type { InstallTargetId } from "./install-targets";

export type InstallPlatform = "windows" | "macos" | "linux";

export type CliInstallOption = {
  id: string;
  titleZh: string;
  titleEn: string;
  command: string;
  noteZh?: string;
  noteEn?: string;
};

export function getCliInstallOptions(target: InstallTargetId, platform: InstallPlatform): CliInstallOption[] {
  if (target === "codex") {
    const options: CliInstallOption[] = [
      {
        id: "npm",
        titleZh: "npm 全局安装",
        titleEn: "Install with npm",
        command: "npm i -g @openai/codex",
        noteZh: platform === "windows" ? "Windows 建议在 WSL 环境中使用 Codex CLI。" : undefined,
        noteEn: platform === "windows" ? "On Windows, Codex CLI works best in WSL." : undefined,
      },
    ];
    return options;
  }

  if (target === "claude") {
    const options: CliInstallOption[] = [
      {
        id: "npm",
        titleZh: "npm 全局安装",
        titleEn: "Install with npm",
        command: "npm install -g @anthropic-ai/claude-code",
        noteZh: "安装后可运行 `claude doctor` 检查安装状态。",
        noteEn: "After install, run `claude doctor` to verify your setup.",
      },
    ];

    if (platform === "windows") {
      options.unshift({
        id: "powershell",
        titleZh: "PowerShell 一键安装",
        titleEn: "PowerShell installer",
        command: "irm https://claude.ai/install.ps1 | iex",
      });
    } else {
      options.unshift({
        id: "curl",
        titleZh: "脚本一键安装",
        titleEn: "Install script",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
      });
    }

    return options;
  }

  if (target === "iflow") {
    if (platform === "windows") {
      return [
        {
          id: "npm",
          titleZh: "npm 全局安装",
          titleEn: "Install with npm",
          command: "npm install -g @iflow-ai/iflow-cli@latest",
          noteZh: "需要 Node.js 22+。安装后运行 `iflow --version` 验证。",
          noteEn: "Requires Node.js 22+. Verify with `iflow --version`.",
        },
      ];
    }

    return [
      {
        id: "script",
        titleZh: "脚本一键安装",
        titleEn: "Install script",
        command: "bash -c \"$(curl -fsSL https://gitee.com/iflow-ai/iflow-cli/raw/main/install.sh)\"",
        noteZh: "会安装所需依赖。安装后运行 `iflow --version` 验证。",
        noteEn: "Installs required dependencies. Verify with `iflow --version`.",
      },
      {
        id: "npm",
        titleZh: "npm 全局安装（已装 Node.js 22+）",
        titleEn: "Install with npm (Node.js 22+)",
        command: "npm i -g @iflow-ai/iflow-cli@latest",
      },
    ];
  }

  return [];
}


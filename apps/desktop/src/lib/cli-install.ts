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
    const options: CliInstallOption[] = [];

    if (platform === "macos") {
      options.push({
        id: "homebrew",
        titleZh: "Homebrew 安装（推荐）",
        titleEn: "Homebrew (Recommended)",
        command: "brew install --cask codex",
        noteZh: "安装后运行 `codex --version` 验证。",
        noteEn: "After install, verify with `codex --version`.",
      });
    }

    if (platform === "linux") {
      options.push({
        id: "binary-linux",
        titleZh: "下载二进制（无需 npm）",
        titleEn: "Download binary (no npm)",
        command: [
          "curl -L https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-gnu.tar.gz -o codex.tar.gz",
          "tar -xzf codex.tar.gz",
          "sudo install -m 0755 codex /usr/local/bin/codex",
          "codex --version",
        ].join("\n"),
        noteZh: "如为 ARM 设备，请在 GitHub Releases 中选择 aarch64 的包。",
        noteEn: "On ARM devices, choose the aarch64 build from GitHub Releases.",
      });
    }

    if (platform === "windows") {
      options.push({
        id: "binary-windows",
        titleZh: "下载可执行文件（无需 npm）",
        titleEn: "Download executable (no npm)",
        command: [
          "iwr https://github.com/openai/codex/releases/latest/download/codex-x86_64-pc-windows-msvc.exe -OutFile codex.exe",
          ".\\codex.exe --version",
        ].join("\n"),
        noteZh: "Windows 支持仍在完善；如遇问题建议优先使用 WSL。",
        noteEn: "Windows support is still evolving; use WSL if you hit issues.",
      });
    }

    options.push({
      id: "npm",
      titleZh: "npm 全局安装",
      titleEn: "Install with npm",
      command: "npm i -g @openai/codex",
      noteZh: platform === "windows" ? "Windows 建议在 WSL 环境中使用 Codex CLI。" : undefined,
      noteEn: platform === "windows" ? "On Windows, Codex CLI works best in WSL." : undefined,
    });
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
          id: "bash",
          titleZh: "WSL / Git Bash 脚本安装（无需 npm）",
          titleEn: "WSL / Git Bash script (no npm)",
          command: [
            "# 在 WSL 或 Git Bash 中运行：",
            "bash -c \"$(curl -fsSL https://cloud.iflow.cn/iflow-cli/install.sh)\"",
            "iflow --version",
          ].join("\n"),
          noteZh: "如果你只使用 PowerShell，建议先安装并进入 WSL 再运行以上命令。",
          noteEn: "If you only use PowerShell, install and enter WSL first, then run the commands above.",
        },
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

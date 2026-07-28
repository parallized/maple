import type { InstallTargetId } from "./install-targets";

export type InstallPlatform = "windows" | "macos" | "linux";

export type CliInstallOption = {
  id: string;
  titleZh: string;
  titleEn: string;
  command: string;
  noteZh?: string;
  noteEn?: string;
  /** Which runtime this option targets (native/wsl). undefined = universal */
  runtime?: "native" | "wsl";
};

export function getCliInstallOptions(target: InstallTargetId, platform: InstallPlatform): CliInstallOption[] {
  if (target === "codex") {
    if (platform === "windows") {
      return [
        {
          id: "binary-windows",
          titleZh: "本机 — 下载可执行文件（推荐）",
          titleEn: "Local — Download executable (Recommended)",
          command: [
            "iwr https://github.com/openai/codex/releases/latest/download/codex-x86_64-pc-windows-msvc.exe -OutFile codex.exe",
            ".\\codex.exe --version",
          ].join("\n"),
          noteZh: "在 PowerShell 中运行。",
          noteEn: "Run in PowerShell.",
          runtime: "native",
        },
        {
          id: "npm-native",
          titleZh: "本机 — npm 全局安装",
          titleEn: "Local — Install with npm",
          command: "npm i -g @openai/codex",
          noteZh: "在 PowerShell / CMD 中运行。需要 Node.js 环境。",
          noteEn: "Run in PowerShell / CMD. Requires Node.js.",
          runtime: "native",
        },
        {
          id: "binary-wsl",
          titleZh: "WSL — 下载二进制",
          titleEn: "WSL — Download binary",
          command: [
            "curl -L https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-gnu.tar.gz -o codex.tar.gz",
            "tar -xzf codex.tar.gz",
            "sudo install -m 0755 codex /usr/local/bin/codex",
            "codex --version",
          ].join("\n"),
          noteZh: "在 WSL 终端中运行。ARM 设备请选择 aarch64 的包。",
          noteEn: "Run in WSL terminal. For ARM devices, choose the aarch64 build.",
          runtime: "wsl",
        },
        {
          id: "npm-wsl",
          titleZh: "WSL — npm 全局安装",
          titleEn: "WSL — Install with npm",
          command: "npm i -g @openai/codex",
          noteZh: "在 WSL 终端中运行。需要 Node.js 环境。",
          noteEn: "Run in WSL terminal. Requires Node.js.",
          runtime: "wsl",
        },
      ];
    }

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
        noteZh: "ARM 设备请在 GitHub Releases 中选择 aarch64 的包。",
        noteEn: "On ARM devices, choose the aarch64 build from GitHub Releases.",
      });
    }

    options.push({
      id: "npm",
      titleZh: "npm 全局安装",
      titleEn: "Install with npm",
      command: "npm i -g @openai/codex",
      noteZh: "需要 Node.js 环境。",
      noteEn: "Requires Node.js.",
    });
    return options;
  }

  if (target === "claude") {
    if (platform === "windows") {
      return [
        {
          id: "powershell",
          titleZh: "本机 — PowerShell 一键安装（推荐）",
          titleEn: "Local — PowerShell installer (Recommended)",
          command: "irm https://claude.ai/install.ps1 | iex",
          noteZh: "在 PowerShell 中运行。无需 Node.js。",
          noteEn: "Run in PowerShell. No Node.js required.",
          runtime: "native",
        },
        {
          id: "npm-native",
          titleZh: "本机 — npm 全局安装",
          titleEn: "Local — Install with npm",
          command: "npm install -g @anthropic-ai/claude-code",
          noteZh: "在 PowerShell / CMD 中运行。需要 Node.js 环境。",
          noteEn: "Run in PowerShell / CMD. Requires Node.js.",
          runtime: "native",
        },
        {
          id: "curl-wsl",
          titleZh: "WSL — 脚本安装（推荐）",
          titleEn: "WSL — Install script (Recommended)",
          command: "curl -fsSL https://claude.ai/install.sh | bash",
          noteZh: "在 WSL 终端中运行。无需 Node.js。",
          noteEn: "Run in WSL terminal. No Node.js required.",
          runtime: "wsl",
        },
        {
          id: "npm-wsl",
          titleZh: "WSL — npm 全局安装",
          titleEn: "WSL — Install with npm",
          command: "npm install -g @anthropic-ai/claude-code",
          noteZh: "在 WSL 终端中运行。需要 Node.js 环境。",
          noteEn: "Run in WSL terminal. Requires Node.js.",
          runtime: "wsl",
        },
      ];
    }

    return [
      {
        id: "curl",
        titleZh: "脚本一键安装（推荐）",
        titleEn: "Install script (Recommended)",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
        noteZh: "无需 Node.js。安装后运行 `claude doctor` 检查。",
        noteEn: "No Node.js required. After install, run `claude doctor` to verify.",
      },
      {
        id: "npm",
        titleZh: "npm 全局安装",
        titleEn: "Install with npm",
        command: "npm install -g @anthropic-ai/claude-code",
        noteZh: "需要 Node.js 环境。安装后运行 `claude doctor` 检查。",
        noteEn: "Requires Node.js. After install, run `claude doctor` to verify.",
      },
    ];
  }

  if (target === "iflow") {
    if (platform === "windows") {
      return [
        {
          id: "npm",
          titleZh: "本机 — npm 全局安装（推荐）",
          titleEn: "Local — Install with npm (Recommended)",
          command: "npm install -g @iflow-ai/iflow-cli@latest",
          noteZh: "在 PowerShell / CMD 中运行。需要 Node.js 22+。",
          noteEn: "Run in PowerShell / CMD. Requires Node.js 22+.",
          runtime: "native",
        },
        {
          id: "bash",
          titleZh: "WSL / Git Bash — 脚本安装（无需 npm）",
          titleEn: "WSL / Git Bash — Install script (no npm)",
          command: [
            "# 在 WSL 或 Git Bash 中运行（不支持 PowerShell）：",
            "bash -c \"$(curl -fsSL https://cloud.iflow.cn/iflow-cli/install.sh)\"",
            "iflow --version",
          ].join("\n"),
          noteZh: "仅适用于 WSL 或 Git Bash，不支持 PowerShell。",
          noteEn: "Only works in WSL or Git Bash; not for PowerShell.",
          runtime: "wsl",
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

  if (target === "opencode") {
    if (platform === "windows") {
      return [
        {
          id: "npm-native",
          titleZh: "本机 - npm 全局安装（推荐）",
          titleEn: "Local - Install with npm (Recommended)",
          command: [
            "npm install -g opencode-ai",
            "opencode --version",
          ].join("\n"),
          noteZh: "在 PowerShell / CMD 中运行。需要 Node.js 环境。",
          noteEn: "Run in PowerShell / CMD. Requires Node.js.",
          runtime: "native",
        },
        {
          id: "npm-wsl",
          titleZh: "WSL - npm 全局安装",
          titleEn: "WSL - Install with npm",
          command: [
            "npm install -g opencode-ai",
            "opencode --version",
          ].join("\n"),
          noteZh: "在 WSL 终端中运行。需要 Node.js 环境。",
          noteEn: "Run in WSL terminal. Requires Node.js.",
          runtime: "wsl",
        },
      ];
    }

    return [
      {
        id: "curl",
        titleZh: "curl 一键安装（推荐）",
        titleEn: "Install with curl (Recommended)",
        command: [
          "curl -fsSL https://opencode.ai/install | bash",
          "opencode --version",
        ].join("\n"),
        noteZh: "安装完成后如命令未生效，请重新打开终端或刷新 PATH。",
        noteEn: "If the command is not found after install, restart your shell or refresh PATH.",
      },
      {
        id: "npm",
        titleZh: "npm 全局安装",
        titleEn: "Install with npm",
        command: [
          "npm install -g opencode-ai",
          "opencode --version",
        ].join("\n"),
        noteZh: "需要 Node.js 环境。",
        noteEn: "Requires Node.js.",
      },
    ];
  }

  if (target === "gemini") {
    if (platform === "windows") {
      return [
        {
          id: "npm-native",
          titleZh: "本机 - npm 全局安装（推荐）",
          titleEn: "Local - Install with npm (Recommended)",
          command: [
            "npm install -g @google/gemini-cli",
            "gemini --version",
          ].join("\n"),
          noteZh: "在 PowerShell / CMD 中运行。需要 Node.js 环境。",
          noteEn: "Run in PowerShell / CMD. Requires Node.js.",
          runtime: "native",
        },
        {
          id: "npm-wsl",
          titleZh: "WSL - npm 全局安装",
          titleEn: "WSL - Install with npm",
          command: [
            "npm install -g @google/gemini-cli",
            "gemini --version",
          ].join("\n"),
          noteZh: "在 WSL 终端中运行。需要 Node.js 环境。",
          noteEn: "Run in WSL terminal. Requires Node.js.",
          runtime: "wsl",
        },
      ];
    }

    return [
      {
        id: "npm",
        titleZh: "npm 全局安装（推荐）",
        titleEn: "Install with npm (Recommended)",
        command: [
          "npm install -g @google/gemini-cli",
          "gemini --version",
        ].join("\n"),
        noteZh: "需要 Node.js 环境。",
        noteEn: "Requires Node.js.",
      },
    ];
  }

  return [];
}

/** Node.js installation guidance per platform/runtime */
export function getNodeInstallHint(platform: InstallPlatform, runtime?: "native" | "wsl"): { zh: string; en: string } {
  if (platform === "windows" && runtime === "wsl") {
    return {
      zh: "WSL 中未检测到 Node.js。可运行：curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs",
      en: "Node.js not found in WSL. Run: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs",
    };
  }
  if (platform === "windows") {
    return {
      zh: "未检测到 Node.js。请访问 https://nodejs.org 下载安装，或在 PowerShell 中运行：winget install OpenJS.NodeJS.LTS",
      en: "Node.js not found. Visit https://nodejs.org to install, or run in PowerShell: winget install OpenJS.NodeJS.LTS",
    };
  }
  if (platform === "macos") {
    return {
      zh: "未检测到 Node.js。可运行：brew install node 或访问 https://nodejs.org",
      en: "Node.js not found. Run: brew install node or visit https://nodejs.org",
    };
  }
  return {
    zh: "未检测到 Node.js。请访问 https://nodejs.org 或使用系统包管理器安装。",
    en: "Node.js not found. Visit https://nodejs.org or install via your package manager.",
  };
}

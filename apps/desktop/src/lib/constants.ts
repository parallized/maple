import type { McpServerConfig, WorkerConfig, WorkerKind } from "../domain";

export const STORAGE_PROJECTS = "maple.desktop.projects";
export const STORAGE_MCP_CONFIG = "maple.desktop.mcp-config";
export const STORAGE_THEME = "maple.desktop.theme";
export const STORAGE_UI_LANGUAGE = "maple.desktop.ui-language";
export const STORAGE_AI_LANGUAGE = "maple.desktop.ai-language";
export const STORAGE_EDITOR_APP = "maple.desktop.editor-app";
export const STORAGE_WORKER_RETRY_INTERVAL_SECONDS = "maple.desktop.worker-retry-interval-seconds";
export const STORAGE_WORKER_RETRY_MAX_ATTEMPTS = "maple.desktop.worker-retry-max-attempts";
export const STORAGE_CONSTITUTION = "maple.desktop.constitution";
export const STORAGE_CODEX_USAGE_CONFIG = "maple.desktop.codex-usage-config";

export type ThemeMode = "system" | "light" | "dark";
export type UiLanguage = "zh" | "en";
export type AiLanguage = "follow_ui" | UiLanguage;

export type ExternalEditorApp =
  | "vscode"
  | "github_desktop"
  | "cursor"
  | "windsurf"
  | "visual_studio";

export type ExternalEditorOption = {
  value: ExternalEditorApp;
  label: string;
  icon: string;
};

export const EXTERNAL_EDITOR_OPTIONS: ExternalEditorOption[] = [
  { value: "vscode", label: "VS Code", icon: "mingcute:vscode-line" },
  { value: "cursor", label: "Cursor", icon: "mingcute:cursor-3-line" },
  { value: "windsurf", label: "Windsurf", icon: "mingcute:wind-line" },
  { value: "visual_studio", label: "Visual Studio", icon: "mingcute:windows-line" },
  { value: "github_desktop", label: "GitHub Desktop", icon: "mingcute:github-line" },
];

export const EXTERNAL_EDITOR_META: Record<ExternalEditorApp, { label: string; icon: string }> = {
  vscode: { label: "VS Code", icon: "mingcute:vscode-line" },
  cursor: { label: "Cursor", icon: "mingcute:cursor-3-line" },
  windsurf: { label: "Windsurf", icon: "mingcute:wind-line" },
  visual_studio: { label: "Visual Studio", icon: "mingcute:windows-line" },
  github_desktop: { label: "GitHub Desktop", icon: "mingcute:github-line" },
};

export type WorkerRetryConfig = {
  intervalSeconds: number;
  maxAttempts: number;
};

export const DEFAULT_EXTERNAL_EDITOR_APP: ExternalEditorApp = "vscode";
export const DEFAULT_WORKER_RETRY_CONFIG: WorkerRetryConfig = {
  intervalSeconds: 10,
  maxAttempts: 5,
};

export const WORKER_KINDS: {
  kind: WorkerKind;
  label: string;
  color: string;
}[] = [
  { kind: "claude", label: "Claude", color: "#d97757" },
  { kind: "codex", label: "Codex", color: "#ffffff" },
  { kind: "iflow", label: "iFlow", color: "#a855f7" },
  { kind: "gemini", label: "Gemini", color: "#60a5fa" },
  { kind: "opencode", label: "OpenCode", color: "#34d399" },
];

export const DEFAULT_WORKER_CONFIGS: Record<WorkerKind, WorkerConfig> = {
  claude: {
    executable: "claude",
    runArgs: "--print --dangerously-skip-permissions --verbose --output-format stream-json",
    consoleArgs: "",
    probeArgs: "--version",
    dangerMode: false,
  },
  codex: {
    executable: "codex",
    runArgs: "e --yolo --json",
    consoleArgs: "",
    probeArgs: "--version",
    dangerMode: false,
  },
  iflow: {
    executable: "iflow",
    runArgs: "-p --yolo --stream --debug",
    consoleArgs: "",
    probeArgs: "--version",
    dangerMode: false,
  },
  gemini: {
    executable: "gemini",
    runArgs: "-p",
    consoleArgs: "",
    probeArgs: "--version",
    dangerMode: false,
  },
  opencode: {
    executable: "opencode",
    runArgs: "run --format default",
    consoleArgs: "",
    probeArgs: "--version",
    dangerMode: false,
  },
};

export const DEFAULT_MCP_CONFIG: McpServerConfig = {
  executable: "",
  args: "",
  cwd: "",
  autoStart: true,
};

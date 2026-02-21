import type { McpServerConfig, WorkerConfig, WorkerKind } from "../domain";

export const STORAGE_PROJECTS = "maple.desktop.projects";
export const STORAGE_MCP_CONFIG = "maple.desktop.mcp-config";
export const STORAGE_THEME = "maple.desktop.theme";
export const STORAGE_UI_LANGUAGE = "maple.desktop.ui-language";
export const STORAGE_AI_LANGUAGE = "maple.desktop.ai-language";

export type ThemeMode = "system" | "light" | "dark";
export type UiLanguage = "zh" | "en";
export type AiLanguage = "follow_ui" | UiLanguage;

export const WORKER_KINDS: { kind: WorkerKind; label: string }[] = [
  { kind: "claude", label: "Claude" },
  { kind: "codex", label: "Codex" },
  { kind: "iflow", label: "iFlow" },
];

export const DEFAULT_WORKER_CONFIGS: Record<WorkerKind, WorkerConfig> = {
  claude: {
    executable: "claude",
    runArgs: "maple --verbose --dangerously-skip-permissions",
    consoleArgs: "",
    probeArgs: "--version",
    dangerMode: false,
  },
  codex: {
    executable: "codex",
    runArgs: "maple --yolo",
    consoleArgs: "",
    probeArgs: "--version",
    dangerMode: false,
  },
  iflow: {
    executable: "iflow",
    runArgs: "maple --yolo --thinking --debug",
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

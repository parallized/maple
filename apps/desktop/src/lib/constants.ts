import type { McpServerConfig, WorkerConfig, WorkerKind } from "../domain";

export const STORAGE_PROJECTS = "maple.desktop.projects";
export const STORAGE_WORKER_CONFIGS = "maple.desktop.worker-configs";
export const STORAGE_MCP_CONFIG = "maple.desktop.mcp-config";
export const STORAGE_THEME = "maple.desktop.theme";

export type ThemeMode = "system" | "light" | "dark";

export const WORKER_KINDS: { kind: WorkerKind; label: string }[] = [
  { kind: "claude", label: "Claude" },
  { kind: "codex", label: "Codex" },
  { kind: "iflow", label: "iFlow" }
];

export const DEFAULT_WORKER_CONFIGS: Record<WorkerKind, WorkerConfig> = {
  claude: { executable: "claude", runArgs: "-p", consoleArgs: "", probeArgs: "--version", dangerMode: false },
  codex: { executable: "codex", runArgs: "exec", consoleArgs: "", probeArgs: "--version", dangerMode: false },
  iflow: { executable: "iflow", runArgs: "-p", consoleArgs: "", probeArgs: "--version", dangerMode: false }
};

export const DEFAULT_MCP_CONFIG: McpServerConfig = {
  executable: "",
  args: "",
  cwd: "",
  autoStart: true
};

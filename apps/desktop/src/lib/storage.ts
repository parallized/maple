import type { McpServerConfig, Project, WorkerConfig, WorkerKind } from "../domain";
import type { ThemeMode } from "./constants";
import { DEFAULT_MCP_CONFIG, DEFAULT_WORKER_CONFIGS, STORAGE_MCP_CONFIG, STORAGE_PROJECTS, STORAGE_THEME, STORAGE_WORKER_CONFIGS } from "./constants";
import { normalizeProjects } from "./utils";

const INITIAL_PROJECTS: Project[] = [];

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_PROJECTS);
    if (!raw) {
      return normalizeProjects(INITIAL_PROJECTS);
    }
    const parsed = JSON.parse(raw) as Project[];
    if (!Array.isArray(parsed)) {
      return normalizeProjects(INITIAL_PROJECTS);
    }
    return normalizeProjects(parsed);
  } catch {
    return normalizeProjects(INITIAL_PROJECTS);
  }
}

export function loadWorkerConfigs(): Record<WorkerKind, WorkerConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_WORKER_CONFIGS);
    if (!raw) {
      return DEFAULT_WORKER_CONFIGS;
    }
    const parsed = JSON.parse(raw) as Record<WorkerKind, WorkerConfig>;
    return {
      claude: parsed.claude ?? DEFAULT_WORKER_CONFIGS.claude,
      codex: parsed.codex ?? DEFAULT_WORKER_CONFIGS.codex,
      iflow: parsed.iflow ?? DEFAULT_WORKER_CONFIGS.iflow
    };
  } catch {
    return DEFAULT_WORKER_CONFIGS;
  }
}

export function loadMcpServerConfig(): McpServerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_MCP_CONFIG);
    if (!raw) {
      return DEFAULT_MCP_CONFIG;
    }
    const parsed = JSON.parse(raw) as Partial<McpServerConfig>;
    return {
      executable: parsed.executable ?? DEFAULT_MCP_CONFIG.executable,
      args: parsed.args ?? DEFAULT_MCP_CONFIG.args,
      cwd: parsed.cwd ?? DEFAULT_MCP_CONFIG.cwd,
      autoStart: parsed.autoStart ?? DEFAULT_MCP_CONFIG.autoStart
    };
  } catch {
    return DEFAULT_MCP_CONFIG;
  }
}

export function loadTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_THEME);
    if (raw === "light" || raw === "dark") return raw;
    return "system";
  } catch {
    return "system";
  }
}

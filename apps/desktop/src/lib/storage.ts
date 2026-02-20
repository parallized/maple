import type { McpServerConfig, Project } from "../domain";
import type { ThemeMode } from "./constants";
import { DEFAULT_MCP_CONFIG, STORAGE_MCP_CONFIG, STORAGE_PROJECTS, STORAGE_THEME } from "./constants";
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

export function loadMcpServerConfig(): McpServerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_MCP_CONFIG);
    if (!raw) {
      return DEFAULT_MCP_CONFIG;
    }
    const parsed = JSON.parse(raw) as Partial<McpServerConfig>;
    const executable = (parsed.executable ?? DEFAULT_MCP_CONFIG.executable).trim();
    const args = parsed.args ?? DEFAULT_MCP_CONFIG.args;
    const isLegacyFilesystemBootstrap =
      executable === "npx" && args.includes("@modelcontextprotocol/server-filesystem");
    return {
      executable: isLegacyFilesystemBootstrap ? "" : executable,
      args: isLegacyFilesystemBootstrap ? "" : args,
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

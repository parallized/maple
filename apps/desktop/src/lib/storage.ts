import type { McpServerConfig, Project } from "../domain";
import type { AiLanguage, ExternalEditorApp, ThemeMode, UiLanguage } from "./constants";
import {
  DEFAULT_EXTERNAL_EDITOR_APP,
  DEFAULT_MCP_CONFIG,
  STORAGE_AI_LANGUAGE,
  STORAGE_EDITOR_APP,
  STORAGE_MCP_CONFIG,
  STORAGE_PROJECTS,
  STORAGE_THEME,
  STORAGE_UI_LANGUAGE
} from "./constants";
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

export function loadUiLanguage(): UiLanguage {
  try {
    const raw = localStorage.getItem(STORAGE_UI_LANGUAGE);
    if (raw === "en") return "en";
    return "zh";
  } catch {
    return "zh";
  }
}

export function loadAiLanguage(): AiLanguage {
  try {
    const raw = localStorage.getItem(STORAGE_AI_LANGUAGE);
    if (raw === "en") return "en";
    if (raw === "zh") return "zh";
    return "follow_ui";
  } catch {
    return "follow_ui";
  }
}

export function loadExternalEditorApp(): ExternalEditorApp {
  try {
    const raw = localStorage.getItem(STORAGE_EDITOR_APP);
    switch (raw) {
      case "vscode":
      case "github_desktop":
      case "cursor":
      case "windsurf":
      case "visual_studio":
        return raw;
      default:
        return DEFAULT_EXTERNAL_EDITOR_APP;
    }
  } catch {
    return DEFAULT_EXTERNAL_EDITOR_APP;
  }
}

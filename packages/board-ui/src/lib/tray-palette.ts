import type { TrayTaskPalette } from "./task-tray";

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function buildTrayTaskPalette(): TrayTaskPalette {
  const info = readCssVar("--color-info", "#2f6fb3");
  const success = readCssVar("--color-success", "#4da872");
  const warning = readCssVar("--color-warning", "#e3b341");
  const error = readCssVar("--color-error", "#d47049");
  const secondary = readCssVar("--color-secondary", "#6b7280");

  return {
    inProgress: info,
    queued: secondary,
    todo: secondary,
    blocked: error,
    done: success,
    attention: warning,
  };
}

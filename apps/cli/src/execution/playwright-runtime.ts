import { homedir } from "node:os";
import { join } from "node:path";
import { resolveExecutablePath, type ExecutableResolver } from "./executable";

export function defaultPlaywrightRuntimeDirectory(): string {
  return join(
    homedir(),
    ".maple",
    "runtime",
    "playwright"
  );
}

export function defaultPlaywrightBrowserDirectory(): string {
  return join(defaultPlaywrightRuntimeDirectory(), "browsers");
}

export function defaultPlaywrightExecutable(): string {
  return join(
    defaultPlaywrightRuntimeDirectory(),
    process.platform === "win32" ? "maple-playwright.cmd" : "maple-playwright"
  );
}

export function resolvePlaywrightExecutable(
  env: Record<string, string | undefined> = process.env,
  resolver?: ExecutableResolver,
  managedExecutable = defaultPlaywrightExecutable()
): string | null {
  const configured = env.MAPLE_PLAYWRIGHT_BIN?.trim();
  if (configured) return resolveExecutablePath(configured, resolver);
  return resolveExecutablePath(managedExecutable, resolver);
}

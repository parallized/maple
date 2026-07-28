import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defaultPlaywrightBrowserDirectory,
  defaultPlaywrightExecutable,
  defaultPlaywrightRuntimeDirectory,
  resolvePlaywrightExecutable
} from "../src/execution/playwright-runtime";

describe("Playwright runtime", () => {
  it("prefers an explicit executable override", () => {
    const resolved = resolvePlaywrightExecutable(
      { MAPLE_PLAYWRIGHT_BIN: "custom-playwright" },
      (command) => command === "custom-playwright" ? "/tools/custom-playwright" : null
    );
    expect(resolved).toBe("/tools/custom-playwright");
  });

  it("falls back to Maple's user-scoped runtime", () => {
    const runtime = defaultPlaywrightExecutable();
    const resolved = resolvePlaywrightExecutable({}, (command) => command === runtime ? runtime : null);
    expect(resolved).toBe(runtime);
    expect(runtime).toContain(".maple");
    expect(runtime).toContain("playwright");
  });

  it("keeps the browser cache inside Maple's managed runtime", () => {
    expect(defaultPlaywrightBrowserDirectory()).toBe(
      `${defaultPlaywrightRuntimeDirectory()}${process.platform === "win32" ? "\\" : "/"}browsers`
    );
  });

  it("ignores a global executable unless it is explicitly configured", () => {
    const runtime = defaultPlaywrightExecutable();
    const missingRuntime = join(tmpdir(), "missing-maple-playwright", "maple-playwright");
    const resolved = resolvePlaywrightExecutable({}, (command) => {
      if (command === "playwright") return "/global/playwright";
      return null;
    }, missingRuntime);
    expect(resolved).toBeNull();
    expect(runtime).toContain("maple-playwright");
  });

  it("reports a missing runtime instead of guessing", () => {
    const missingRuntime = join(tmpdir(), "missing-maple-playwright", "maple-playwright");
    expect(resolvePlaywrightExecutable({}, () => null, missingRuntime)).toBeNull();
  });
});

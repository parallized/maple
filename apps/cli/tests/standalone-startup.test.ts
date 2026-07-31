import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createLocalDevelopmentPlan } from "../scripts/local-development";
import {
  parseStandaloneAllowedOrigins,
  resolveStandalonePort
} from "../src/standalone/layout";
import {
  isStandaloneDevelopmentCommand,
  parseStandaloneArgs,
  shouldOpenStandaloneBrowser
} from "../src/standalone/startup";

describe("Maple Local startup", () => {
  it("starts directly when bun local receives no arguments", () => {
    const args = parseStandaloneArgs([]);

    expect(args.command).toBe("tui");
  });

  it("shows help only when the user explicitly asks for it", () => {
    expect(parseStandaloneArgs(["help"]).command).toBe("help");
    expect(parseStandaloneArgs(["--help"]).command).toBe("--help");
  });

  it("enables development reload only for long-running Local commands", () => {
    expect(isStandaloneDevelopmentCommand([])).toBe(true);
    expect(isStandaloneDevelopmentCommand(["tui"])).toBe(true);
    expect(isStandaloneDevelopmentCommand(["connect"])).toBe(true);
    expect(isStandaloneDevelopmentCommand(["status"])).toBe(false);
    expect(isStandaloneDevelopmentCommand(["project", "list"])).toBe(false);
    expect(isStandaloneDevelopmentCommand(["mcp"])).toBe(false);
    expect(isStandaloneDevelopmentCommand(["help"])).toBe(false);
  });

  it("lets the development supervisor suppress browser tabs across watched restarts", () => {
    expect(shouldOpenStandaloneBrowser({})).toBe(true);
    expect(shouldOpenStandaloneBrowser({ MAPLE_STANDALONE_OPEN_BROWSER: "1" })).toBe(true);
    expect(shouldOpenStandaloneBrowser({ MAPLE_STANDALONE_OPEN_BROWSER: "0" })).toBe(false);
  });

  it("plans Vite HMR and Bun watch with visible child output", () => {
    const plan = createLocalDevelopmentPlan({
      workspaceRoot: "C:/maple",
      webRoot: "C:/maple/apps/web",
      standaloneEntry: "C:/maple/apps/cli/src/standalone/index.ts",
      forwardedArgs: ["connect", "--port", "45999"],
      env: { MAPLE_STANDALONE_ALLOWED_ORIGINS: "http://localhost:4173" },
      bunExecutable: "bun"
    });

    expect(plan.webUrl).toBe("http://127.0.0.1:5173");
    expect(plan.serverUrl).toBe("http://127.0.0.1:45999");
    expect(plan.ports).toEqual([5_173, 45_999]);
    expect(plan.openBrowser).toBe(true);
    expect(plan.prepareWeb.command).toEqual([
      "bun",
      join("C:/maple/apps/web", "scripts", "generate-icon-subset.ts")
    ]);
    expect(plan.prepareWeb.stdout).toBe("inherit");
    expect(plan.prepareWeb.stderr).toBe("inherit");
    expect(plan.web.command).toEqual([
      "bun",
      "--bun",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort"
    ]);
    expect(plan.web.env.MAPLE_SERVER_PROXY).toBe(plan.serverUrl);
    expect(plan.web.stdin).toBe("ignore");
    expect(plan.web.stdout).toBe("inherit");
    expect(plan.web.stderr).toBe("inherit");
    expect(plan.standalone.command).toEqual([
      "bun",
      "--watch",
      "--no-clear-screen",
      "C:/maple/apps/cli/src/standalone/index.ts",
      "connect",
      "--port",
      "45999"
    ]);
    expect(plan.standalone.env.MAPLE_STANDALONE_WEB_ROOT).toBe("C:/maple/apps/web");
    expect(plan.standalone.env.MAPLE_STANDALONE_OPEN_BROWSER).toBe("0");
    expect(plan.standalone.env.MAPLE_STANDALONE_ALLOWED_ORIGINS)
      .toBe("http://localhost:4173,http://127.0.0.1:5173");
    expect(plan.standalone.stdin).toBe("inherit");
    expect(plan.standalone.stdout).toBe("inherit");
    expect(plan.standalone.stderr).toBe("inherit");

    expect(createLocalDevelopmentPlan({
      workspaceRoot: "C:/maple",
      webRoot: "C:/maple/apps/web",
      standaloneEntry: "C:/maple/apps/cli/src/standalone/index.ts",
      forwardedArgs: [],
      env: { MAPLE_STANDALONE_OPEN_BROWSER: "0" },
      bunExecutable: "bun"
    }).openBrowser).toBe(false);
  });

  it("accepts only explicit loopback origins for the development dashboard", () => {
    expect(parseStandaloneAllowedOrigins(undefined)).toEqual([]);
    expect(parseStandaloneAllowedOrigins(
      "http://127.0.0.1:5173/, http://localhost:5173,http://127.0.0.1:5173"
    )).toEqual(["http://127.0.0.1:5173", "http://localhost:5173"]);
    expect(() => parseStandaloneAllowedOrigins("https://example.com"))
      .toThrow("本机 HTTP(S) Origin");
    expect(() => parseStandaloneAllowedOrigins("http://127.0.0.1:5173/path"))
      .toThrow("本机 HTTP(S) Origin");
  });

  it("resolves the watched Standalone port from explicit configuration", () => {
    expect(resolveStandalonePort(undefined)).toBe(45_821);
    expect(resolveStandalonePort("45999")).toBe(45_999);
    expect(() => resolveStandalonePort("70000")).toThrow("1 到 65535");
  });
});

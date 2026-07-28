import { describe, expect, it } from "bun:test";
import { parseCliArgs } from "../src/args";
import { requiresProjectRebinding, requiresRunnerAuthorization } from "../src/commands";
import type { CliConfig } from "../src/config/types";
import { browserOpenCommand } from "../src/auth/device-authorization";
import { buildWorkerCommand } from "../src/execution/worker-command";
import { MAIN_MENU_OPTIONS } from "../src/tui/app";

function connectedConfig(workspaceId?: string): CliConfig {
  return {
    version: 1,
    serverUrl: "https://maple.example.com",
    runner: {
      id: "runner-1",
      token: "runner-token",
      name: "Maple CLI",
      workspaceId
    },
    projects: []
  };
}

describe("Maple CLI core", () => {
  it("parses the browser authorization connection flow", () => {
    const args = parseCliArgs([
      "connect",
      "--server",
      "https://maple.example.com",
      "--project",
      ".",
      "--concurrency=2"
    ]);
    expect(args.command).toBe("connect");
    expect(args.options.server).toBe("https://maple.example.com");
    expect(args.options.project).toBe(".");
    expect(args.options.concurrency).toBe("2");
  });

  it("uses sandboxed Codex in non-Git projects and sends the prompt through stdin", () => {
    const command = buildWorkerCommand("codex", "Implement the Todo");
    expect(command.executable).toBe("codex");
    expect(command.args).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--json",
      "-"
    ]);
    expect(command.stdin).toBe("Implement the Todo");
  });

  it("reauthorizes credentials created before workspace-bound CLI authorization", () => {
    const legacy = connectedConfig();
    expect(requiresRunnerAuthorization(legacy, legacy.serverUrl)).toBe(true);
    expect(requiresProjectRebinding(legacy, legacy.serverUrl, "workspace-1")).toBe(true);

    const current = connectedConfig("workspace-1");
    expect(requiresRunnerAuthorization(current, current.serverUrl)).toBe(false);
    expect(requiresProjectRebinding(current, current.serverUrl, "workspace-1")).toBe(false);
    expect(requiresProjectRebinding(current, current.serverUrl, "workspace-2")).toBe(true);
  });

  it("opens authorization URLs through the Windows URL protocol handler", () => {
    const url = "https://maple.example.com/authorize?code=ABCD-EFGH";
    expect(browserOpenCommand(url, "win32")).toEqual([
      "rundll32.exe",
      "url.dll,FileProtocolHandler",
      url
    ]);
  });

  it("places workspace unbinding immediately above status details", () => {
    const labels = MAIN_MENU_OPTIONS.map((option) => option.label);
    expect(labels.indexOf("解除绑定")).toBe(labels.indexOf("状态详情") - 1);
  });
});

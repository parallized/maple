import { describe, expect, it } from "bun:test";
import type { RunLogEntry } from "@maple/protocol";
import { getCodingAgentAdapter } from "../src/execution/adapters/registry";
import {
  applySandboxLevel,
  initialSandboxLevel,
  nextSandboxLevel,
  sandboxElevationLadder,
  sandboxLevelLabel
} from "../src/execution/sandbox-elevation";
import { detectPermissionBlock } from "../src/execution/permission-blocker";
import { executeWorker } from "../src/execution/process-executor";
import { buildWorkerCommand } from "../src/execution/worker-command";
import { workerAutoElevateFromEnv } from "../src/runner/runner-loop";

const PROMPT = "deploy to production";

describe("sandbox elevation ladder", () => {
  it("maps explicit configuration to the initial level", () => {
    expect(initialSandboxLevel({})).toBe("workspace-write");
    expect(initialSandboxLevel({ fullAccess: true })).toBe("danger-full-access");
    expect(initialSandboxLevel({ readOnly: true })).toBe("read-only");
    expect(initialSandboxLevel({ windowsSandboxBypass: true })).toBe("sandbox-bypass");
  });

  it("climbs workspace-write to the top and stops at the highest level", () => {
    expect(sandboxElevationLadder({})).toEqual([
      "workspace-write",
      "danger-full-access",
      "sandbox-bypass"
    ]);
    expect(sandboxElevationLadder({ fullAccess: true })).toEqual([
      "danger-full-access",
      "sandbox-bypass"
    ]);
    expect(sandboxElevationLadder({ windowsSandboxBypass: true })).toEqual(["sandbox-bypass"]);
    expect(sandboxElevationLadder({ readOnly: true })).toEqual(["read-only"]);
  });

  it("provides the next level and stops at read-only and sandbox-bypass", () => {
    expect(nextSandboxLevel("workspace-write")).toBe("danger-full-access");
    expect(nextSandboxLevel("danger-full-access")).toBe("sandbox-bypass");
    expect(nextSandboxLevel("sandbox-bypass")).toBeNull();
    expect(nextSandboxLevel("read-only")).toBeNull();
  });

  it("applies a level to launch options", () => {
    expect(applySandboxLevel({ fullAccess: true }, "workspace-write"))
      .toEqual({ fullAccess: false, readOnly: false, bypassSandbox: false });
    expect(applySandboxLevel({}, "danger-full-access"))
      .toEqual({ fullAccess: true, readOnly: false, bypassSandbox: false });
    expect(applySandboxLevel({ fullAccess: true }, "sandbox-bypass"))
      .toEqual({ fullAccess: true, readOnly: false, bypassSandbox: true });
    expect(applySandboxLevel({ fullAccess: true }, "read-only"))
      .toEqual({ fullAccess: false, readOnly: true, bypassSandbox: false });
  });

  it("labels levels for the user", () => {
    expect(sandboxLevelLabel("workspace-write")).toBe("工作区可写");
    expect(sandboxLevelLabel("danger-full-access")).toBe("完全放行");
    expect(sandboxLevelLabel("sandbox-bypass")).toBe("绕过沙箱");
    expect(sandboxLevelLabel("read-only")).toBe("只读");
  });
});

describe("permission block classification", () => {
  it("classifies a network policy block as network", () => {
    expect(detectPermissionBlock({
      operationalOutput:
        "ssh: connect to host 103.242.14.47 port 22: Operation not permitted\n"
        + "curl: (7) Failed to connect to 127.0.0.1:7897: Operation not permitted",
      assistantOutput: "所有外部 TCP 连接均失败，本地代理也无法连接，未能写入改动。"
    })).toEqual({
      kind: "network",
      message: expect.stringContaining("出网被沙箱或权限策略拦截")
    });
  });

  it("keeps workspace-write blocks as filesystem", () => {
    expect(detectPermissionBlock({
      operationalOutput: "rejected: blocked by policy",
      assistantOutput: "由于本次会话沙箱为只读，我无法实际落盘改动，只能给出补丁。"
    })).toEqual({
      kind: "filesystem",
      message: expect.stringContaining("未能把任务改动写入当前项目")
    });
  });

  it("still ignores recovered tasks and non-denial output", () => {
    expect(detectPermissionBlock({
      operationalOutput: "rejected: blocked by policy",
      assistantOutput: "最初无法写入，但随后已写入并修改完成。"
    })).toBeNull();
    expect(detectPermissionBlock({
      operationalOutput: "ssh: connect refused",
      assistantOutput: "无法连接服务器"
    })).toBeNull();
  });
});

describe("adapter sandbox capability", () => {
  it.each(["codex", "deepseek"] as const)("exposes the elevation ladder for %s", (kind) => {
    const adapter = getCodingAgentAdapter(kind);
    expect(adapter.sandboxLevels?.({})).toEqual([
      "workspace-write",
      "danger-full-access",
      "sandbox-bypass"
    ]);
    expect(adapter.sandboxLevels?.({ fullAccess: true })).toEqual([
      "danger-full-access",
      "sandbox-bypass"
    ]);
  });

  it("treats other workers as single-level without auto elevation", () => {
    expect(getCodingAgentAdapter("claude").sandboxLevels).toBeUndefined();
    expect(getCodingAgentAdapter("gemini").sandboxLevels).toBeUndefined();
    expect(getCodingAgentAdapter("kimi").sandboxLevels).toBeUndefined();
    expect(getCodingAgentAdapter("opencode").sandboxLevels).toBeUndefined();
  });

  it.each(["codex", "deepseek"] as const)(
    "adds the explicit sandbox bypass flag on %s at the top level",
    (kind) => {
      const command = buildWorkerCommand(kind, PROMPT, "direct", {}, { bypassSandbox: true });
      expect(command.args).toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(command.args).not.toContain("--sandbox");
    }
  );
});

describe("MAPLE_WORKER_AUTO_ELEVATE default", () => {
  it("is enabled by default and can be disabled explicitly", () => {
    expect(workerAutoElevateFromEnv({})).toBe(true);
    expect(workerAutoElevateFromEnv({ MAPLE_WORKER_AUTO_ELEVATE: "1" })).toBe(true);
    expect(workerAutoElevateFromEnv({ MAPLE_WORKER_AUTO_ELEVATE: "0" })).toBe(false);
    expect(workerAutoElevateFromEnv({ MAPLE_WORKER_AUTO_ELEVATE: "off" })).toBe(false);
  });
});

const BLOCKED_OUTPUT = [
  JSON.stringify({ type: "thread.started", thread_id: "blocked-session" }),
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "cmd-1",
      type: "command_execution",
      command: "ssh deploy",
      status: "failed",
      output: "ssh: connect to host 103.242.14.47 port 22: Operation not permitted"
    }
  }),
  JSON.stringify({
    type: "item.completed",
    item: { id: "msg-1", type: "agent_message", text: "无法连接部署服务器，未能写入改动" }
  }),
  JSON.stringify({ type: "turn.completed" })
].join("\n") + "\n";

const OK_OUTPUT = [
  JSON.stringify({ type: "thread.started", thread_id: "ok-session" }),
  JSON.stringify({
    type: "item.completed",
    item: { id: "msg-1", type: "agent_message", text: "已完成部署" }
  }),
  JSON.stringify({ type: "turn.completed" })
].join("\n") + "\n";

function spawnWith(output: string) {
  return () => Bun.spawn([
    process.execPath,
    "-e",
    `process.stdout.write(${JSON.stringify(output)});`
  ], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32"
  });
}

describe("process execution auto elevation", () => {
  it("retries once with sandbox-bypass after a network policy block and succeeds", async () => {
    const launches: string[][] = [];
    const entries: RunLogEntry[] = [];
    let attempts = 0;

    const result = await executeWorker({
      workerKind: "codex",
      cwd: import.meta.dir,
      prompt: PROMPT,
      signal: new AbortController().signal,
      fullAccess: true,
      autoElevate: true,
      windowsSandboxBypass: false,
      skipPreparation: true,
      spawnProcess: (command) => {
        launches.push(command);
        attempts += 1;
        return spawnWith(attempts === 1 ? BLOCKED_OUTPUT : OK_OUTPUT)();
      },
      onLog: async (entry) => {
        entries.push(entry);
      }
    });

    expect(launches).toHaveLength(2);
    expect(launches[0].join(" ")).toContain("--sandbox danger-full-access");
    expect(launches[0].join(" ")).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(launches[1].join(" ")).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(entries.some((entry) => entry.title === "Worker 沙箱自动提权")).toBe(true);
    expect(entries.some((entry) => entry.content.includes("「完全放行」提权到「绕过沙箱」"))).toBe(true);
  });

  it("keeps the block classification when the elevated retry is still blocked", async () => {
    const launches: string[][] = [];
    const result = await executeWorker({
      workerKind: "codex",
      cwd: import.meta.dir,
      prompt: PROMPT,
      signal: new AbortController().signal,
      fullAccess: true,
      autoElevate: true,
      windowsSandboxBypass: false,
      skipPreparation: true,
      spawnProcess: (command) => {
        launches.push(command);
        return spawnWith(BLOCKED_OUTPUT)();
      },
      onLog: async () => undefined
    });

    expect(launches).toHaveLength(2);
    expect(result.success).toBe(false);
    expect(result.permissionBlock?.kind).toBe("network");
    expect(result.error).toContain("出网被沙箱或权限策略拦截");
  });

  it("does not elevate when auto elevation is disabled", async () => {
    const launches: string[][] = [];
    const result = await executeWorker({
      workerKind: "codex",
      cwd: import.meta.dir,
      prompt: PROMPT,
      signal: new AbortController().signal,
      fullAccess: true,
      autoElevate: false,
      windowsSandboxBypass: false,
      skipPreparation: true,
      spawnProcess: (command) => {
        launches.push(command);
        return spawnWith(BLOCKED_OUTPUT)();
      },
      onLog: async () => undefined
    });

    expect(launches).toHaveLength(1);
    expect(result.success).toBe(false);
    expect(result.permissionBlock?.kind).toBe("network");
  });

  it("never auto-elevates a read-only leader turn", async () => {
    const launches: string[][] = [];
    const result = await executeWorker({
      workerKind: "codex",
      cwd: import.meta.dir,
      prompt: PROMPT,
      signal: new AbortController().signal,
      readOnly: true,
      autoElevate: true,
      windowsSandboxBypass: false,
      skipPreparation: true,
      spawnProcess: (command) => {
        launches.push(command);
        return spawnWith(BLOCKED_OUTPUT)();
      },
      onLog: async () => undefined
    });

    expect(launches).toHaveLength(1);
    expect(launches[0].join(" ")).toContain("--sandbox read-only");
    expect(result.success).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSessionStore } from "../src/session/store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Agent session store", () => {
  it("persists isolated manager and Workflow sessions across CLI instances", () => {
    const root = mkdtempSync(join(tmpdir(), "maple-agent-sessions-"));
    temporaryDirectories.push(root);
    const configPath = join(root, "cli.json");
    const first = new AgentSessionStore(configPath);

    first.save({
      scope: "manager",
      scopeId: "project-1",
      workerKind: "codex",
      sessionId: "manager-session-1",
      contextFingerprint: "context-v1"
    });
    first.save({
      scope: "workflow",
      scopeId: "workflow-1",
      workerKind: "codex",
      sessionId: "worker-session-1"
    });
    first.save({
      scope: "workflow",
      scopeId: "workflow-1",
      workerKind: "kimi",
      sessionId: "kimi-session-1"
    });

    const restarted = new AgentSessionStore(configPath);
    expect(restarted.read("manager", "project-1", "codex")).toMatchObject({
      sessionId: "manager-session-1",
      contextFingerprint: "context-v1"
    });
    expect(restarted.read("workflow", "workflow-1", "codex")?.sessionId).toBe("worker-session-1");
    expect(restarted.read("workflow", "workflow-1", "kimi")?.sessionId).toBe("kimi-session-1");
    expect(restarted.read("workflow", "workflow-2", "codex")).toBeNull();
  });

  it("removes an expired Provider session without touching sibling sessions", () => {
    const root = mkdtempSync(join(tmpdir(), "maple-agent-sessions-"));
    temporaryDirectories.push(root);
    const store = new AgentSessionStore(join(root, "cli.json"));
    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "codex", sessionId: "codex-1" });
    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "kimi", sessionId: "kimi-1" });

    store.remove("workflow", "workflow-1", "codex");

    expect(store.read("workflow", "workflow-1", "codex")).toBeNull();
    expect(store.read("workflow", "workflow-1", "kimi")?.sessionId).toBe("kimi-1");
  });
});

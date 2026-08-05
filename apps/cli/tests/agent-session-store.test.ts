import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("persists and removes the usage baseline together with the session", () => {
    const root = mkdtempSync(join(tmpdir(), "maple-agent-sessions-"));
    temporaryDirectories.push(root);
    const store = new AgentSessionStore(join(root, "cli.json"));
    expect(store.readUsageBaseline("workflow", "workflow-1", "codex")).toBeNull();

    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "codex", sessionId: "codex-1" });
    expect(store.readUsageBaseline("workflow", "workflow-1", "codex")).toBeNull();

    store.saveUsageBaseline("workflow", "workflow-1", "codex", {
      inputTokens: 80,
      cachedInputTokens: 20,
      outputTokens: 10,
      reasoningOutputTokens: 2
    });
    expect(store.readUsageBaseline("workflow", "workflow-1", "codex")).toEqual({
      inputTokens: 80,
      cachedInputTokens: 20,
      outputTokens: 10,
      reasoningOutputTokens: 2
    });

    // 更新会话 ID 时基线保持不变
    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "codex", sessionId: "codex-2" });
    expect(store.readUsageBaseline("workflow", "workflow-1", "codex")?.inputTokens).toBe(80);

    store.remove("workflow", "workflow-1", "codex");
    expect(store.readUsageBaseline("workflow", "workflow-1", "codex")).toBeNull();
    expect(store.read("workflow", "workflow-1", "codex")).toBeNull();
  });

  it("treats legacy session records without usageBaseline as readable", () => {
    const root = mkdtempSync(join(tmpdir(), "maple-agent-sessions-"));
    temporaryDirectories.push(root);
    const configPath = join(root, "cli.json");
    const store = new AgentSessionStore(configPath);
    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "codex", sessionId: "codex-1" });

    // 模拟旧版本写入、没有 usageBaseline 字段的记录
    const record = store.read("workflow", "workflow-1", "codex")!;
    const legacy: Record<string, unknown> = { ...record };
    delete legacy.usageBaseline;
    expect("usageBaseline" in legacy).toBe(false);
    const path = join(store.workspace("workflow", "workflow-1"), "codex.session.json");
    writeFileSync(path, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const restarted = new AgentSessionStore(configPath);
    expect(restarted.read("workflow", "workflow-1", "codex")?.sessionId).toBe("codex-1");
    expect(restarted.readUsageBaseline("workflow", "workflow-1", "codex")).toBeNull();
  });

  it("tracks the workflow run count and preserves it across session updates", () => {
    const root = mkdtempSync(join(tmpdir(), "maple-agent-sessions-"));
    temporaryDirectories.push(root);
    const store = new AgentSessionStore(join(root, "cli.json"));

    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "codex", sessionId: "codex-1" });
    expect(store.read("workflow", "workflow-1", "codex")?.runCount ?? 0).toBe(0);

    store.incrementRunCount("workflow", "workflow-1", "codex");
    store.incrementRunCount("workflow", "workflow-1", "codex");
    expect(store.read("workflow", "workflow-1", "codex")?.runCount).toBe(2);

    // 会话 ID 更新时 runCount 保持递增，不被重置
    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "codex", sessionId: "codex-2" });
    expect(store.read("workflow", "workflow-1", "codex")?.runCount).toBe(2);
    store.incrementRunCount("workflow", "workflow-1", "codex");
    expect(store.read("workflow", "workflow-1", "codex")?.runCount).toBe(3);

    // 删除会话后重新建立，从零开始
    store.remove("workflow", "workflow-1", "codex");
    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "codex", sessionId: "codex-3" });
    expect(store.read("workflow", "workflow-1", "codex")?.runCount).toBe(0);
  });

  it("treats legacy session records without runCount as readable and starts at zero", () => {
    const root = mkdtempSync(join(tmpdir(), "maple-agent-sessions-"));
    temporaryDirectories.push(root);
    const configPath = join(root, "cli.json");
    const store = new AgentSessionStore(configPath);
    store.save({ scope: "workflow", scopeId: "workflow-1", workerKind: "codex", sessionId: "codex-1" });

    // 模拟旧版本写入、没有 runCount 字段的记录
    const record = store.read("workflow", "workflow-1", "codex")!;
    const legacy: Record<string, unknown> = { ...record };
    delete legacy.runCount;
    expect("runCount" in legacy).toBe(false);
    const path = join(store.workspace("workflow", "workflow-1"), "codex.session.json");
    writeFileSync(path, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

    const restarted = new AgentSessionStore(configPath);
    expect(restarted.read("workflow", "workflow-1", "codex")?.sessionId).toBe("codex-1");
    expect(restarted.read("workflow", "workflow-1", "codex")?.runCount ?? 0).toBe(0);
    restarted.incrementRunCount("workflow", "workflow-1", "codex");
    expect(restarted.read("workflow", "workflow-1", "codex")?.runCount).toBe(1);
  });
});

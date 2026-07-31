import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeliveryOutbox,
  type OutboxTransport
} from "../src/delivery/outbox";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createOutbox(): { outbox: DeliveryOutbox; path: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "maple-outbox-"));
  temporaryDirectories.push(root);
  const path = join(root, "outbox.sqlite");
  return { outbox: new DeliveryOutbox(path, Date.now, 1), path, root };
}

function createTransport(overrides: Partial<OutboxTransport> = {}): OutboxTransport {
  return {
    startJob: async () => ({}),
    appendLogs: async () => ({}),
    uploadScreenshot: async () => ({}),
    completeJob: async () => ({}),
    completeProjectManagerJob: async () => ({}),
    blockProjectManagerJob: async () => ({}),
    ...overrides
  };
}

function register(outbox: DeliveryOutbox, attemptId: string, todoId: string): void {
  outbox.registerAttempt({
    scope: "execution",
    attemptId,
    todoId,
    leaseToken: `lease-token-${attemptId}-1234567890`,
    leaseSeconds: 45
  });
}

describe("durable Runner delivery outbox", () => {
  it("keeps ordering inside one lane while another lane continues", async () => {
    const { outbox } = createOutbox();
    register(outbox, "attempt-a", "todo-a");
    register(outbox, "attempt-b", "todo-b");
    for (const [attemptId, label] of [["attempt-a", "a"], ["attempt-b", "b"]] as const) {
      outbox.enqueueStart(attemptId);
      outbox.enqueueLog(attemptId, {
        sequence: 0,
        occurredAt: "2026-07-28T00:00:00.000Z",
        stream: "stdout",
        kind: "assistant",
        level: "info",
        content: `log-${label}`
      });
      outbox.enqueueCompletion(attemptId, { success: true, summary: `done-${label}` });
    }

    let failA = true;
    const delivered: string[] = [];
    const transport = createTransport({
      startJob: async (todoId) => {
        delivered.push(`${todoId}:start`);
        if (todoId === "todo-a" && failA) throw new Error("lane a unavailable");
      },
      appendLogs: async (todoId, input) => {
        delivered.push(`${todoId}:log:${input.logs[0]?.content}`);
      },
      completeJob: async (todoId) => {
        delivered.push(`${todoId}:complete`);
      }
    });

    const first = await outbox.flush(transport);
    expect(first.failures).toEqual([{ attemptId: "attempt-a", message: "lane a unavailable" }]);
    expect(delivered.filter((entry) => entry.startsWith("todo-a"))).toEqual(["todo-a:start"]);
    expect(delivered.filter((entry) => entry.startsWith("todo-b"))).toEqual([
      "todo-b:start",
      "todo-b:log:log-b",
      "todo-b:complete"
    ]);
    expect(outbox.hasAttempt("attempt-b")).toBe(false);
    expect(outbox.pendingMessageCount("attempt-a")).toBe(3);

    failA = false;
    await outbox.applyReconciliation([{ attemptId: "attempt-a", state: "active", leaseSeconds: 45 }]);
    await outbox.flush(transport);
    expect(delivered.filter((entry) => entry.startsWith("todo-a"))).toEqual([
      "todo-a:start",
      "todo-a:start",
      "todo-a:log:log-a",
      "todo-a:complete"
    ]);
    expect(outbox.hasAttempt("attempt-a")).toBe(false);
    outbox.close();
  });

  it("skips an unavailable optional screenshot and still completes the lane", async () => {
    const { outbox, root } = createOutbox();
    register(outbox, "attempt-image", "todo-image");
    const screenshotPath = join(root, "acceptance.png");
    writeFileSync(screenshotPath, "image bytes", "utf8");
    outbox.enqueueArtifact("attempt-image", {
      path: screenshotPath,
      fileName: "acceptance.png",
      mimeType: "image/png",
      sizeBytes: 11
    });
    outbox.enqueueCompletion("attempt-image", { success: true, summary: "captured" });

    let completions = 0;
    const transport = createTransport({
      uploadScreenshot: async () => {
        throw new Error("server offline");
      },
      completeJob: async () => {
        completions += 1;
      }
    });

    const result = await outbox.flush(transport);

    expect(existsSync(screenshotPath)).toBe(false);
    expect(completions).toBe(1);
    expect(outbox.hasAttempt("attempt-image")).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ attemptId: "attempt-image" });
    expect(result.warnings[0]?.message).toContain("可选验收截图未能回传，已跳过，不影响任务完成");
    expect(result.warnings[0]?.message).toContain("server offline");
    outbox.close();
  });

  it("reopens a completed Worker lane after CLI restart but leaves an unfinished lane dormant", async () => {
    const { outbox, path } = createOutbox();
    register(outbox, "attempt-complete", "todo-complete");
    outbox.enqueueStart("attempt-complete");
    outbox.enqueueCompletion("attempt-complete", { success: true, summary: "done" });
    register(outbox, "attempt-running", "todo-running");
    outbox.enqueueStart("attempt-running");
    outbox.close();

    const reopened = new DeliveryOutbox(path, Date.now, 1);
    expect(reopened.hasTerminalMessage("attempt-complete")).toBe(true);
    expect(reopened.hasTerminalMessage("attempt-running")).toBe(false);
    const delivered: string[] = [];
    await reopened.flush(createTransport({
      startJob: async (todoId) => delivered.push(`${todoId}:start`),
      completeJob: async (todoId) => delivered.push(`${todoId}:complete`)
    }), ["attempt-complete"]);

    expect(delivered).toEqual(["todo-complete:start", "todo-complete:complete"]);
    expect(reopened.hasAttempt("attempt-complete")).toBe(false);
    expect(reopened.hasAttempt("attempt-running")).toBe(true);
    expect(reopened.pendingMessageCount("attempt-running")).toBe(1);
    reopened.close();
  });
});

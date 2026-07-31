import type {
  AppendJobLogsRequest,
  BlockProjectManagerJobRequest,
  CompleteJobRequest,
  CompleteProjectManagerJobRequest,
  DeliveredJobLog,
  RunnerAttemptReconcileResult,
  RunnerAttemptReference,
  StartJobRequest,
  TodoScreenshotMimeType
} from "@maple/protocol";
import { readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  OutboxStore,
  type OutboxMessageKind,
  type StoredOutboxAttempt,
  type StoredOutboxAttemptInput,
  type StoredOutboxMessage
} from "./outbox-store";

export type { OutboxMessageKind } from "./outbox-store";
export interface OutboxAttemptInput extends StoredOutboxAttemptInput {}

export interface OutboxArtifactInput {
  path: string;
  fileName: string;
  mimeType: TodoScreenshotMimeType;
  sizeBytes: number;
}

export interface OutboxTransport {
  startJob(todoId: string, input: StartJobRequest): Promise<unknown>;
  appendLogs(todoId: string, input: AppendJobLogsRequest): Promise<unknown>;
  uploadScreenshot(
    todoId: string,
    leaseToken: string,
    deliveryId: string,
    input: { fileName: string; mimeType: TodoScreenshotMimeType; bytes: Uint8Array }
  ): Promise<unknown>;
  completeJob(todoId: string, input: CompleteJobRequest): Promise<unknown>;
  completeProjectManagerJob(todoId: string, input: CompleteProjectManagerJobRequest): Promise<unknown>;
  blockProjectManagerJob(todoId: string, input: BlockProjectManagerJobRequest): Promise<unknown>;
}

export interface OutboxFlushFailure {
  attemptId: string;
  message: string;
}

export interface OutboxFlushWarning {
  attemptId: string;
  message: string;
}

export interface OutboxFlushResult {
  delivered: number;
  failures: OutboxFlushFailure[];
  warnings: OutboxFlushWarning[];
}

interface LaneResult {
  delivered: number;
  failure?: OutboxFlushFailure;
  warnings: string[];
}

export function resolveOutboxPath(configPath: string): string {
  return join(dirname(resolve(configPath)), "outbox.sqlite");
}

export class DeliveryOutbox {
  private readonly store: OutboxStore;
  private flushPromise: Promise<OutboxFlushResult> | null = null;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
    private readonly retryBaseMs = 1_000
  ) {
    this.store = new OutboxStore(path);
  }

  registerAttempt(input: OutboxAttemptInput): void {
    this.store.registerAttempt(input, this.now());
  }

  enqueueStart(attemptId: string): string {
    return this.enqueue(attemptId, "start", {});
  }

  enqueueLog(attemptId: string, log: Omit<DeliveredJobLog, "deliveryId">): string {
    return this.enqueue(attemptId, "log", log);
  }

  enqueueArtifact(attemptId: string, artifact: OutboxArtifactInput): string {
    return this.enqueue(
      attemptId,
      "artifact",
      {
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes
      },
      resolve(artifact.path)
    );
  }

  enqueueCompletion(attemptId: string, input: Omit<CompleteJobRequest, "leaseToken">): string {
    return this.enqueue(attemptId, "completion", input);
  }

  enqueueManagerComplete(
    attemptId: string,
    input: Omit<CompleteProjectManagerJobRequest, "leaseToken">
  ): string {
    return this.enqueue(attemptId, "manager_complete", input);
  }

  enqueueManagerBlock(
    attemptId: string,
    input: Omit<BlockProjectManagerJobRequest, "leaseToken">
  ): string {
    return this.enqueue(attemptId, "manager_block", input);
  }

  references(): RunnerAttemptReference[] {
    return this.store.references();
  }

  hasAttempt(attemptId: string): boolean {
    return this.store.attempt(attemptId) !== null;
  }

  hasTerminalMessage(attemptId: string): boolean {
    return this.store.hasTerminalMessage(attemptId);
  }

  hasTerminalServerState(attemptId: string): boolean {
    const attempt = this.store.attempt(attemptId);
    return attempt?.state === "completed" || attempt?.state === "superseded";
  }

  pendingMessageCount(attemptId?: string): number {
    return this.store.pendingMessageCount(attemptId);
  }

  async applyReconciliation(results: RunnerAttemptReconcileResult[]): Promise<string[]> {
    const warnings: string[] = [];
    for (const result of results) {
      if (result.state === "active") {
        this.store.markActive(result.attemptId, result.leaseSeconds, this.now());
        continue;
      }
      this.store.markTerminal(result.attemptId, result.state, this.now());
      let cleaned = true;
      for (const path of this.store.artifactPaths(result.attemptId)) {
        try {
          await removeDeliveredFile(path);
        } catch (error) {
          cleaned = false;
          warnings.push(`截图已由 Server 确认，但本地文件清理失败：${describeError(error)}`);
        }
      }
      if (cleaned) this.store.deleteAttempt(result.attemptId);
    }
    return warnings;
  }

  flush(transport: OutboxTransport, attemptIds?: readonly string[]): Promise<OutboxFlushResult> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushNow(transport, attemptIds).finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  close(): void {
    this.store.close();
  }

  private enqueue(
    attemptId: string,
    kind: OutboxMessageKind,
    payload: unknown,
    filePath: string | null = null
  ): string {
    const id = crypto.randomUUID();
    this.store.enqueue(attemptId, id, kind, JSON.stringify(payload), filePath, this.now());
    return id;
  }

  private async flushNow(
    transport: OutboxTransport,
    attemptIds?: readonly string[]
  ): Promise<OutboxFlushResult> {
    const allowed = attemptIds ? new Set(attemptIds) : null;
    const laneIds = this.store.laneIds().filter((attemptId) => allowed === null || allowed.has(attemptId));
    const settled = await Promise.allSettled(laneIds.map((attemptId) => this.flushLane(attemptId, transport)));
    const result: OutboxFlushResult = { delivered: 0, failures: [], warnings: [] };
    for (let index = 0; index < settled.length; index += 1) {
      const lane = settled[index];
      if (lane.status === "fulfilled") {
        result.delivered += lane.value.delivered;
        if (lane.value.failure) result.failures.push(lane.value.failure);
        for (const warning of lane.value.warnings) {
          result.warnings.push({ attemptId: laneIds[index]!, message: warning });
        }
      } else {
        result.failures.push({ attemptId: laneIds[index]!, message: describeError(lane.reason) });
      }
    }
    return result;
  }

  private async flushLane(attemptId: string, transport: OutboxTransport): Promise<LaneResult> {
    const result: LaneResult = { delivered: 0, warnings: [] };
    while (true) {
      const attempt = this.store.attempt(attemptId);
      if (!attempt) return result;
      const head = this.store.head(attemptId);
      if (!head || head.available_at > this.now()) return result;
      const messages = head.kind === "log" ? this.store.contiguousLogs(attemptId) : [head];
      try {
        const terminal = await deliverMessages(attempt, messages, transport);
        this.store.acknowledge(attemptId, messages, terminal);
        result.delivered += messages.length;
        if (terminal) return result;
      } catch (error) {
        const message = describeError(error);
        if (head.kind === "artifact") {
          let cleanupFailure: string | null = null;
          if (head.file_path) {
            try {
              await removeDeliveredFile(head.file_path);
            } catch (cleanupError) {
              cleanupFailure = describeError(cleanupError);
            }
          }
          this.store.acknowledge(attemptId, messages, false);
          result.warnings.push(
            `可选验收截图未能回传，已跳过，不影响任务完成：${message}`
            + (cleanupFailure ? `；本地截图清理失败：${cleanupFailure}` : "")
          );
          continue;
        }
        this.defer(messages, message);
        result.failure = { attemptId, message };
        return result;
      }
    }
  }

  private defer(messages: StoredOutboxMessage[], error: string): void {
    const retryCount = Math.max(...messages.map((message) => message.retry_count)) + 1;
    const delay = Math.min(this.retryBaseMs * 2 ** Math.min(retryCount - 1, 6), 60_000);
    this.store.defer(messages, this.now() + delay, error);
  }
}

async function deliverMessages(
  attempt: StoredOutboxAttempt,
  messages: StoredOutboxMessage[],
  transport: OutboxTransport
): Promise<boolean> {
  const head = messages[0]!;
  if (head.kind === "log") {
    const logs = messages.map((message) => ({
      ...parsePayload<Omit<DeliveredJobLog, "deliveryId">>(message),
      deliveryId: message.id
    }));
    await transport.appendLogs(attempt.todo_id, { leaseToken: attempt.lease_token, logs });
    return false;
  }

  const payload = parsePayload<Record<string, unknown>>(head);
  if (head.kind === "start") {
    await transport.startJob(attempt.todo_id, { leaseToken: attempt.lease_token });
    return false;
  }
  if (head.kind === "artifact") {
    if (!head.file_path) throw new Error("本地回传队列缺少截图路径。");
    const bytes = new Uint8Array(await readFile(head.file_path));
    await transport.uploadScreenshot(attempt.todo_id, attempt.lease_token, head.id, {
      fileName: String(payload.fileName),
      mimeType: payload.mimeType as TodoScreenshotMimeType,
      bytes
    });
    await removeDeliveredFile(head.file_path);
    return false;
  }
  if (head.kind === "completion") {
    await transport.completeJob(attempt.todo_id, {
      leaseToken: attempt.lease_token,
      ...(payload as Omit<CompleteJobRequest, "leaseToken">)
    });
    return true;
  }
  if (head.kind === "manager_complete") {
    await transport.completeProjectManagerJob(attempt.todo_id, {
      leaseToken: attempt.lease_token,
      ...(payload as Omit<CompleteProjectManagerJobRequest, "leaseToken">)
    });
    return true;
  }
  await transport.blockProjectManagerJob(attempt.todo_id, {
    leaseToken: attempt.lease_token,
    ...(payload as Omit<BlockProjectManagerJobRequest, "leaseToken">)
  });
  return true;
}

function parsePayload<T>(message: StoredOutboxMessage): T {
  return JSON.parse(message.payload_json) as T;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function removeDeliveredFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const parent = dirname(path);
  try {
    if ((await readdir(parent)).length === 0) await rmdir(parent);
  } catch {
    // A non-empty or concurrently removed attempt directory needs no further cleanup.
  }
}

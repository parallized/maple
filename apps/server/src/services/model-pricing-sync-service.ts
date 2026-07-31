import type { ServerConfig } from "../config";
import {
  DEFAULT_MODEL_PRICING_SOURCE_URL,
  ModelPricingRepository,
  type ModelPricingSnapshot,
  type ParsedModelPricingEntry
} from "../repositories/model-pricing-repository";

const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_LEASE_SECONDS = 90;
const MAX_PROVIDERS = 1_000;
const MAX_MODELS = 50_000;

type JsonRecord = Record<string, unknown>;
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ModelPricingSyncResult =
  | { outcome: "updated"; modelCount: number; pricedModelCount: number; fetchedAt: string }
  | { outcome: "not_modified"; fetchedAt: string }
  | { outcome: "skipped"; reason: "disabled" | "already_running" | "lease_held" }
  | { outcome: "failed"; error: string };

export interface ModelPricingSyncServiceOptions {
  fetcher?: Fetcher;
  now?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/** Pulls and atomically caches the public models.dev pricing catalog. */
export class ModelPricingSyncService {
  private readonly sourceUrl: string;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly maxBytes: number;
  private readonly leaseSeconds: number;
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private started = false;
  private running = false;

  constructor(
    private readonly repository: ModelPricingRepository,
    config: ServerConfig,
    options: ModelPricingSyncServiceOptions = {}
  ) {
    this.sourceUrl = config.modelPricingSourceUrl?.trim() || DEFAULT_MODEL_PRICING_SOURCE_URL;
    this.enabled = config.modelPricingSyncEnabled !== false;
    const intervalHours = boundedInteger(
      config.modelPricingSyncIntervalHours,
      DEFAULT_INTERVAL_HOURS,
      1,
      24 * 7
    );
    this.intervalMs = intervalHours * 60 * 60 * 1_000;
    this.fetchTimeoutMs = boundedInteger(
      config.modelPricingFetchTimeoutMs,
      DEFAULT_FETCH_TIMEOUT_MS,
      1_000,
      120_000
    );
    this.maxBytes = boundedInteger(
      config.modelPricingMaxBytes,
      DEFAULT_MAX_BYTES,
      1_024 * 1_024,
      64 * 1_024 * 1_024
    );
    this.leaseSeconds = Math.max(DEFAULT_LEASE_SECONDS, Math.ceil(this.fetchTimeoutMs / 1_000) + 30);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? console;
    this.repository.configureSource(this.sourceUrl);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Starts a non-blocking initial refresh when stale, then refreshes once per interval. */
  start(): void {
    if (!this.enabled || this.started) return;
    this.started = true;
    const status = this.repository.status(true);
    const lastSuccess = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : Number.NaN;
    const elapsed = Number.isFinite(lastSuccess) ? this.now().getTime() - lastSuccess : Number.POSITIVE_INFINITY;
    this.schedule(Math.max(0, this.intervalMs - elapsed));
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  async syncNow(): Promise<ModelPricingSyncResult> {
    if (!this.enabled) return { outcome: "skipped", reason: "disabled" };
    if (this.running) return { outcome: "skipped", reason: "already_running" };

    const startedAt = this.now().toISOString();
    if (!this.repository.tryAcquireSyncLease(this.sourceUrl, startedAt, this.leaseSeconds)) {
      return { outcome: "skipped", reason: "lease_held" };
    }

    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const status = this.repository.status(true);
      const headers = new Headers({ accept: "application/json" });
      headers.set("user-agent", "Maple model-pricing-sync");
      if (status.etag) headers.set("if-none-match", status.etag);
      if (status.lastModified) headers.set("if-modified-since", status.lastModified);
      const response = await this.fetcher(this.sourceUrl, {
        method: "GET",
        headers,
        signal: controller.signal
      });
      const fetchedAt = this.now().toISOString();
      const etag = response.headers.get("etag");
      const lastModified = response.headers.get("last-modified");
      if (response.status === 304) {
        if (status.modelCount === 0) {
          throw new Error("models.dev returned 304 before a pricing snapshot existed");
        }
        this.repository.markNotModified(fetchedAt, etag, lastModified);
        return { outcome: "not_modified", fetchedAt };
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`models.dev returned HTTP ${response.status}`);
      }
      const body = await response.text();
      const bodyBytes = new TextEncoder().encode(body).byteLength;
      if (bodyBytes > this.maxBytes) {
        throw new Error(`models.dev response exceeds ${this.maxBytes} bytes`);
      }
      const snapshot = parseSnapshot(body, fetchedAt, etag, lastModified);
      this.repository.replaceSnapshot(snapshot);
      this.logger.info(
        `[maple-server] model pricing synchronized: ${snapshot.modelCount} models, `
        + `${snapshot.pricedModelCount} priced`
      );
      return {
        outcome: "updated",
        modelCount: snapshot.modelCount,
        pricedModelCount: snapshot.pricedModelCount,
        fetchedAt
      };
    } catch (error) {
      const message = errorMessage(error);
      // Shutdown aborts an in-flight request immediately before closing SQLite.
      // Do not write a failure row after that close has started.
      if (!(controller.signal.aborted && !this.started)) this.repository.markFailure(message);
      if (!isAbortError(error) || this.started) {
        this.logger.warn(`[maple-server] model pricing sync failed: ${message}`);
      }
      return { outcome: "failed", error: message };
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = null;
      this.running = false;
    }
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow()
        .catch((error) => {
          this.logger.warn(`[maple-server] model pricing scheduler failed: ${errorMessage(error)}`);
        })
        .finally(() => {
          if (this.started) this.schedule(this.intervalMs);
        });
    }, Math.max(0, Math.floor(delayMs)));
    // A background refresh must never keep an otherwise idle CLI/test process alive.
    const unref = (this.timer as unknown as { unref?: () => void }).unref;
    unref?.call(this.timer);
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isSafeInteger(value) ? Math.min(maximum, Math.max(minimum, value!)) : fallback;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maximum = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

function nonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseSnapshot(
  body: string,
  fetchedAt: string,
  etag: string | null,
  lastModified: string | null
): ModelPricingSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("models.dev returned invalid JSON");
  }
  if (!isRecord(parsed)) throw new Error("models.dev response must be an object");

  const entries: ParsedModelPricingEntry[] = [];
  const keys = new Set<string>();
  let providerCount = 0;
  let pricedModelCount = 0;
  for (const [providerKey, providerValue] of Object.entries(parsed)) {
    if (!isRecord(providerValue) || !isRecord(providerValue.models)) continue;
    const providerId = nonEmptyString(providerValue.id) ?? nonEmptyString(providerKey);
    if (!providerId) continue;
    const providerName = nonEmptyString(providerValue.name) ?? providerId;
    let providerHasModel = false;
    for (const [modelKey, modelValue] of Object.entries(providerValue.models)) {
      if (!isRecord(modelValue)) continue;
      const modelId = nonEmptyString(modelValue.id) ?? nonEmptyString(modelKey);
      if (!modelId) continue;
      const uniqueKey = `${providerId}\u0000${modelId}`;
      if (keys.has(uniqueKey)) throw new Error(`models.dev contains duplicate model ${providerId}/${modelId}`);
      keys.add(uniqueKey);
      const cost = isRecord(modelValue.cost) ? modelValue.cost : {};
      const priced = Object.keys(cost).length > 0;
      if (priced) pricedModelCount += 1;
      providerHasModel = true;
      entries.push({
        providerId,
        providerName,
        modelId,
        modelName: nonEmptyString(modelValue.name) ?? modelId,
        inputUsdPerMillion: nonNegativeNumber(cost.input),
        reasoningUsdPerMillion: nonNegativeNumber(cost.reasoning),
        outputUsdPerMillion: nonNegativeNumber(cost.output),
        cacheReadUsdPerMillion: nonNegativeNumber(cost.cache_read),
        cacheWriteUsdPerMillion: nonNegativeNumber(cost.cache_write),
        inputAudioUsdPerMillion: nonNegativeNumber(cost.input_audio),
        outputAudioUsdPerMillion: nonNegativeNumber(cost.output_audio),
        cost,
        lastUpdated: nonEmptyString(modelValue.last_updated, 40)
          ?? nonEmptyString(modelValue.lastUpdated, 40),
      });
      if (entries.length > MAX_MODELS) throw new Error("models.dev response contains too many models");
    }
    if (providerHasModel) providerCount += 1;
    if (providerCount > MAX_PROVIDERS) throw new Error("models.dev response contains too many providers");
  }
  if (entries.length === 0) throw new Error("models.dev response contains no models");
  return {
    entries,
    providerCount,
    modelCount: entries.length,
    pricedModelCount,
    fetchedAt,
    etag,
    lastModified
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 500);
  return String(error).trim().slice(0, 500) || "Unknown synchronization error";
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && error.name === "AbortError");
}

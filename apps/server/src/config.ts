import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { DeploymentMode } from "@maple/protocol";

export interface ServerConfig {
  deploymentMode?: DeploymentMode;
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  webRoot: string;
  allowedOrigins: string[];
  leaseSeconds: number;
  runnerOfflineSeconds: number;
  pairingTtlSeconds: number;
  runnerCommandTtlSeconds: number;
  publicUrl?: string;
  trustProxy?: boolean;
  secureCookies?: boolean;
  registrationEnabled?: boolean;
  sessionDays?: number;
  deviceAuthorizationTtlSeconds?: number;
  sessionCookieName?: string;
  /** Enable the background models.dev pricing catalog refresh. */
  modelPricingSyncEnabled?: boolean;
  modelPricingSyncIntervalHours?: number;
  modelPricingFetchTimeoutMs?: number;
  modelPricingMaxBytes?: number;
  modelPricingSourceUrl?: string;
  /** Optional 32-byte base64url/hex key used to encrypt workspace Provider credentials. */
  providerCredentialEncryptionKey?: string;
  /** Optional deployment-managed DeepSeek key; takes precedence over SQLite credentials. */
  deepSeekApiKey?: string;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function parseOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return ["http://localhost:5173", "http://127.0.0.1:5173"];
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const dataDir = resolve(env.MAPLE_DATA_DIR?.trim() || join(homedir(), ".maple", "server"));
  const runtimeDir = dirname(resolve(process.argv[1] || import.meta.path));
  const host = env.MAPLE_HOST?.trim() || "127.0.0.1";
  const port = positiveInteger(env.MAPLE_PORT, 45820);
  const publicUrl = (env.MAPLE_PUBLIC_URL?.trim() || `http://${host}:${port}`).replace(/\/$/, "");
  return {
    deploymentMode: "hosted",
    host,
    port,
    dataDir,
    databasePath: env.MAPLE_DATABASE_PATH?.trim() || join(dataDir, "maple.sqlite"),
    webRoot: resolve(env.MAPLE_WEB_ROOT?.trim() || join(runtimeDir, "web")),
    allowedOrigins: parseOrigins(env.MAPLE_ALLOWED_ORIGINS),
    leaseSeconds: positiveInteger(env.MAPLE_JOB_LEASE_SECONDS, 45),
    runnerOfflineSeconds: positiveInteger(env.MAPLE_RUNNER_OFFLINE_SECONDS, 30),
    pairingTtlSeconds: positiveInteger(env.MAPLE_PAIRING_TTL_SECONDS, 600),
    runnerCommandTtlSeconds: positiveInteger(env.MAPLE_RUNNER_COMMAND_TTL_SECONDS, 900),
    publicUrl,
    trustProxy: env.MAPLE_TRUST_PROXY === "1",
    secureCookies: env.MAPLE_SECURE_COOKIES === "1" || publicUrl.startsWith("https://"),
    registrationEnabled: env.MAPLE_REGISTRATION_ENABLED !== "0",
    sessionDays: positiveInteger(env.MAPLE_SESSION_DAYS, 30),
    deviceAuthorizationTtlSeconds: positiveInteger(env.MAPLE_DEVICE_AUTH_TTL_SECONDS, 600),
    modelPricingSyncEnabled: env.MAPLE_MODEL_PRICING_SYNC !== "0",
    modelPricingSyncIntervalHours: boundedInteger(env.MAPLE_MODEL_PRICING_INTERVAL_HOURS, 24, 1, 24 * 7),
    modelPricingFetchTimeoutMs: boundedInteger(env.MAPLE_MODEL_PRICING_TIMEOUT_MS, 20_000, 1_000, 120_000),
    modelPricingMaxBytes: boundedInteger(
      env.MAPLE_MODEL_PRICING_MAX_BYTES,
      16 * 1024 * 1024,
      1024 * 1024,
      64 * 1024 * 1024
    ),
    modelPricingSourceUrl: env.MAPLE_MODEL_PRICING_URL?.trim() || undefined,
    providerCredentialEncryptionKey: env.MAPLE_PROVIDER_CREDENTIAL_KEY?.trim() || undefined,
    deepSeekApiKey: env.DEEPSEEK_API_KEY?.trim() || undefined
  };
}

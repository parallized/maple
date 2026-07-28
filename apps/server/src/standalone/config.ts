import { join, resolve } from "node:path";
import type { ServerConfig } from "../config";

export const DEFAULT_STANDALONE_PORT = 45_821;
export const STANDALONE_SESSION_COOKIE = "maple_standalone_session";

export interface StandaloneServerConfigOptions {
  dataDir: string;
  webRoot: string;
  port?: number;
}

export function createStandaloneServerConfig(options: StandaloneServerConfigOptions): ServerConfig {
  const port = options.port ?? DEFAULT_STANDALONE_PORT;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Maple Local 端口必须在 1 到 65535 之间。");
  }
  const dataDir = resolve(options.dataDir);
  const publicUrl = `http://127.0.0.1:${port}`;
  return {
    deploymentMode: "standalone",
    host: "127.0.0.1",
    port,
    dataDir,
    databasePath: join(dataDir, "maple.sqlite"),
    webRoot: resolve(options.webRoot),
    allowedOrigins: [publicUrl, `http://localhost:${port}`],
    leaseSeconds: 45,
    runnerOfflineSeconds: 30,
    pairingTtlSeconds: 600,
    runnerCommandTtlSeconds: 900,
    publicUrl,
    trustProxy: false,
    secureCookies: false,
    registrationEnabled: false,
    sessionDays: 3_650,
    deviceAuthorizationTtlSeconds: 600,
    sessionCookieName: STANDALONE_SESSION_COOKIE
  };
}


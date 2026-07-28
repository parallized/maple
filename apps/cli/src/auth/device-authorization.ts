import { createHash, randomBytes } from "node:crypto";
import type {
  DeviceAuthorizationStartRequest,
  Runner,
  WorkspaceSummary
} from "@maple/protocol";
import type { MapleApiClient } from "../api/client";

export interface AuthorizedRunner {
  runner: Runner;
  runnerToken: string;
  workspace: WorkspaceSummary;
}

function createVerifier(): string {
  return randomBytes(48).toString("base64url");
}

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function canOpenBrowser(env: Record<string, string | undefined>): boolean {
  if (process.platform !== "linux") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform === "win32") {
    return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
  }
  return platform === "darwin" ? ["open", url] : ["xdg-open", url];
}

export function openBrowser(url: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!canOpenBrowser(env)) return false;
  try {
    const child = Bun.spawn(browserOpenCommand(url), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore"
    });
    void child.exited.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return Bun.sleep(ms);
  if (signal.aborted) return Promise.reject(new Error("CLI 授权已取消。"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("CLI 授权已取消。"));
    }, { once: true });
  });
}

export async function authorizeRunner(
  api: MapleApiClient,
  input: Omit<DeviceAuthorizationStartRequest, "codeChallenge">,
  options: {
    signal?: AbortSignal;
    log?: (message: string) => void;
    open?: (url: string) => boolean;
  } = {}
): Promise<AuthorizedRunner> {
  const verifier = createVerifier();
  const authorization = await api.startDeviceAuthorization({
    ...input,
    codeChallenge: challenge(verifier)
  });
  const log = options.log ?? console.log;
  const opened = (options.open ?? openBrowser)(authorization.verificationUriComplete);
  log(opened
    ? `[maple] 已在浏览器打开授权页：${authorization.verificationUriComplete}`
    : `[maple] 请在浏览器打开：${authorization.verificationUriComplete}`);

  while (Date.now() < Date.parse(authorization.expiresAt)) {
    if (options.signal?.aborted) throw new Error("CLI 授权已取消。");
    const result = await api.exchangeDeviceAuthorization({
      deviceCode: authorization.deviceCode,
      codeVerifier: verifier
    });
    if (result.status === "authorized") return result;
    if (result.status === "expired") break;
    await wait(result.retryAfterMs, options.signal);
  }
  throw new Error("CLI 授权已过期，请重新连接。");
}

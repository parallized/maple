import { spawnSync } from "node:child_process";

const WINDOWS_INTERNET_SETTINGS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const PROXY_ENVIRONMENT_KEYS = {
  "http:": ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"],
  "https:": ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
} as const;

export interface ResolveFetchProxyOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  readWindowsRegistryValue?: (name: "ProxyEnable" | "ProxyServer") => string | null;
}

/**
 * Bun already honors proxy environment variables. Windows system proxy settings
 * need to be supplied explicitly to fetch when those variables are absent.
 */
export function resolveFetchProxyUrl(
  targetUrl: string,
  options: ResolveFetchProxyOptions = {}
): string | null {
  let protocol: "http:" | "https:";
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    protocol = parsed.protocol;
  } catch {
    return null;
  }

  const env = options.env ?? process.env;
  if (PROXY_ENVIRONMENT_KEYS[protocol].some((key) => Boolean(env[key]?.trim()))) return null;
  if ((options.platform ?? process.platform) !== "win32") return null;

  const readRegistryValue = options.readWindowsRegistryValue ?? readWindowsRegistryValue;
  if (!registryDwordEnabled(readRegistryValue("ProxyEnable"))) return null;
  return parseWindowsProxyServer(readRegistryValue("ProxyServer") ?? "", protocol);
}

export function parseWindowsProxyServer(value: string, targetProtocol: "http:" | "https:"): string | null {
  const text = value.trim();
  if (!text) return null;

  const entries = text.split(";").map((entry) => entry.trim()).filter(Boolean);
  const protocolEntries = entries.filter((entry) => entry.includes("="));
  let candidate: string | undefined;
  if (protocolEntries.length > 0) {
    const target = targetProtocol.slice(0, -1).toLowerCase();
    candidate = protocolEntries
      .map((entry) => {
        const separator = entry.indexOf("=");
        return [entry.slice(0, separator).trim().toLowerCase(), entry.slice(separator + 1).trim()] as const;
      })
      .find(([protocol]) => protocol === target)?.[1];
  } else {
    candidate = entries[0];
  }

  if (!candidate || /[\r\n]/.test(candidate)) return null;
  const urlText = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  try {
    const proxy = new URL(urlText);
    if ((proxy.protocol !== "http:" && proxy.protocol !== "https:") || !proxy.hostname) return null;
    return proxy.toString();
  } catch {
    return null;
  }
}

function readWindowsRegistryValue(name: "ProxyEnable" | "ProxyServer"): string | null {
  try {
    const result = spawnSync("reg.exe", ["query", WINDOWS_INTERNET_SETTINGS, "/v", name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 2_000
    });
    if (result.status !== 0 || result.error) return null;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\s*${escapedName}\\s+REG_\\w+\\s+(.+?)\\s*$`, "im")
      .exec(result.stdout)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function registryDwordEnabled(value: string | null): boolean {
  if (!value) return false;
  const parsed = value.trim().toLowerCase().startsWith("0x")
    ? Number.parseInt(value.trim().slice(2), 16)
    : Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed !== 0;
}

import { createHash } from "node:crypto";

function cleanIp(value: string): string {
  const trimmed = value.trim().replace(/^\[|\]$/g, "");
  if (trimmed.startsWith("::ffff:")) return trimmed.slice(7);
  return trimmed || "unknown";
}

export function resolveClientIp(
  request: Request,
  trustProxy: boolean,
  directAddress?: string | null
): string {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
    const candidate = forwarded
      || request.headers.get("cf-connecting-ip")
      || request.headers.get("x-real-ip");
    if (candidate) return cleanIp(candidate);
  }
  return cleanIp(directAddress || "unknown");
}

export function networkKey(ipAddress: string): string {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipAddress)) {
    return ipAddress.split(".").slice(0, 3).join(".");
  }
  if (ipAddress.includes(":")) return ipAddress.toLowerCase().split(":").slice(0, 4).join(":");
  return ipAddress;
}

export function deviceLabel(userAgent: string): string {
  const source = userAgent.toLowerCase();
  const browser = source.includes("edg/")
    ? "Edge"
    : source.includes("chrome/")
      ? "Chrome"
      : source.includes("firefox/")
        ? "Firefox"
        : source.includes("safari/")
          ? "Safari"
          : "Browser";
  const system = source.includes("windows")
    ? "Windows"
    : source.includes("mac os")
      ? "macOS"
      : source.includes("linux")
        ? "Linux"
        : source.includes("android")
          ? "Android"
          : source.includes("iphone") || source.includes("ipad")
            ? "iOS"
            : "Unknown system";
  return `${browser} · ${system}`;
}

export function userAgentKey(userAgent: string): string {
  const stable = userAgent.toLowerCase().replace(/\d+(?:\.\d+)+/g, "*").slice(0, 500);
  return createHash("sha256").update(stable).digest("hex");
}

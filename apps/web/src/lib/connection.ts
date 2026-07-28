export function normalizeServerUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server 地址必须使用 http:// 或 https://。");
  }
  return url.toString().replace(/\/$/, "");
}

export function defaultServerUrl(): string {
  return normalizeServerUrl(window.location.origin);
}

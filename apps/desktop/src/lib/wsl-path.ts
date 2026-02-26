function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

export function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value.trim());
}

export function isWslMntPath(value: string): boolean {
  return /^\/mnt\/[a-z]\//i.test(value.trim());
}

export function windowsPathToWslMntPath(path: string): string | null {
  const trimmed = path.trim();
  const match = trimmed.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) return null;
  const drive = match[1]!.toLowerCase();
  const rest = normalizeSlashes(match[2] ?? "").replace(/^\/+/, "");
  if (!rest) return `/mnt/${drive}`;
  return `/mnt/${drive}/${rest}`;
}

export function wslMntPathToWindowsPath(path: string): string | null {
  const trimmed = path.trim();
  const match = trimmed.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
  if (!match) return null;
  const drive = (match[1] ?? "").toUpperCase();
  const rest = (match[2] ?? "").trim();
  if (!rest) return `${drive}:\\`;
  return `${drive}:\\${rest.replace(/\//g, "\\")}`;
}


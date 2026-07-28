export function nowIso(): string {
  return new Date().toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

export function subtractSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) - seconds * 1000).toISOString();
}

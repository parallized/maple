const LEGACY_RUNNER_SUFFIX = " · Maple CLI";

export function defaultRunnerName(hostname: string): string {
  return hostname.trim();
}

export function normalizeStoredRunnerName(name: string, hostname: string): string {
  const defaultName = defaultRunnerName(hostname);
  return defaultName && name === `${defaultName}${LEGACY_RUNNER_SUFFIX}` ? defaultName : name;
}

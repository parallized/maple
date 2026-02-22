function normalizeTag(tag: string): string {
  return tag.trim();
}

const VERSION_TAG_RE = /^v\d+\.\d+\.\d+$/i;

export function isVersionTag(tag: string): boolean {
  return VERSION_TAG_RE.test(tag.trim());
}

export function buildVersionTag(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

type MergeTaskTagsInput = {
  existing: string[];
  generated: string[];
  versionTag?: string | null;
  max?: number;
};

export function mergeTaskTags({ existing, generated, versionTag, max }: MergeTaskTagsInput): string[] {
  const normalizedVersionTag = versionTag ? normalizeTag(versionTag) : "";
  const shouldReplaceVersionTag = Boolean(normalizedVersionTag);

  const merged = [...generated, ...existing]
    .map(normalizeTag)
    .filter(Boolean);

  const seen = new Set<string>();
  const result: string[] = [];
  let hasVersionTag = false;
  for (const tag of merged) {
    if (isVersionTag(tag)) {
      if (shouldReplaceVersionTag) continue;
      if (hasVersionTag) continue;
      hasVersionTag = true;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }

  if (normalizedVersionTag) {
    const key = normalizedVersionTag.toLowerCase();
    if (!seen.has(key)) {
      result.push(normalizedVersionTag);
      seen.add(key);
    }
  }

  if (typeof max === "number" && Number.isFinite(max)) {
    return result.slice(0, Math.max(0, Math.floor(max)));
  }
  return result;
}

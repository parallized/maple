import { isVersionTag } from "./task-tags";
import type { TagCatalog } from "../domain";
import { normalizeTagId, resolveTagDefinition } from "./tag-catalog";

function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildAutoTagColor(tagId: string): string {
  const hue = hash32(tagId) % 360;
  const saturation = 66;
  const lightness = 46;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function resolveTagColor(tag: string, tagCatalog?: TagCatalog | null): string | null {
  const tagId = normalizeTagId(tag);
  if (!tagId) return null;

  const catalogColor = resolveTagDefinition(tagId, tagCatalog)?.color?.trim();
  if (catalogColor) return catalogColor;

  if (isVersionTag(tagId)) return "var(--color-primary)";
  return buildAutoTagColor(tagId);
}

export function buildTagBadgeStyle(tag: string, tagCatalog?: TagCatalog | null): Record<string, string> {
  const color = resolveTagColor(tag, tagCatalog);
  if (!color) return {};
  return { "--tag-color": color };
}

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

/** 与服务端标签目录注册一致的莫兰迪色板（低饱和、低明度，深浅界面都干净）。 */
const MORANDI_TAG_COLORS = [
  "#9aa7a0",
  "#a3a0ab",
  "#97a4b3",
  "#b0a89a",
  "#b39b98",
  "#8fa0ae",
  "#a3a794",
  "#b0a291",
  "#9b9bb0",
  "#a89aa6"
];

function buildAutoTagColor(tagId: string): string {
  return MORANDI_TAG_COLORS[hash32(tagId) % MORANDI_TAG_COLORS.length];
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

import type { UiLanguage } from "./constants";
import { isVersionTag } from "./task-tags";
import type { TagCatalog, TagDefinition } from "../domain";
import { normalizeTagId, resolveTagDefinition } from "./tag-catalog";

function pickTagLabel(label: TagDefinition["label"] | undefined, language: UiLanguage): string | null {
  const zh = label?.zh?.trim() ?? "";
  const en = label?.en?.trim() ?? "";
  if (language === "zh") return zh || en || null;
  return en || zh || null;
}

export function formatTagLabel(tag: string, uiLanguage: UiLanguage, tagCatalog?: TagCatalog | null): string {
  const raw = tag.trim();
  if (!raw) return "";
  const normalized = normalizeTagId(raw);
  if (isVersionTag(normalized)) return raw;

  const definition = resolveTagDefinition(normalized, tagCatalog);
  const catalogLabel = pickTagLabel(definition?.label, uiLanguage);
  return catalogLabel ?? raw;
}

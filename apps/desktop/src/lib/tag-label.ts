import type { UiLanguage } from "./constants";
import { isVersionTag } from "./task-tags";
import type { TagCatalog, TagDefinition } from "../domain";
import { normalizeTagId, resolveTagDefinition } from "./tag-catalog";
import { normalizeTagsForAiLanguage } from "./tag-language";

function pickTagLabel(label: TagDefinition["label"] | undefined, language: UiLanguage): string | null {
  const zh = label?.zh?.trim() ?? "";
  const en = label?.en?.trim() ?? "";
  if (language === "zh") return zh || null;
  return en || null;
}

export function formatTagLabel(tag: string, uiLanguage: UiLanguage, tagCatalog?: TagCatalog | null): string {
  const raw = tag.trim();
  if (!raw) return "";
  const normalized = normalizeTagId(raw);
  if (isVersionTag(normalized)) return raw;

  const definition = resolveTagDefinition(normalized, tagCatalog);
  const catalogLabel = pickTagLabel(definition?.label, uiLanguage);
  if (catalogLabel) return catalogLabel;

  const localized = normalizeTagsForAiLanguage({
    tags: [raw],
    language: uiLanguage,
    tagCatalog,
    max: 1
  })[0];
  if (localized) return localized;

  if (uiLanguage === "zh" && /[A-Za-z]/.test(raw)) return "未定义标签";
  if (uiLanguage === "en" && /[\u3400-\u9FFF]/.test(raw)) return "Unknown Tag";
  return raw;
}

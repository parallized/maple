import type { TagCatalog } from "../domain";
import type { UiLanguage } from "./constants";
import { resolveTagDefinition, normalizeTagId } from "./tag-catalog";
import { isVersionTag } from "./task-tags";

const HAS_CJK_RE = /[\u3400-\u9FFF]/;
const HAS_LATIN_RE = /[A-Za-z]/;

function convertTagToLanguage(rawTag: string, language: UiLanguage, tagCatalog?: TagCatalog | null): string {
  const raw = rawTag.trim();
  if (!raw) return "";
  if (isVersionTag(raw)) return raw;

  const normalized = normalizeTagId(raw);
  const definition = resolveTagDefinition(normalized, tagCatalog);
  const localizedFromCatalog = language === "zh"
    ? definition?.label?.zh?.trim() ?? ""
    : definition?.label?.en?.trim() ?? "";
  if (localizedFromCatalog) return localizedFromCatalog;

  if (language === "zh") {
    if (HAS_CJK_RE.test(raw) || !HAS_LATIN_RE.test(raw)) return raw;
    return "";
  }

  if (HAS_LATIN_RE.test(raw) || !HAS_CJK_RE.test(raw)) return raw;
  return "";
}

type NormalizeTagsForAiLanguageInput = {
  tags: string[];
  language: UiLanguage;
  tagCatalog?: TagCatalog | null;
  max?: number;
};

export function normalizeTagsForAiLanguage({
  tags,
  language,
  tagCatalog,
  max = 5
}: NormalizeTagsForAiLanguageInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const localized = convertTagToLanguage(tag, language, tagCatalog);
    if (!localized) continue;
    const key = localized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(localized);
    if (out.length >= max) break;
  }
  return out;
}

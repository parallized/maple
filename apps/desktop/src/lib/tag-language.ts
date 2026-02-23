import type { TagCatalog } from "../domain";
import type { UiLanguage } from "./constants";
import { resolveTagDefinition, normalizeTagId } from "./tag-catalog";
import { isVersionTag } from "./task-tags";

const HAS_CJK_RE = /[\u3400-\u9FFF]/;
const HAS_LATIN_RE = /[A-Za-z]/;

const EN_TO_ZH_TAG: Record<string, string> = {
  "type:feat": "新功能",
  "type:fix": "修复",
  "type:refactor": "重构",
  "type:docs": "文档",
  "type:chore": "配置",
  "feat": "新功能",
  "fix": "修复",
  "refactor": "重构",
  "docs": "文档",
  "chore": "配置",
  "config": "配置",
  "area:core": "核心",
  "area:ui": "界面",
  "area:task-detail": "详情",
  "area:markdown": "文档格式",
  "area:worker": "执行器",
  "area:mcp": "协议层",
  "area:xterm": "终端",
  "area:i18n": "多语言",
  "core": "核心",
  "ui": "界面",
  "detail": "详情",
  "task-detail": "详情",
  "markdown": "文档格式",
  "worker": "执行器",
  "mcp": "协议层",
  "terminal": "终端",
  "xterm": "终端",
  "i18n": "多语言",
  "state:blocked": "阻塞",
  "state:needs-info": "待补充",
  "blocked": "阻塞",
  "needs-info": "待补充",
  "needs_info": "待补充",
  "need_more_info": "待补充"
};

const ZH_TO_EN_TAG: Record<string, string> = {
  "新功能": "Feat",
  "修复": "Fix",
  "重构": "Refactor",
  "文档": "Docs",
  "配置": "Config",
  "核心": "Core",
  "界面": "UI",
  "详情": "Detail",
  "文档格式": "Markdown",
  "执行器": "Worker",
  "协议层": "MCP",
  "终端": "Terminal",
  "多语言": "i18n",
  "阻塞": "Blocked",
  "待补充": "Needs Info"
};

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
    const mapped = EN_TO_ZH_TAG[normalized];
    if (mapped) return mapped;
    if (HAS_CJK_RE.test(raw)) return raw;
    return "";
  }

  const mapped = ZH_TO_EN_TAG[raw];
  if (mapped) return mapped;
  if (HAS_LATIN_RE.test(raw)) return raw;
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


import type { UiLanguage } from "./constants";
import { isVersionTag } from "./task-tags";
import type { TagCatalog } from "../domain";
import { normalizeTagId, resolveTagDefinition } from "./tag-catalog";

const TAG_LABELS: Record<UiLanguage, Record<string, string>> = {
  en: {
    mcp: "MCP",
    verify: "Verify",
    verified: "Verified",

    "type:feat": "Feat",
    "type:fix": "Fix",
    "type:refactor": "Refactor",
    "type:docs": "Docs",
    "type:chore": "Chore",

    "area:core": "Core",
    "area:ui": "UI",
    "area:task-detail": "Detail",
    "area:markdown": "Markdown",
    "area:worker": "Worker",
    "area:mcp": "MCP",
    "area:xterm": "Terminal",
    "area:i18n": "i18n",

    "state:blocked": "Blocked",
    "state:needs-info": "Needs Info",
  },
  zh: {
    mcp: "MCP",
    verify: "验证",
    verified: "已验证",

    "type:feat": "新功能",
    "type:fix": "修复",
    "type:refactor": "重构",
    "type:docs": "文档",
    "type:chore": "配置",

    "area:core": "核心",
    "area:ui": "UI",
    "area:task-detail": "详情",
    "area:markdown": "Markdown",
    "area:worker": "Worker",
    "area:mcp": "MCP",
    "area:xterm": "终端",
    "area:i18n": "多语言",

    "state:blocked": "阻塞",
    "state:needs-info": "待补充",
  },
};

export function formatTagLabel(tag: string, uiLanguage: UiLanguage, tagCatalog?: TagCatalog | null): string {
  const raw = tag.trim();
  if (!raw) return "";
  const normalized = normalizeTagId(raw);
  if (isVersionTag(normalized)) return raw;

  const catalogLabel = resolveTagDefinition(normalized, tagCatalog)?.label?.[uiLanguage];
  if (catalogLabel) return catalogLabel;

  return TAG_LABELS[uiLanguage]?.[normalized] ?? raw;
}

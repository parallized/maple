import type { UiLanguage } from "./constants";
import { isVersionTag } from "./task-tags";

const TAG_LABELS: Record<UiLanguage, Record<string, string>> = {
  en: {
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

export function formatTagLabel(tag: string, uiLanguage: UiLanguage): string {
  const raw = tag.trim();
  if (!raw) return "";
  const normalized = raw.toLowerCase();
  if (isVersionTag(normalized)) return raw;
  return TAG_LABELS[uiLanguage]?.[normalized] ?? raw;
}


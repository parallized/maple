import type { TagCatalog, TagDefinition } from "../domain";
import { normalizeTagId } from "./tag-catalog";

const BUILTIN_TAG_CATALOG: TagCatalog = {
  // Decision tags
  "ui": { icon: "mingcute:palette-line", label: { zh: "UI", en: "UI" } },
  "修复": { icon: "mingcute:shield-line", label: { zh: "修复", en: "Fix" } },
  "架构": { icon: "mingcute:layout-grid-line", label: { zh: "架构", en: "Architecture" } },
  "配置": { icon: "mingcute:settings-3-line", label: { zh: "配置", en: "Config" } },

  // Tooling tags
  "mcp": { icon: "mingcute:server-line", label: { zh: "MCP", en: "MCP" } },
  "verify": { icon: "mingcute:check-line", label: { zh: "验证", en: "Verify" } },
  "verified": { icon: "mingcute:check-line", label: { zh: "已验证", en: "Verified" } },

  // PR-style tags
  "type:feat": { icon: "mingcute:add-line", label: { zh: "新功能", en: "Feat" } },
  "type:fix": { icon: "mingcute:shield-line", label: { zh: "修复", en: "Fix" } },
  "type:refactor": { icon: "mingcute:refresh-2-line", label: { zh: "重构", en: "Refactor" } },
  "type:docs": { icon: "mingcute:information-line", label: { zh: "文档", en: "Docs" } },
  "type:chore": { icon: "mingcute:settings-3-line", label: { zh: "配置", en: "Chore" } },
  "新功能": { icon: "mingcute:add-line", label: { zh: "新功能", en: "Feat" } },
  "重构": { icon: "mingcute:refresh-2-line", label: { zh: "重构", en: "Refactor" } },
  "文档格式": { icon: "mingcute:layers-line", label: { zh: "文档格式", en: "Markdown" } },
  "界面": { icon: "mingcute:palette-line", label: { zh: "界面", en: "UI" } },
  "核心": { icon: "mingcute:layout-grid-line", label: { zh: "核心", en: "Core" } },
  "详情": { icon: "mingcute:layout-right-line", label: { zh: "详情", en: "Detail" } },
  "执行器": { icon: "mingcute:ai-line", label: { zh: "执行器", en: "Worker" } },
  "协议层": { icon: "mingcute:server-line", label: { zh: "协议层", en: "MCP" } },
  "终端": { icon: "mingcute:terminal-box-line", label: { zh: "终端", en: "Terminal" } },
  "多语言": { icon: "mingcute:translate-line", label: { zh: "多语言", en: "i18n" } },

  "area:core": { icon: "mingcute:layout-grid-line", label: { zh: "核心", en: "Core" } },
  "area:ui": { icon: "mingcute:palette-line", label: { zh: "UI", en: "UI" } },
  "area:task-detail": { icon: "mingcute:layout-right-line", label: { zh: "详情", en: "Detail" } },
  "area:markdown": { icon: "mingcute:layers-line", label: { zh: "Markdown", en: "Markdown" } },
  "area:worker": { icon: "mingcute:ai-line", label: { zh: "Worker", en: "Worker" } },
  "area:mcp": { icon: "mingcute:server-line", label: { zh: "MCP", en: "MCP" } },
  "area:xterm": { icon: "mingcute:terminal-box-line", label: { zh: "终端", en: "Terminal" } },
  "area:i18n": { icon: "mingcute:translate-line", label: { zh: "多语言", en: "i18n" } },

  "state:blocked": { icon: "mingcute:shield-line", label: { zh: "阻塞", en: "Blocked" } },
  "state:needs-info": { icon: "mingcute:information-line", label: { zh: "待补充", en: "Needs Info" } },
  "阻塞": { icon: "mingcute:shield-line", label: { zh: "阻塞", en: "Blocked" } },
  "待补充": { icon: "mingcute:information-line", label: { zh: "待补充", en: "Needs Info" } },
};

function mergeTagLabel(existing: TagDefinition["label"], builtin: TagDefinition["label"]): TagDefinition["label"] | undefined {
  const next: NonNullable<TagDefinition["label"]> = {};
  const builtinZh = builtin?.zh?.trim() ?? "";
  const builtinEn = builtin?.en?.trim() ?? "";
  const existingZh = existing?.zh?.trim() ?? "";
  const existingEn = existing?.en?.trim() ?? "";

  const zh = existingZh || builtinZh;
  const en = existingEn || builtinEn;
  if (zh) next.zh = zh;
  if (en) next.en = en;

  return Object.keys(next).length > 0 ? next : undefined;
}

function mergeTagDefinition(existing: TagDefinition, builtin: TagDefinition): TagDefinition {
  const next: TagDefinition = { ...existing };

  if (!next.color && builtin.color) next.color = builtin.color;
  if (!next.icon && builtin.icon) next.icon = builtin.icon;

  if (builtin.label || existing.label) {
    next.label = mergeTagLabel(existing.label, builtin.label);
  }

  return next;
}

export function mergeWithBuiltinTagCatalog(catalog: TagCatalog | null | undefined): TagCatalog {
  const next: TagCatalog = {};

  for (const [rawId, rawDef] of Object.entries(catalog ?? {})) {
    const id = normalizeTagId(rawId);
    if (!id) continue;
    next[id] = rawDef ?? {};
  }

  for (const [rawId, builtinDef] of Object.entries(BUILTIN_TAG_CATALOG)) {
    const id = normalizeTagId(rawId);
    if (!id) continue;
    const existing = next[id] ?? {};
    next[id] = mergeTagDefinition(existing, builtinDef);
  }

  return next;
}

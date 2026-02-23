import type { TagCatalog, TagDefinition } from "../domain";
import type { UiLanguage } from "./constants";
import { normalizeTagId } from "./tag-catalog";

const HAS_CJK_RE = /[\u3400-\u9FFF]/;
const HAS_LATIN_RE = /[A-Za-z]/;

type TagPreset = {
  zh: string;
  en: string;
  icon?: string;
};

const TAG_PRESETS: Record<string, TagPreset> = {
  mcp: { zh: "MCP", en: "MCP", icon: "mingcute:server-line" },
  verify: { zh: "验证", en: "Verify", icon: "mingcute:check-line" },
  verified: { zh: "已验证", en: "Verified", icon: "mingcute:check-line" },
  ui: { zh: "UI", en: "UI", icon: "mingcute:palette-line" },
  fix: { zh: "修复", en: "Fix", icon: "mingcute:shield-line" },
  i18n: { zh: "多语言", en: "i18n", icon: "mingcute:translate-line" },
  tag: { zh: "标签", en: "Tag", icon: "mingcute:tag-line" },
  icon: { zh: "图标", en: "Icon", icon: "mingcute:tag-line" },
  image: { zh: "图片", en: "Image", icon: "mingcute:layers-line" },
  editor: { zh: "编辑器", en: "Editor", icon: "mingcute:code-line" },
  desktop: { zh: "桌面端", en: "Desktop", icon: "mingcute:computer-line" },
  ci: { zh: "CI", en: "CI", icon: "mingcute:settings-3-line" },
  release: { zh: "发布", en: "Release", icon: "mingcute:settings-3-line" },
  research: { zh: "调研", en: "Research", icon: "mingcute:search-line" },
  blocknote: { zh: "BlockNote", en: "BlockNote", icon: "mingcute:layers-line" },
  hapi: { zh: "Hapi", en: "Hapi", icon: "mingcute:server-line" },
  interactive: { zh: "交互", en: "Interactive", icon: "mingcute:palette-line" },
  "area:build": { zh: "构建", en: "Build", icon: "mingcute:settings-3-line" },
  "area:tags": { zh: "标签", en: "Tags", icon: "mingcute:tag-line" },
  "area:research": { zh: "调研", en: "Research", icon: "mingcute:search-line" },
};

const AREA_VALUE_PRESETS: Record<string, TagPreset> = {
  core: { zh: "核心", en: "Core", icon: "mingcute:layout-grid-line" },
  ui: { zh: "UI", en: "UI", icon: "mingcute:palette-line" },
  "task-detail": { zh: "详情", en: "Detail", icon: "mingcute:layout-right-line" },
  markdown: { zh: "Markdown", en: "Markdown", icon: "mingcute:layers-line" },
  worker: { zh: "执行器", en: "Worker", icon: "mingcute:ai-line" },
  mcp: { zh: "MCP", en: "MCP", icon: "mingcute:server-line" },
  xterm: { zh: "终端", en: "Terminal", icon: "mingcute:terminal-box-line" },
  i18n: { zh: "多语言", en: "i18n", icon: "mingcute:translate-line" },
  build: { zh: "构建", en: "Build", icon: "mingcute:settings-3-line" },
  tags: { zh: "标签", en: "Tags", icon: "mingcute:tag-line" },
  research: { zh: "调研", en: "Research", icon: "mingcute:search-line" },
};

function inferPreset(tagId: string): TagPreset | null {
  if (TAG_PRESETS[tagId]) return TAG_PRESETS[tagId];
  if (tagId.startsWith("area:")) {
    const area = tagId.slice("area:".length);
    if (!area) return null;
    return AREA_VALUE_PRESETS[area] ?? null;
  }
  return null;
}

function inferLabelFromRaw(rawTag: string, language: UiLanguage): TagDefinition["label"] | undefined {
  const raw = rawTag.trim();
  if (!raw) return undefined;
  const label: NonNullable<TagDefinition["label"]> = {};

  if (language === "zh") {
    label.zh = raw;
    if (HAS_LATIN_RE.test(raw)) {
      label.en = raw;
    }
  } else {
    label.en = raw;
    if (HAS_CJK_RE.test(raw)) {
      label.zh = raw;
    }
  }
  return Object.keys(label).length > 0 ? label : undefined;
}

export function buildAutoTagDefinition(tag: string, language: UiLanguage): TagDefinition {
  const raw = tag.trim();
  const tagId = normalizeTagId(raw);
  const preset = inferPreset(tagId);

  const fallbackLabel = inferLabelFromRaw(raw, language);
  const label: NonNullable<TagDefinition["label"]> = {
    ...(preset?.zh ? { zh: preset.zh } : {}),
    ...(preset?.en ? { en: preset.en } : {}),
  };

  if (!label.zh && fallbackLabel?.zh) label.zh = fallbackLabel.zh;
  if (!label.en && fallbackLabel?.en) label.en = fallbackLabel.en;

  return {
    icon: preset?.icon ?? "mingcute:tag-line",
    ...(Object.keys(label).length > 0 ? { label } : {}),
  };
}

function labelsEqual(a?: TagDefinition["label"], b?: TagDefinition["label"]): boolean {
  return (a?.zh ?? "") === (b?.zh ?? "") && (a?.en ?? "") === (b?.en ?? "");
}

export function ensureTagCatalogDefinition(
  catalog: TagCatalog,
  tag: string,
  language: UiLanguage
): boolean {
  const tagId = normalizeTagId(tag);
  if (!tagId) return false;

  const existing = catalog[tagId] ?? {};
  const inferred = buildAutoTagDefinition(tag, language);
  const next: TagDefinition = { ...existing };

  if (!next.icon && inferred.icon) {
    next.icon = inferred.icon;
  }

  const mergedLabel: NonNullable<TagDefinition["label"]> = {
    ...(existing.label?.zh ? { zh: existing.label.zh } : {}),
    ...(existing.label?.en ? { en: existing.label.en } : {}),
  };
  if (!mergedLabel.zh && inferred.label?.zh) mergedLabel.zh = inferred.label.zh;
  if (!mergedLabel.en && inferred.label?.en) mergedLabel.en = inferred.label.en;
  if (Object.keys(mergedLabel).length > 0) {
    next.label = mergedLabel;
  }

  const changed =
    !catalog[tagId]
    || (existing.icon ?? "") !== (next.icon ?? "")
    || !labelsEqual(existing.label, next.label);

  if (changed) {
    catalog[tagId] = next;
  }
  return changed;
}

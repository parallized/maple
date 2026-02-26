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
  // Common worker tags
  frontend: { zh: "前端", en: "Frontend", icon: "mingcute:code-line" },
  backend: { zh: "后端", en: "Backend", icon: "mingcute:server-line" },
  bugfix: { zh: "bug修复", en: "Bugfix", icon: "mingcute:shield-line" },
  refactor: { zh: "重构", en: "Refactor", icon: "mingcute:refresh-2-line" },
  install: { zh: "安装", en: "Install", icon: "mingcute:download-line" },
  docs: { zh: "文档", en: "Docs", icon: "mingcute:information-line" },
  ux: { zh: "UX", en: "UX", icon: "mingcute:palette-line" },
  wsl: { zh: "WSL", en: "WSL", icon: "mingcute:terminal-box-line" },
  cli: { zh: "CLI", en: "CLI", icon: "mingcute:terminal-box-line" },
  api: { zh: "API", en: "API", icon: "mingcute:server-line" },
  test: { zh: "测试", en: "Test", icon: "mingcute:check-line" },
  testing: { zh: "测试", en: "Testing", icon: "mingcute:check-line" },
  config: { zh: "配置", en: "Config", icon: "mingcute:settings-3-line" },
  style: { zh: "样式", en: "Style", icon: "mingcute:palette-line" },
  styles: { zh: "样式", en: "Styles", icon: "mingcute:palette-line" },
  css: { zh: "样式", en: "CSS", icon: "mingcute:palette-line" },
  layout: { zh: "布局", en: "Layout", icon: "mingcute:layout-grid-line" },
  build: { zh: "构建", en: "Build", icon: "mingcute:settings-3-line" },
  database: { zh: "数据库", en: "Database", icon: "mingcute:server-line" },
  db: { zh: "数据库", en: "DB", icon: "mingcute:server-line" },
  animation: { zh: "动画", en: "Animation", icon: "mingcute:palette-line" },
  feature: { zh: "新功能", en: "Feature", icon: "mingcute:add-line" },
  feat: { zh: "新功能", en: "Feat", icon: "mingcute:add-line" },
  enhancement: { zh: "改进", en: "Enhancement", icon: "mingcute:add-line" },
  toolchain: { zh: "工具链", en: "Toolchain", icon: "mingcute:settings-3-line" },
  performance: { zh: "性能", en: "Performance", icon: "mingcute:rocket-line" },
  perf: { zh: "性能", en: "Performance", icon: "mingcute:rocket-line" },
  security: { zh: "安全", en: "Security", icon: "mingcute:shield-line" },
  badge: { zh: "徽章", en: "Badge", icon: "mingcute:tag-line" },
  tray: { zh: "托盘", en: "Tray", icon: "mingcute:layout-grid-line" },
  task: { zh: "任务", en: "Task", icon: "mingcute:task-line" },
  board: { zh: "看板", en: "Board", icon: "mingcute:layout-grid-line" },
  detail: { zh: "详情", en: "Detail", icon: "mingcute:layout-right-line" },
  panel: { zh: "面板", en: "Panel", icon: "mingcute:layout-right-line" },
  prompt: { zh: "提示", en: "Prompt", icon: "mingcute:chat-3-line" },
  worker: { zh: "执行器", en: "Worker", icon: "mingcute:ai-line" },
  tags: { zh: "标签", en: "Tags", icon: "mingcute:tag-line" },
  chore: { zh: "配置", en: "Chore", icon: "mingcute:settings-3-line" },

  // Existing presets
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
    // Only set label.zh when the raw tag contains CJK characters.
    // Pure English tags should NOT get label.zh = English text.
    if (HAS_CJK_RE.test(raw)) {
      label.zh = raw;
    }
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

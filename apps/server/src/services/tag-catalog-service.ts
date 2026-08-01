/**
 * 标签目录注册服务。
 *
 * Leader 规划结束为 Todo 打上标签后，Server 会把标签自动注册到项目级
 * tag_catalog_json（前端以此获得固定的莫兰迪配色与 mingcute 图标）。
 * 同一标签的配色 / 图标由标签 id 哈希确定性分配，重复注册保持不变；
 * 已有的手工注册项（前端设置过 color / icon / label）不会被覆盖。
 */

/** 莫兰迪色系：低饱和、低明度，深浅界面都干净。 */
export const MORANDI_TAG_COLORS = [
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
] as const;

/** 标签可用的 mingcute 图标（与 Web 端生成的 mingcute 子集保持一致）。 */
export const TAG_MINGCUTE_ICONS = [
  "mingcute:tag-line",
  "mingcute:task-line",
  "mingcute:code-line",
  "mingcute:palette-line",
  "mingcute:shield-line",
  "mingcute:robot-line",
  "mingcute:sparkles-line",
  "mingcute:flash-line",
  "mingcute:link-2-line",
  "mingcute:tool-line"
] as const;

function hashTagId(tagId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < tagId.length; i += 1) {
    hash ^= tagId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeTagId(tag: string): string {
  return tag.trim().toLowerCase();
}

/** 版本标签（v1.2.3）由前端按版本样式特判，不进入标签目录。 */
const VERSION_TAG_RE = /^v\d+\.\d+\.\d+$/i;

function parseCatalog(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 目录损坏时按空目录重建，不阻塞标签注册。
  }
  return {};
}

function isRegistered(definition: unknown): boolean {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return false;
  const record = definition as Record<string, unknown>;
  return (
    typeof record.color === "string" && record.color.trim().length > 0
    || typeof record.icon === "string" && record.icon.trim().length > 0
    || typeof record.label === "object" && record.label !== null
  );
}

export interface RegisteredTagCatalog {
  /** 更新后的目录 JSON 字符串，可直接写入 tag_catalog_json。 */
  json: string;
  /** 本次新注册的标签 id（小写）。 */
  added: string[];
}

/**
 * 把标签合并进项目标签目录：
 * 未注册的标签按 id 哈希获得固定的莫兰迪配色与 mingcute 图标；
 * 已注册（含前端手工设置过 color / icon / label）的标签保持不变。
 */
export function registerTagCatalog(
  existingJson: string | null,
  tags: string[]
): RegisteredTagCatalog {
  const catalog = parseCatalog(existingJson);
  const added: string[] = [];
  for (const tag of tags) {
    const id = normalizeTagId(tag);
    if (!id) continue;
    if (VERSION_TAG_RE.test(id)) continue;
    if (isRegistered(catalog[id])) continue;
    catalog[id] = {
      color: MORANDI_TAG_COLORS[hashTagId(id) % MORANDI_TAG_COLORS.length],
      icon: TAG_MINGCUTE_ICONS[hashTagId(id) % TAG_MINGCUTE_ICONS.length]
    };
    added.push(id);
  }
  return { json: JSON.stringify(catalog), added };
}

/** 解析数据库中的 tags_json，非法值一律返回空数组。 */
export function parseStoredTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    return [];
  }
}

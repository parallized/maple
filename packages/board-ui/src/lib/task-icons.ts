import type { Task } from "../domain";
import type { TagCatalog } from "../domain";
import { normalizeTagId, resolveTagDefinition } from "./tag-catalog";

const DEFAULT_TASK_ICON = "mingcute:task-line";
const DEFAULT_TAG_ICON = "mingcute:tag-line";

/** 与服务端标签目录注册一致的 mingcute 图标集（均在 Web 端生成的 mingcute 子集内）。 */
const TAG_ICON_POOL = [
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
];

const KNOWN_MINGCUTE_ICONS = new Set<string>([
  "mingcute:add-line",
  "mingcute:information-line",
  "mingcute:layout-grid-line",
  "mingcute:palette-line",
  "mingcute:plugin-2-line",
  "mingcute:refresh-2-line",
  "mingcute:settings-3-line",
  "mingcute:shield-line",
  "mingcute:tag-line",
  "mingcute:task-line"
]);

type TaskWithIcon = Task & { icon?: string };

function normalizeIconName(icon: string | undefined, fallback: string): string {
  if (!icon) {
    return fallback;
  }
  const normalized = icon.trim().toLowerCase();
  if (!normalized.startsWith("mingcute:")) {
    return fallback;
  }
  return KNOWN_MINGCUTE_ICONS.has(normalized) ? normalized : fallback;
}

function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolveTagIcon(tag: string, tagCatalog?: TagCatalog | null): string {
  const normalizedTag = normalizeTagId(tag);
  if (!normalizedTag) {
    return DEFAULT_TAG_ICON;
  }
  const definedIcon = resolveTagDefinition(normalizedTag, tagCatalog)?.icon?.trim();
  if (definedIcon && definedIcon.toLowerCase().startsWith("mingcute:")) {
    return definedIcon.toLowerCase();
  }
  // 未注册标签按同一哈希从图标集取固定图标，与服务端注册结果一致。
  return TAG_ICON_POOL[hash32(normalizedTag) % TAG_ICON_POOL.length];
}

export function resolveTagIconMeta(tag: string, tagCatalog?: TagCatalog | null): { icon: string; isDefault: boolean } {
  const icon = resolveTagIcon(tag, tagCatalog);
  const definedIcon = resolveTagDefinition(normalizeTagId(tag), tagCatalog)?.icon?.trim();
  // isDefault 表示目录中尚无该标签的图标定义（未注册标签等目录刷新后即拥有固定图标）。
  return { icon, isDefault: !definedIcon };
}

export function resolveTaskIcon(task: Task, tagCatalog?: TagCatalog | null): {
  icon: string;
  isDefault: boolean;
} {
  const explicit = (task as TaskWithIcon).icon;
  if (explicit) {
    const icon = normalizeIconName(explicit, DEFAULT_TASK_ICON);
    return { icon, isDefault: icon === DEFAULT_TASK_ICON };
  }
  if (task.tags.length > 0) {
    const meta = resolveTagIconMeta(task.tags[0], tagCatalog);
    if (meta.isDefault) {
      return { icon: DEFAULT_TASK_ICON, isDefault: true };
    }
    return { icon: meta.icon, isDefault: false };
  }
  return { icon: DEFAULT_TASK_ICON, isDefault: true };
}

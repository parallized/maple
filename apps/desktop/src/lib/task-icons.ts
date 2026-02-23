import type { Task } from "../domain";
import type { TagCatalog } from "../domain";
import { normalizeTagId, resolveTagDefinition } from "./tag-catalog";

const DEFAULT_TASK_ICON = "mingcute:task-line";
const DEFAULT_TAG_ICON = "mingcute:tag-line";

const KNOWN_MINGCUTE_ICONS = new Set<string>([
  "mingcute:add-line",
  "mingcute:information-line",
  "mingcute:layout-grid-line",
  "mingcute:palette-line",
  "mingcute:plug-2-line",
  "mingcute:refresh-2-line",
  "mingcute:settings-3-line",
  "mingcute:shield-line",
  "mingcute:tag-line",
  "mingcute:task-line",
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

export function resolveTagIcon(tag: string, tagCatalog?: TagCatalog | null): string {
  const normalizedTag = normalizeTagId(tag);
  if (!normalizedTag) {
    return DEFAULT_TAG_ICON;
  }
  const definedIcon = resolveTagDefinition(normalizedTag, tagCatalog)?.icon?.trim();
  if (definedIcon && definedIcon.toLowerCase().startsWith("mingcute:")) {
    return definedIcon.toLowerCase();
  }
  return DEFAULT_TAG_ICON;
}

export function resolveTagIconMeta(tag: string, tagCatalog?: TagCatalog | null): { icon: string; isDefault: boolean } {
  const icon = resolveTagIcon(tag, tagCatalog);
  return { icon, isDefault: icon === DEFAULT_TAG_ICON };
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
    const icon = resolveTagIcon(task.tags[0], tagCatalog);
    if (icon === DEFAULT_TAG_ICON) {
      return { icon: DEFAULT_TASK_ICON, isDefault: true };
    }
    return { icon, isDefault: false };
  }
  return { icon: DEFAULT_TASK_ICON, isDefault: true };
}

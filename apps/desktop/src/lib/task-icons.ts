import type { Task } from "../domain";

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

export function resolveTagIcon(tag: string): string {
  const normalizedTag = tag.trim().toLowerCase();
  if (!normalizedTag) {
    return DEFAULT_TAG_ICON;
  }
  if (normalizedTag.startsWith("type:fix")) return "mingcute:shield-line";
  if (normalizedTag.startsWith("type:feat")) return "mingcute:add-line";
  if (normalizedTag.startsWith("type:refactor")) return "mingcute:refresh-2-line";
  if (normalizedTag.startsWith("type:docs")) return "mingcute:information-line";
  if (normalizedTag.startsWith("type:chore")) return "mingcute:settings-3-line";
  if (normalizedTag.startsWith("area:ui")) return "mingcute:palette-line";
  if (normalizedTag.startsWith("area:worker")) return "mingcute:ai-line";
  if (normalizedTag.startsWith("area:mcp")) return "mingcute:server-line";
  if (normalizedTag.startsWith("area:xterm")) return "mingcute:terminal-box-line";
  if (normalizedTag.startsWith("area:i18n")) return "mingcute:translate-line";
  if (normalizedTag.startsWith("area:task-detail")) return "mingcute:layout-right-line";
  if (normalizedTag.startsWith("area:markdown")) return "mingcute:file-text-line";
  if (normalizedTag.startsWith("state:blocked")) return "mingcute:shield-line";
  if (normalizedTag.startsWith("state:needs-info")) return "mingcute:information-line";
  if (normalizedTag.includes("架构")) return "mingcute:layout-grid-line";
  if (normalizedTag.includes("配置")) return "mingcute:settings-3-line";
  if (normalizedTag.includes("ui") || normalizedTag.includes("ux"))
    return "mingcute:palette-line";
  if (normalizedTag.includes("新功能")) return "mingcute:add-line";
  if (normalizedTag.includes("工具链")) return "mingcute:plug-2-line";
  if (normalizedTag.includes("重构")) return "mingcute:refresh-2-line";
  if (normalizedTag.includes("bug") || normalizedTag.includes("修复"))
    return "mingcute:shield-line";
  return DEFAULT_TAG_ICON;
}

export function resolveTaskIcon(task: Task): {
  icon: string;
  isDefault: boolean;
} {
  const explicit = (task as TaskWithIcon).icon;
  if (explicit) {
    const icon = normalizeIconName(explicit, DEFAULT_TASK_ICON);
    return { icon, isDefault: icon === DEFAULT_TASK_ICON };
  }
  if (task.tags.length > 0) {
    return { icon: resolveTagIcon(task.tags[0]), isDefault: false };
  }
  return { icon: DEFAULT_TASK_ICON, isDefault: true };
}

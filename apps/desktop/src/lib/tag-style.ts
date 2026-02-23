import { isVersionTag } from "./task-tags";

type TagColorRule = {
  test: (normalized: string) => boolean;
  color: string;
};

const TAG_COLOR_RULES: TagColorRule[] = [
  { test: (tag) => tag === "type:fix", color: "var(--color-error)" },
  { test: (tag) => tag === "type:feat", color: "var(--color-success)" },
  { test: (tag) => tag === "type:refactor", color: "#a855f7" },
  { test: (tag) => tag === "type:docs", color: "#3b82f6" },
  { test: (tag) => tag === "type:chore", color: "#64748b" },

  { test: (tag) => tag === "area:core", color: "#6366f1" },
  { test: (tag) => tag === "area:ui", color: "#ec4899" },
  { test: (tag) => tag === "area:task-detail", color: "var(--color-primary)" },
  { test: (tag) => tag === "area:markdown", color: "#10b981" },
  { test: (tag) => tag === "area:worker", color: "#f59e0b" },
  { test: (tag) => tag === "area:mcp", color: "#22c55e" },
  { test: (tag) => tag === "area:xterm", color: "#0ea5e9" },
  { test: (tag) => tag === "area:i18n", color: "#a3e635" },

  { test: (tag) => tag === "state:blocked", color: "var(--color-error)" },
  { test: (tag) => tag === "state:needs-info", color: "var(--color-warning)" },
];

export function resolveTagColor(tag: string): string | null {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return null;
  if (isVersionTag(normalized)) return "var(--color-primary)";

  const rule = TAG_COLOR_RULES.find((entry) => entry.test(normalized));
  return rule?.color ?? null;
}

export function buildTagBadgeStyle(tag: string): Record<string, string> {
  const color = resolveTagColor(tag);
  if (!color) return {};
  return { "--tag-color": color };
}


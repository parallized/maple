import type { TagCatalog, TagDefinition } from "../domain";

export function normalizeTagId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTagLabel(value: unknown): TagDefinition["label"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const zh = typeof record.zh === "string" ? record.zh.trim() : "";
  const en = typeof record.en === "string" ? record.en.trim() : "";
  const label: TagDefinition["label"] = {};
  if (zh) label.zh = zh;
  if (en) label.en = en;
  return Object.keys(label).length > 0 ? label : undefined;
}

function normalizeTagDefinition(value: unknown): TagDefinition {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const color = typeof record.color === "string" ? record.color.trim() : "";
  const icon = typeof record.icon === "string" ? record.icon.trim() : "";
  const label = normalizeTagLabel(record.label);
  return {
    ...(color ? { color } : {}),
    ...(icon ? { icon } : {}),
    ...(label ? { label } : {}),
  };
}

export function normalizeTagCatalog(value: unknown): TagCatalog {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const catalog: TagCatalog = {};
  for (const [rawId, rawDef] of Object.entries(record)) {
    const id = normalizeTagId(rawId);
    if (!id) continue;
    catalog[id] = normalizeTagDefinition(rawDef);
  }
  return catalog;
}

export function resolveTagDefinition(tag: string, catalog: TagCatalog | null | undefined): TagDefinition | null {
  const id = normalizeTagId(tag);
  if (!id) return null;
  const definition = catalog?.[id];
  return definition ?? null;
}


export type NeedsInfoFieldType = "text" | "textarea" | "select";

export type NeedsInfoFormOption = {
  label: string;
  value: string;
};

export type NeedsInfoFormField = {
  id: string;
  label: string;
  type?: NeedsInfoFieldType;
  required?: boolean;
  placeholder?: string;
  options?: NeedsInfoFormOption[];
};

export type NeedsInfoFormSchema = {
  version?: number;
  title?: string;
  fields: NeedsInfoFormField[];
};

export type NeedsInfoFormParseResult = {
  schema: NeedsInfoFormSchema;
  contentWithoutSchema: string;
};

const FORM_BLOCK_PATTERN = /```[ \t]*([^\n]*)\n([\s\S]*?)\n```/gi;

function normalizeFieldType(input: unknown): NeedsInfoFieldType {
  if (input === "textarea" || input === "select") return input;
  return "text";
}

function normalizeOptions(input: unknown): NeedsInfoFormOption[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const options: NeedsInfoFormOption[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const value = typeof record.value === "string" ? record.value.trim() : "";
    if (!label || !value) continue;
    options.push({ label, value });
  }
  return options.length > 0 ? options : undefined;
}

function normalizeSchema(input: unknown): NeedsInfoFormSchema | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const version = typeof record.version === "number" ? record.version : undefined;
  const title = typeof record.title === "string" ? record.title.trim() : undefined;
  const fieldsRaw = record.fields;
  if (!Array.isArray(fieldsRaw)) return null;

  const fields: NeedsInfoFormField[] = [];
  for (const raw of fieldsRaw) {
    if (!raw || typeof raw !== "object") continue;
    const field = raw as Record<string, unknown>;
    const id = typeof field.id === "string" ? field.id.trim() : "";
    const label = typeof field.label === "string" ? field.label.trim() : "";
    if (!id || !label) continue;
    const type = normalizeFieldType(field.type);
    const required = Boolean(field.required);
    const placeholder = typeof field.placeholder === "string" ? field.placeholder : undefined;
    const options = normalizeOptions(field.options);
    fields.push({ id, label, type, required, placeholder, options });
  }

  if (fields.length === 0) return null;
  return { version, title, fields };
}

function normalizeFenceLanguage(raw: string): string {
  return raw.trim().split(/\s+/)[0]?.trim().toLowerCase() ?? "";
}

export function parseNeedsInfoFormFromReport(content: string): NeedsInfoFormParseResult | null {
  if (!content) return null;

  for (const match of content.matchAll(FORM_BLOCK_PATTERN)) {
    const full = match[0] ?? "";
    const langRaw = match[1] ?? "";
    const body = match[2] ?? "";
    if (!full || !langRaw) continue;

    const lang = normalizeFenceLanguage(langRaw);
    if (lang !== "maple-needs-info") continue;

    const trimmed = body.trim();
    if (!trimmed) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }

    const schema = normalizeSchema(parsed);
    if (!schema) return null;

    const index = match.index ?? content.indexOf(full);
    const contentWithoutSchema =
      index >= 0
        ? `${content.slice(0, index).trimEnd()}\n\n${content.slice(index + full.length).trimStart()}`.trim()
        : content;

    return { schema, contentWithoutSchema };
  }

  return null;
}

export function buildNeedsInfoAppendixMarkdown(
  schema: NeedsInfoFormSchema,
  answers: Record<string, string>,
  now: Date
): string {
  const lines: string[] = [];
  lines.push("## 补充信息（来自表单）");
  lines.push("");

  for (const field of schema.fields) {
    const value = (answers[field.id] ?? "").replace(/\r\n/g, "\n").trim();
    if (!value) continue;
    const valueLines = value.split("\n");
    if (valueLines.length === 1) {
      lines.push(`- ${field.label}: ${valueLines[0]}`);
      continue;
    }
    lines.push(`- ${field.label}:`);
    for (const line of valueLines) {
      lines.push(`  ${line}`);
    }
  }

  lines.push("");
  lines.push(`> 填写时间：${now.toLocaleString()}`);
  return lines.join("\n").trim();
}


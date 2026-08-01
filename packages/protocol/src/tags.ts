import type { AiOutputLanguage } from "./models";

/** 任务标签原则上不超过 3 个。 */
export const MAX_TODO_TAGS = 3;

/** 单个标签长度上限（防止 Leader 输出超长文本）。 */
export const MAX_TAG_LENGTH = 40;

const HAS_CJK_RE = /[\u3400-\u9FFF]/;
const HAS_LATIN_RE = /[A-Za-z]/;

/**
 * 推断标签应使用的语言：
 * - 设置明确 zh / en 时直接采用；
 * - follow_ui（默认）时根据 Todo 正文判断，出现中文按中文处理，否则按英文。
 */
export function resolveTagLanguage(
  settingsLanguage: AiOutputLanguage | null | undefined,
  sampleText: string
): "zh" | "en" | null {
  if (settingsLanguage === "zh" || settingsLanguage === "en") return settingsLanguage;
  return HAS_CJK_RE.test(sampleText) ? "zh" : "en";
}

/** 单个标签是否与目标语言匹配：中文用户不看到英文标签，反之亦然。 */
function tagMatchesLanguage(tag: string, language: "zh" | "en"): boolean {
  if (language === "zh") {
    return HAS_CJK_RE.test(tag) || !HAS_LATIN_RE.test(tag);
  }
  return HAS_LATIN_RE.test(tag) || !HAS_CJK_RE.test(tag);
}

function cleanTag(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TAG_LENGTH) : "";
}

/**
 * 规整 Leader / 用户提交的标签：
 * 只保留字符串、去首尾空白、按大小写去重、按语言过滤，并截断到 max 个。
 */
export function normalizeTodoTags(
  value: unknown,
  options: { language?: "zh" | "en" | null; max?: number } = {}
): string[] {
  const max = Math.max(0, Math.floor(options.max ?? MAX_TODO_TAGS));
  const result: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(value)) return result;
  for (const item of value) {
    const tag = cleanTag(item);
    if (!tag) continue;
    if (options.language && !tagMatchesLanguage(tag, options.language)) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= max) break;
  }
  return result;
}

/**
 * 合并 Leader 生成标签与既有标签（Leader 在前，既有标签保留原样、不去做语言过滤），
 * 去重后截断到 max 个；生成标签为空时原样返回既有标签的规整结果。
 */
export function mergeTodoTags(
  existing: string[],
  generated: string[] | undefined,
  options: { language?: "zh" | "en" | null; max?: number } = {}
): string[] {
  const max = Math.max(0, Math.floor(options.max ?? MAX_TODO_TAGS));
  const result = normalizeTodoTags(generated, { language: options.language, max });
  const seen = new Set(result.map((tag) => tag.toLowerCase()));
  for (const item of existing) {
    if (result.length >= max) break;
    const tag = cleanTag(item);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

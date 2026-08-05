import type { UiLanguage } from "./constants";

/**
 * 展示层标签排序：同一批标签在任意任务上都按固定顺序显示，
 * 避免出现「界面 ui调整」与「ui调整 界面」这种跨任务混排。
 * 排序基于当前界面语言做确定性比较（中文按拼音，英文按字母序），
 * 相等项保持原顺序（Array.prototype.sort 稳定）。
 */
export function sortTagsForDisplay(tags: string[], language: UiLanguage): string[] {
  if (tags.length < 2) return tags;
  const locale = language === "zh" ? "zh" : "en";
  return [...tags].sort((left, right) => left.localeCompare(right, locale));
}

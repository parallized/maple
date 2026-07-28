import type { Project } from "../domain";

function normalizeTokenNumber(raw: string, unitRaw: string | undefined): number {
  const base = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(base)) return 0;
  const unit = (unitRaw ?? "").trim().toLowerCase();
  if (unit === "k") return base * 1_000;
  if (unit === "m") return base * 1_000_000;
  if (unit === "b") return base * 1_000_000_000;
  return base;
}

export function extractTokenUsageFromText(text: string): number {
  if (!text) return 0;
  let total = 0;
  const tokenAfterNumber = /(\d[\d,]*(?:\.\d+)?)\s*([kmb])?\s*(?:tokens?|token)\b/gi;
  for (const match of text.matchAll(tokenAfterNumber)) {
    total += normalizeTokenNumber(match[1] ?? "", match[2]);
  }
  const tokenAfterLabel = /(?:tokens?|token)\s*[:=]\s*(\d[\d,]*(?:\.\d+)?)(?:\s*([kmb]))?/gi;
  for (const match of text.matchAll(tokenAfterLabel)) {
    total += normalizeTokenNumber(match[1] ?? "", match[2]);
  }
  return Math.round(total);
}

export function collectTokenUsage(projects: Project[], logs: Record<string, string>): number {
  let total = 0;
  for (const project of projects) {
    for (const task of project.tasks) {
      for (const report of task.reports) {
        total += extractTokenUsageFromText(report.content);
      }
    }
  }
  for (const log of Object.values(logs)) {
    total += extractTokenUsageFromText(log);
  }
  return total;
}

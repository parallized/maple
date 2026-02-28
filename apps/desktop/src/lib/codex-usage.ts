export type CodexUsageConfig = {
  baseUrl: string;
  apiKey: string;
};

export const DEFAULT_CODEX_USAGE_CONFIG: CodexUsageConfig = {
  baseUrl: "",
  apiKey: "",
};

export function normalizeCodexUsageConfig(input: unknown): CodexUsageConfig {
  if (!input || typeof input !== "object") return DEFAULT_CODEX_USAGE_CONFIG;
  const record = input as Partial<Record<keyof CodexUsageConfig, unknown>>;
  const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  return { baseUrl, apiKey };
}

export type CodexUsageQuotaInvalid = {
  isValid: false;
  invalidCode: string;
  invalidMessage: string;
};

export type CodexUsageQuotaValid = {
  isValid: true;
  remaining?: number;
  unit: string;
  planName: string;
  extra: string;
};

export type CodexUsageQuota = CodexUsageQuotaInvalid | CodexUsageQuotaValid;

export function extractCodexUsageQuota(response: unknown): CodexUsageQuota {
  const r = response as any;
  const err = r && r.error;
  const invalidCode = typeof r?.invalidCode === "string" ? r.invalidCode : null;
  const invalidMessage =
    typeof r?.invalidMessage === "string" && r.invalidMessage
      ? r.invalidMessage
      : typeof err === "string"
        ? err
        : err && typeof err.message === "string"
          ? err.message
          : "";

  const isValid = !err && r?.isValid !== false && invalidCode !== "NO_QUOTA";
  const unit = typeof r?.unit === "string" && r.unit ? r.unit : "USD";
  const subscriptions = Array.isArray(r?.subscriptions) ? r.subscriptions : [];

  if (!isValid) {
    return {
      isValid: false,
      invalidCode: invalidCode || "NO_QUOTA",
      invalidMessage: invalidMessage || "No available quota",
    };
  }

  const remainingFromTop = Number(r?.remaining);
  const balance = Number(r?.balance);
  const planRemaining = Number(r?.plan_remaining);
  const remaining = Number.isFinite(remainingFromTop)
    ? remainingFromTop
    : Number.isFinite(balance) && Number.isFinite(planRemaining)
      ? balance + planRemaining
      : Number.NaN;

  const todayLimit = r?.todayLimit;
  const todayRemaining = r?.todayRemaining;
  const todayRemainingWithCarryover = r?.todayRemainingWithCarryover;

  const planLines = subscriptions
    .map((sub: any) => {
      const name =
        typeof sub?.planName === "string" && sub.planName
          ? sub.planName
          : sub?.planId || "未知套餐";
      const remainingToday = Number(sub?.todayRemainingWithCarryover);
      return `${name}:${Number.isFinite(remainingToday) ? remainingToday : "-"}${unit}`;
    })
    .slice(0, 3)
    .join(" | ");

  return {
    isValid: true,
    remaining: Number.isFinite(remaining) ? remaining : undefined,
    unit,
    planName: r?.planName || "套餐+余额",
    extra:
      `今日额度: ${todayLimit ?? "-"} ${unit} · 今日剩余: ${todayRemaining ?? "-"} ${unit} · ` +
      `含转结剩余: ${todayRemainingWithCarryover ?? "-"} ${unit} · 套餐数: ${subscriptions.length}` +
      (planLines ? ` · ${planLines}` : ""),
  };
}

export function formatCodexUsageAmount(amount: number, unit: string): string {
  const normalizedUnit = (unit ?? "").trim() || "USD";
  if (!Number.isFinite(amount)) return `- ${normalizedUnit}`;
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} ${normalizedUnit}`;
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 构造只存在于本次执行内存中的脱敏器，防止 Provider 错误回显密钥或掩码尾号。 */
export function createSecretRedactor(secrets: Array<string | null | undefined>): (value: string) => string {
  const values = [...new Set(secrets.map((secret) => secret?.trim()).filter((secret): secret is string => Boolean(secret)))];
  const maskedPatterns = values
    .filter((secret) => secret.length >= 4)
    .map((secret) => new RegExp(`\\*{2,}${escapeRegExp(secret.slice(-4))}`, "gi"));

  return (source: string): string => {
    let value = source;
    for (const secret of values) value = value.split(secret).join("[REDACTED]");
    for (const pattern of maskedPatterns) value = value.replace(pattern, "[REDACTED]");
    return value.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
  };
}

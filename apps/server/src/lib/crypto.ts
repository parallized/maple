import { randomBytes } from "node:crypto";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function hashSecret(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

export function createSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createPairingCode(): string {
  const bytes = randomBytes(8);
  let value = "";
  for (const byte of bytes) value += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

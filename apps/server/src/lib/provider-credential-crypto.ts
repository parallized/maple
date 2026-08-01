import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import type { ServerConfig } from "../config";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const FORMAT_VERSION = "v1";

function decodeKey(value: string): Buffer {
  const text = value.trim();
  const key = /^[a-f\d]{64}$/i.test(text)
    ? Buffer.from(text, "hex")
    : /^[A-Za-z\d_-]{43}$/.test(text)
      ? Buffer.from(text, "base64url")
      : Buffer.alloc(0);
  if (key.byteLength !== KEY_BYTES) {
    throw new Error("MAPLE_PROVIDER_CREDENTIAL_KEY 必须是 32 字节的 base64url 或 64 位十六进制值。");
  }
  return key;
}

function readKeyFile(path: string): Buffer {
  return decodeKey(readFileSync(path, "utf8"));
}

function loadOrCreateKey(path: string): Buffer {
  try {
    return readKeyFile(path);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const generated = randomBytes(KEY_BYTES);
  try {
    writeFileSync(path, `${generated.toString("base64url")}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    return readKeyFile(path);
  }
  try { chmodSync(path, 0o600); } catch { /* Windows ACLs are managed by the current user profile. */ }
  return generated;
}

export function loadProviderCredentialKey(config: ServerConfig): Buffer {
  if (config.providerCredentialEncryptionKey) return decodeKey(config.providerCredentialEncryptionKey);
  return loadOrCreateKey(join(config.dataDir, "secrets", "provider-credentials.key"));
}

function additionalData(workspaceId: string, provider: string): Buffer {
  return Buffer.from(`maple-provider-credential\0${workspaceId}\0${provider}`, "utf8");
}

/** AES-256-GCM envelope with workspace/provider binding to prevent ciphertext swapping. */
export class ProviderCredentialCipher {
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (key.byteLength !== KEY_BYTES) throw new Error("Provider 凭据加密密钥必须是 32 字节。");
    this.key = Buffer.from(key);
  }

  encrypt(workspaceId: string, provider: string, secret: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(additionalData(workspaceId, provider));
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [FORMAT_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")]
      .join(".");
  }

  decrypt(workspaceId: string, provider: string, envelope: string): string {
    const [version, ivText, tagText, ciphertextText, ...extra] = envelope.split(".");
    if (version !== FORMAT_VERSION || !ivText || !tagText || !ciphertextText || extra.length > 0) {
      throw new Error("Provider 凭据密文格式无效。");
    }
    const iv = Buffer.from(ivText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    const ciphertext = Buffer.from(ciphertextText, "base64url");
    if (iv.byteLength !== IV_BYTES || tag.byteLength !== 16 || ciphertext.byteLength === 0) {
      throw new Error("Provider 凭据密文格式无效。");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(additionalData(workspaceId, provider));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}

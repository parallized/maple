import type { DeepSeekConnectionStatus } from "@maple/protocol";
import {
  normalizeDeepSeekApiKey,
  ProviderCredentialServiceError,
  validateDeepSeekApiKey,
  type DeepSeekCredentialFetcher,
  type ProviderCredentialService
} from "@maple/server/standalone";
import {
  deleteWindowsCredential,
  isWindowsCredentialManagerSupported,
  readWindowsCredential,
  writeWindowsCredential
} from "./windows-credential-manager";

export const DEEPSEEK_CREDENTIAL_TARGET = "Maple/Providers/DeepSeek";
let credentialRevision = 0;

export interface DeepSeekCredentialStore {
  supported(): boolean;
  read(): string | null;
  write(secret: string): void;
  delete(): boolean;
}

const windowsCredentialStore: DeepSeekCredentialStore = {
  supported: isWindowsCredentialManagerSupported,
  read: () => readWindowsCredential(DEEPSEEK_CREDENTIAL_TARGET),
  write: (secret) => writeWindowsCredential(DEEPSEEK_CREDENTIAL_TARGET, secret),
  delete: () => deleteWindowsCredential(DEEPSEEK_CREDENTIAL_TARGET)
};

function environmentKey(env: Record<string, string | undefined>): string | null {
  return env.DEEPSEEK_API_KEY?.trim() || null;
}

export function deepSeekCredentialRevision(): number {
  return credentialRevision;
}

export function readDeepSeekApiKey(
  env: Record<string, string | undefined> = process.env
): string | null {
  const fromEnvironment = environmentKey(env);
  if (fromEnvironment) return fromEnvironment;
  if (!isWindowsCredentialManagerSupported()) return null;
  return readWindowsCredential(DEEPSEEK_CREDENTIAL_TARGET)?.trim() || null;
}

export function isDeepSeekConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  try {
    return readDeepSeekApiKey(env) !== null;
  } catch {
    return false;
  }
}

export function createDeepSeekProviderCredentialService(
  options: {
    env?: Record<string, string | undefined>;
    fetcher?: DeepSeekCredentialFetcher;
    credentialStore?: DeepSeekCredentialStore;
  } = {}
): ProviderCredentialService {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const credentialStore = options.credentialStore ?? windowsCredentialStore;

  const status = async (): Promise<DeepSeekConnectionStatus> => {
    if (environmentKey(env)) {
      return {
        provider: "deepseek",
        supported: true,
        configured: true,
        source: "environment",
        message: "凭据由 Runner 环境管理。"
      };
    }
    if (!credentialStore.supported()) {
      return {
        provider: "deepseek",
        supported: false,
        configured: false,
        source: "unavailable",
        message: "当前 Runner 暂不支持系统凭据存储。"
      };
    }
    let configured = false;
    try {
      configured = Boolean(credentialStore.read()?.trim());
    } catch {
      return {
        provider: "deepseek",
        supported: true,
        configured: false,
        source: "windows_credential_manager",
        message: "无法读取 Windows 凭据管理器。"
      };
    }
    return {
      provider: "deepseek",
      supported: true,
      configured,
      source: "windows_credential_manager",
      message: configured ? "凭据已安全保存在此 Windows 用户下。" : null
    };
  };

  return {
    deepSeekStatus: status,
    async connectDeepSeek(_scope, rawApiKey) {
      if (environmentKey(env)) {
        throw new ProviderCredentialServiceError(
          409,
          "deepseek_environment_managed",
          "当前凭据由 Runner 环境管理，无法在 Maple 中替换。"
        );
      }
      if (!credentialStore.supported()) {
        throw new ProviderCredentialServiceError(
          409,
          "credential_store_unavailable",
          "当前 Runner 暂不支持系统凭据存储。"
        );
      }
      const apiKey = normalizeDeepSeekApiKey(rawApiKey);
      await validateDeepSeekApiKey(apiKey, fetcher);
      try {
        credentialStore.write(apiKey);
      } catch {
        throw new ProviderCredentialServiceError(
          500,
          "credential_store_failed",
          "无法写入 Windows 凭据管理器。"
        );
      }
      credentialRevision += 1;
      return status();
    },
    async disconnectDeepSeek() {
      if (environmentKey(env)) {
        throw new ProviderCredentialServiceError(
          409,
          "deepseek_environment_managed",
          "当前凭据由 Runner 环境管理，请在 Runner 环境中移除。"
        );
      }
      if (credentialStore.supported()) {
        try {
          credentialStore.delete();
        } catch {
          throw new ProviderCredentialServiceError(
            500,
            "credential_delete_failed",
            "无法从 Windows 凭据管理器移除凭据。"
          );
        }
      }
      credentialRevision += 1;
      return status();
    },
    async readDeepSeekApiKey() {
      try {
        return readDeepSeekApiKey(env);
      } catch {
        throw new ProviderCredentialServiceError(
          500,
          "credential_read_failed",
          "无法读取当前设备的 DeepSeek 凭据。"
        );
      }
    }
  };
}

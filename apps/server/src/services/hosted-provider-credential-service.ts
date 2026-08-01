import type { Database } from "bun:sqlite";
import type { DeepSeekConnectionStatus } from "@maple/protocol";
import type { ServerConfig } from "../config";
import {
  loadProviderCredentialKey,
  ProviderCredentialCipher
} from "../lib/provider-credential-crypto";
import { ProviderCredentialRepository } from "../repositories/provider-credential-repository";
import {
  normalizeDeepSeekApiKey,
  ProviderCredentialServiceError,
  validateDeepSeekApiKey,
  type DeepSeekCredentialFetcher,
  type ProviderCredentialScope,
  type ProviderCredentialService
} from "./provider-credential-service";

export interface HostedProviderCredentialServiceOptions {
  fetcher?: DeepSeekCredentialFetcher;
  encryptionKey?: Uint8Array;
}

/** Hosted Provider credentials are isolated per workspace and encrypted before SQLite persistence. */
export function createHostedProviderCredentialService(
  database: Database,
  config: ServerConfig,
  options: HostedProviderCredentialServiceOptions = {}
): ProviderCredentialService {
  const repository = new ProviderCredentialRepository(database);
  const environmentApiKey = config.deepSeekApiKey?.trim() || null;
  const fetcher = options.fetcher ?? fetch;
  let cipher: ProviderCredentialCipher | null = options.encryptionKey
    ? new ProviderCredentialCipher(options.encryptionKey)
    : null;
  const credentialCipher = () => {
    cipher ??= new ProviderCredentialCipher(loadProviderCredentialKey(config));
    return cipher;
  };

  const status = async (scope: ProviderCredentialScope): Promise<DeepSeekConnectionStatus> => {
    if (environmentApiKey) {
      return {
        provider: "deepseek",
        supported: true,
        configured: true,
        source: "environment",
        message: "凭据由云端 Server 环境管理。"
      };
    }
    const configured = repository.has(scope.workspaceId, "deepseek");
    return {
      provider: "deepseek",
      supported: true,
      configured,
      source: "server_encrypted",
      message: configured ? "凭据已由云端 Server 加密保存。" : null
    };
  };

  return {
    deepSeekStatus: status,
    async connectDeepSeek(scope, rawApiKey) {
      if (environmentApiKey) {
        throw new ProviderCredentialServiceError(
          409,
          "deepseek_environment_managed",
          "当前凭据由云端 Server 环境管理，无法在 Maple 中替换。"
        );
      }
      const apiKey = normalizeDeepSeekApiKey(rawApiKey);
      await validateDeepSeekApiKey(apiKey, fetcher);
      const encrypted = credentialCipher().encrypt(scope.workspaceId, "deepseek", apiKey);
      repository.write(scope.workspaceId, "deepseek", encrypted);
      return status(scope);
    },
    async disconnectDeepSeek(scope) {
      if (environmentApiKey) {
        throw new ProviderCredentialServiceError(
          409,
          "deepseek_environment_managed",
          "当前凭据由云端 Server 环境管理，请从部署环境中移除。"
        );
      }
      repository.remove(scope.workspaceId, "deepseek");
      return status(scope);
    },
    async readDeepSeekApiKey(scope) {
      if (environmentApiKey) return environmentApiKey;
      const encrypted = repository.read(scope.workspaceId, "deepseek");
      if (!encrypted) return null;
      try {
        return credentialCipher().decrypt(scope.workspaceId, "deepseek", encrypted).trim() || null;
      } catch {
        throw new ProviderCredentialServiceError(
          500,
          "credential_decryption_failed",
          "云端 DeepSeek 凭据无法解密，请重新连接。"
        );
      }
    }
  };
}

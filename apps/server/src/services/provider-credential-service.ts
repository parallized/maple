import type { DeepSeekConnectionStatus } from "@maple/protocol";

/**
 * Server 只依赖这个窄接口。Maple Local 由同进程 Runner 注入实现；Hosted Server
 * 不提供实现，因此不会接收、转存或记录 Provider 密钥。
 */
export interface ProviderCredentialService {
  deepSeekStatus(): Promise<DeepSeekConnectionStatus>;
  connectDeepSeek(apiKey: string): Promise<DeepSeekConnectionStatus>;
  disconnectDeepSeek(): Promise<DeepSeekConnectionStatus>;
}

export class ProviderCredentialServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProviderCredentialServiceError";
  }
}

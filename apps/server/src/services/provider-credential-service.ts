import type { DeepSeekConnectionStatus } from "@maple/protocol";
import { resolveFetchProxyUrl } from "../network/system-proxy";

export interface ProviderCredentialScope {
  workspaceId: string;
}

/** Server 通过这个窄接口隔离 Local 系统凭据与 Hosted 加密凭据的实现。 */
export interface ProviderCredentialService {
  deepSeekStatus(scope: ProviderCredentialScope): Promise<DeepSeekConnectionStatus>;
  connectDeepSeek(scope: ProviderCredentialScope, apiKey: string): Promise<DeepSeekConnectionStatus>;
  disconnectDeepSeek(scope: ProviderCredentialScope): Promise<DeepSeekConnectionStatus>;
  /** 只供已认证 Runner 的任务领取响应使用，绝不提供给浏览器状态接口。 */
  readDeepSeekApiKey(scope: ProviderCredentialScope): Promise<string | null>;
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

export type DeepSeekCredentialFetcher = (
  input: string | URL | Request,
  init?: BunFetchRequestInit
) => Promise<Response>;

const DEEPSEEK_MODELS_ENDPOINT = "https://api.deepseek.com/models";
const CONNECTION_TIMEOUT_MS = 15_000;

export function normalizeDeepSeekApiKey(rawApiKey: string): string {
  const apiKey = rawApiKey.trim();
  if (!apiKey.startsWith("sk-") || apiKey.length < 8 || apiKey.length > 512) {
    throw new ProviderCredentialServiceError(
      422,
      "deepseek_api_key_invalid",
      "请输入以 sk- 开头的 DeepSeek API Key。"
    );
  }
  return apiKey;
}

export async function validateDeepSeekApiKey(
  apiKey: string,
  fetcher: DeepSeekCredentialFetcher = fetch
): Promise<void> {
  let response: Response;
  try {
    const request: BunFetchRequestInit = {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS)
    };
    const proxy = resolveFetchProxyUrl(DEEPSEEK_MODELS_ENDPOINT);
    if (proxy) request.proxy = proxy;
    response = await fetcher(DEEPSEEK_MODELS_ENDPOINT, request);
  } catch {
    throw new ProviderCredentialServiceError(
      503,
      "deepseek_unreachable",
      "无法连接 DeepSeek，请检查网络后重试。"
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new ProviderCredentialServiceError(
      422,
      "deepseek_api_key_invalid",
      "API Key 无效，请确认后重新输入。"
    );
  }
  if (!response.ok) {
    throw new ProviderCredentialServiceError(
      502,
      "deepseek_validation_failed",
      `DeepSeek 暂时无法验证凭据（HTTP ${response.status}）。`
    );
  }
}

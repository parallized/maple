import { describe, expect, it } from "bun:test";
import {
  createDeepSeekProviderCredentialService,
  type DeepSeekCredentialStore
} from "../src/credentials/deepseek";
import {
  deleteWindowsCredential,
  isWindowsCredentialManagerSupported,
  readWindowsCredential,
  writeWindowsCredential
} from "../src/credentials/windows-credential-manager";

function memoryStore(initial: string | null = null): DeepSeekCredentialStore & { value(): string | null } {
  let secret = initial;
  return {
    supported: () => true,
    read: () => secret,
    write: (value) => { secret = value; },
    delete: () => {
      const existed = secret !== null;
      secret = null;
      return existed;
    },
    value: () => secret
  };
}

describe("DeepSeek Provider credentials", () => {
  it("round-trips a temporary secret through Windows Credential Manager", () => {
    if (!isWindowsCredentialManagerSupported()) return;
    const target = `Maple/Tests/DeepSeek/${crypto.randomUUID()}`;
    const secret = `sk-maple-test-${crypto.randomUUID()}-密钥`;
    try {
      writeWindowsCredential(target, secret);
      expect(readWindowsCredential(target)).toBe(secret);
    } finally {
      deleteWindowsCredential(target);
    }
    expect(readWindowsCredential(target)).toBeNull();
  });

  it("rejects malformed keys before any network or credential-store write", async () => {
    const store = memoryStore();
    let fetched = false;
    const service = createDeepSeekProviderCredentialService({
      env: {},
      credentialStore: store,
      fetcher: async () => {
        fetched = true;
        return new Response(null, { status: 200 });
      }
    });

    await expect(service.connectDeepSeek("not-a-key")).rejects.toMatchObject({
      status: 422,
      code: "deepseek_api_key_invalid"
    });
    expect(fetched).toBe(false);
    expect(store.value()).toBeNull();
  });

  it("maps rejected authentication to a product error and does not save the key", async () => {
    const store = memoryStore();
    const service = createDeepSeekProviderCredentialService({
      env: {},
      credentialStore: store,
      fetcher: async () => new Response(null, { status: 401 })
    });

    await expect(service.connectDeepSeek("sk-invalid-deepseek-key")).rejects.toMatchObject({
      status: 422,
      code: "deepseek_api_key_invalid"
    });
    expect(store.value()).toBeNull();
  });

  it("validates, saves and removes a key without returning its value", async () => {
    const store = memoryStore();
    const apiKey = "sk-valid-deepseek-key";
    const service = createDeepSeekProviderCredentialService({
      env: {},
      credentialStore: store,
      fetcher: async (input, init) => {
        expect(String(input)).toBe("https://api.deepseek.com/models");
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${apiKey}`);
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const connected = await service.connectDeepSeek(apiKey);
    expect(store.value()).toBe(apiKey);
    expect(connected).toEqual({
      provider: "deepseek",
      supported: true,
      configured: true,
      source: "windows_credential_manager",
      message: "凭据已安全保存在此 Windows 用户下。"
    });
    expect(JSON.stringify(connected)).not.toContain(apiKey);

    const disconnected = await service.disconnectDeepSeek();
    expect(store.value()).toBeNull();
    expect(disconnected.configured).toBe(false);
  });

  it("treats DEEPSEEK_API_KEY as environment-managed and never overwrites it", async () => {
    const store = memoryStore();
    const service = createDeepSeekProviderCredentialService({
      env: { DEEPSEEK_API_KEY: "sk-from-environment" },
      credentialStore: store
    });

    expect(await service.deepSeekStatus()).toMatchObject({
      configured: true,
      source: "environment"
    });
    await expect(service.connectDeepSeek("sk-replacement-key")).rejects.toMatchObject({
      status: 409,
      code: "deepseek_environment_managed"
    });
    await expect(service.disconnectDeepSeek()).rejects.toMatchObject({
      status: 409,
      code: "deepseek_environment_managed"
    });
    expect(store.value()).toBeNull();
  });
});

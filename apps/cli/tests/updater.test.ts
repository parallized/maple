import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyCliUpdate,
  fetchLatestCliVersion,
  isNewerVersion,
  managedCliPath,
  updateHintText
} from "../src/update/updater";

const originalCliHome = process.env.MAPLE_CLI_HOME;

afterEach(() => {
  if (originalCliHome === undefined) delete process.env.MAPLE_CLI_HOME;
  else process.env.MAPLE_CLI_HOME = originalCliHome;
});

describe("cli updater version comparison", () => {
  it("treats equal versions as not newer", () => {
    expect(isNewerVersion("0.2.3", "0.2.3")).toBe(false);
    expect(isNewerVersion("0.2.3", "v0.2.3")).toBe(false);
  });

  it("detects newer patch / minor / major versions", () => {
    expect(isNewerVersion("0.2.3", "0.2.4")).toBe(true);
    expect(isNewerVersion("0.2.3", "0.3.0")).toBe(true);
    expect(isNewerVersion("0.2.3", "1.0.0")).toBe(true);
    expect(isNewerVersion("v0.2.3", "0.2.10")).toBe(true);
  });

  it("treats older or malformed versions as not newer", () => {
    expect(isNewerVersion("0.2.3", "0.2.2")).toBe(false);
    expect(isNewerVersion("0.2.3", "0.2")).toBe(false);
    expect(isNewerVersion("0.2.3", "abc")).toBe(false);
  });
});

describe("cli updater install path", () => {
  it("resolves the managed install under MAPLE_CLI_HOME", () => {
    process.env.MAPLE_CLI_HOME = "C:\\Users\\test\\.maple";
    expect(managedCliPath()).toBe("C:\\Users\\test\\.maple\\bin\\maple-cli.js");
  });
});

describe("cli updater hint", () => {
  it("renders the productized update hint", () => {
    expect(updateHintText("0.3.0")).toBe("按 CTRL + U 更新 至 v0.3.0，CTRL + P 忽略本次更新");
  });
});

describe("cli updater network flow", () => {
  function fakeServer(cliBytes: Uint8Array, version = "0.3.0") {
    return Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/downloads/maple-cli-version.json") {
          return Response.json({ version });
        }
        if (url.pathname === "/downloads/maple-cli.js") {
          return new Response(cliBytes as BodyInit);
        }
        return new Response(null, { status: 404 });
      }
    });
  }

  it("reads the latest version from the server manifest", async () => {
    const server = fakeServer(new Uint8Array(20_000));
    try {
      expect(await fetchLatestCliVersion(String(server.url))).toBe("0.3.0");
    } finally {
      server.stop();
    }
  });

  it("returns null when the manifest is missing or invalid", async () => {
    const missing = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) });
    const invalid = Bun.serve({ port: 0, fetch: () => Response.json({}) });
    try {
      expect(await fetchLatestCliVersion(String(missing.url))).toBeNull();
      expect(await fetchLatestCliVersion(String(invalid.url))).toBeNull();
      expect(await fetchLatestCliVersion("http://127.0.0.1:1")).toBeNull();
    } finally {
      missing.stop();
      invalid.stop();
    }
  });

  it("replaces the managed CLI file with the downloaded bundle", async () => {
    const home = join(tmpdir(), `maple-update-test-${process.pid}`);
    const target = join(home, "bin", "maple-cli.js");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, "old-cli");
    process.env.MAPLE_CLI_HOME = home;

    const server = fakeServer(new TextEncoder().encode("new-cli-bundle-content".repeat(800)));
    try {
      const result = await applyCliUpdate(String(server.url));
      expect(result.ok).toBe(true);
      expect(existsSync(target)).toBe(true);
      expect(new TextDecoder().decode(await Bun.file(target).arrayBuffer())).toBe("new-cli-bundle-content".repeat(800));
    } finally {
      server.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects incomplete downloads and non-managed installs", async () => {
    const home = join(tmpdir(), `maple-update-test-${process.pid}-managed`);
    const target = join(home, "bin", "maple-cli.js");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, "old-cli");
    process.env.MAPLE_CLI_HOME = home;
    const server = fakeServer(new TextEncoder().encode("tiny"));
    try {
      const incomplete = await applyCliUpdate(String(server.url));
      expect(incomplete.ok).toBe(false);
      expect(incomplete.message).toContain("不完整");
      expect(new TextDecoder().decode(await Bun.file(target).arrayBuffer())).toBe("old-cli");

      const unmanagedHome = join(tmpdir(), `maple-update-test-${process.pid}-unmanaged`);
      process.env.MAPLE_CLI_HOME = unmanagedHome;
      const unmanaged = await applyCliUpdate(String(server.url));
      expect(unmanaged.ok).toBe(false);
      expect(unmanaged.message).toContain("托管安装");
    } finally {
      server.stop();
      rmSync(home, { recursive: true, force: true });
      rmSync(join(tmpdir(), `maple-update-test-${process.pid}-unmanaged`), { recursive: true, force: true });
    }
  });
});

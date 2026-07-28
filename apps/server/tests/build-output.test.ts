import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createBuildStagingRoot,
  prepareBuildStagingRoot,
  publishBuildDirectory
} from "../scripts/build-output";
import {
  copyStandaloneDashboard,
  writeStandaloneDownloadManifest
} from "../scripts/standalone-download";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "maple-server-build-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Server build publication", () => {
  it("builds beside the deployment and publishes the completed directory", () => {
    const root = temporaryRoot();
    const outputRoot = join(root, "dist");
    const stagingRoot = createBuildStagingRoot(outputRoot, "test");

    prepareBuildStagingRoot(stagingRoot);
    writeFileSync(join(stagingRoot, "version.txt"), "new");
    expect(publishBuildDirectory(stagingRoot, outputRoot)).toBeNull();

    expect(readFileSync(join(outputRoot, "version.txt"), "utf8")).toBe("new");
    expect(existsSync(stagingRoot)).toBe(false);
  });

  it("replaces an existing deployment only after staging is complete", () => {
    const root = temporaryRoot();
    const outputRoot = join(root, "dist");
    const stagingRoot = createBuildStagingRoot(outputRoot, "replacement");
    mkdirSync(outputRoot);
    writeFileSync(join(outputRoot, "version.txt"), "old");
    prepareBuildStagingRoot(stagingRoot);
    writeFileSync(join(stagingRoot, "version.txt"), "new");

    expect(publishBuildDirectory(stagingRoot, outputRoot)).toBeNull();
    expect(readFileSync(join(outputRoot, "version.txt"), "utf8")).toBe("new");
    expect(readdirSync(root).some((name) => name.startsWith("dist.retired-"))).toBe(false);
  });
});

describe("Maple Local download publication", () => {
  it("keeps exactly one server URL injection marker in every public installer", () => {
    const scriptsRoot = resolve(import.meta.dir, "../../../scripts");
    for (const installer of [
      "maple-install.sh",
      "maple-install.ps1",
      "maple-local-install.sh",
      "maple-local-install.ps1"
    ]) {
      const content = readFileSync(join(scriptsRoot, installer), "utf8");
      expect(content.match(/__MAPLE_SERVER_URL__/g)?.length).toBe(1);
    }
  });

  it("installs a persistent Maple Local update command on both platforms", () => {
    const scriptsRoot = resolve(import.meta.dir, "../../../scripts");
    const shellInstaller = readFileSync(join(scriptsRoot, "maple-local-install.sh"), "utf8");
    const powershellInstaller = readFileSync(join(scriptsRoot, "maple-local-install.ps1"), "utf8");

    for (const installer of [shellInstaller, powershellInstaller]) {
      expect(installer).toContain(".update-source");
      expect(installer).toContain("MAPLE_LAUNCHED_BY_UPDATER");
      expect(installer).toContain("maple-local update");
    }
    expect(shellInstaller).toContain("maple-local-update");
    expect(powershellInstaller).toContain("maple-local-update.ps1");
  });

  it("reports a successful install.sh download with an idempotent event ID", () => {
    const installer = readFileSync(
      resolve(import.meta.dir, "../../../scripts/maple-install.sh"),
      "utf8"
    );
    const reportIndex = installer.indexOf("/api/downloads/install-sh");

    expect(installer).toContain("x-maple-install-id");
    expect(installer).toContain("/dev/urandom");
    expect(installer).toContain(">/dev/null 2>&1 || true");
    expect(reportIndex).toBeGreaterThan(installer.indexOf("install chromium --only-shell"));
    expect(reportIndex).toBeLessThan(installer.indexOf("[maple] Installed in"));
  });

  it("copies only dashboard assets and writes a portable deterministic manifest", () => {
    const root = temporaryRoot();
    const dashboardRoot = join(root, "dashboard");
    const downloadRoot = join(root, "download");
    mkdirSync(join(dashboardRoot, "assets"), { recursive: true });
    mkdirSync(join(dashboardRoot, "downloads"), { recursive: true });
    mkdirSync(downloadRoot, { recursive: true });
    writeFileSync(join(dashboardRoot, "index.html"), "Maple");
    writeFileSync(join(dashboardRoot, "assets", "app.js"), "app");
    writeFileSync(join(dashboardRoot, "downloads", "hosted-only.txt"), "skip");
    writeFileSync(join(downloadRoot, "maple-local.js"), "local");

    copyStandaloneDashboard(dashboardRoot, downloadRoot);
    const manifest = writeStandaloneDownloadManifest(downloadRoot);

    expect(manifest).toEqual([
      "maple-local.js",
      "web/assets/app.js",
      "web/index.html"
    ]);
    expect(existsSync(join(downloadRoot, "web", "downloads"))).toBe(false);
    expect(readFileSync(join(downloadRoot, "manifest.txt"), "utf8"))
      .toBe("maple-local.js\nweb/assets/app.js\nweb/index.html\n");
  });
});

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  directorySize,
  formatCacheUsage,
  readCacheUsage
} from "../src/cache/usage";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "maple-cache-usage-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI cache usage", () => {
  it("measures files without following symlinks or failing on missing directories", async () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "one.bin"), Buffer.alloc(5));
    writeFileSync(join(root, "nested", "two.bin"), Buffer.alloc(7));
    expect(await directorySize(root)).toBe(12);
    expect(await directorySize(join(root, "missing"))).toBe(0);
  });

  it("reports Maple and its isolated Playwright runtime without double counting", async () => {
    const mapleRoot = temporaryDirectory();
    const playwrightRoot = join(mapleRoot, "runtime", "playwright");
    mkdirSync(join(playwrightRoot, "browsers"), { recursive: true });
    writeFileSync(join(mapleRoot, "cli.json"), Buffer.alloc(11));
    writeFileSync(join(playwrightRoot, "package.json"), Buffer.alloc(13));
    writeFileSync(join(playwrightRoot, "browsers", "chromium.bin"), Buffer.alloc(17));

    expect(await readCacheUsage({ mapleRoot, playwrightRoot })).toEqual({
      mapleBytes: 11,
      playwrightBytes: 30
    });
  });

  it("formats the exact compact footer copy", () => {
    expect(formatCacheUsage({
      mapleBytes: 12.4 * 1024 * 1024,
      playwrightBytes: 345.6 * 1024 * 1024
    })).toBe("缓存 Maple 12 M, Playwright 346 M");
  });
});

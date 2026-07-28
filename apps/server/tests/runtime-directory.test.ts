import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupStaleServerRuntimeSessions,
  createServerRuntimeSession,
  removeServerRuntimeSession,
  resolveServerRuntimeRoot,
  updateServerRuntimeOwner
} from "../scripts/runtime-directory";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "maple-server-runtime-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Server runtime directories", () => {
  it("allocates deployments under the Maple data directory", () => {
    const root = temporaryRoot();
    const dataRoot = join(root, "maple-data");
    const projectRoot = join(root, "project");
    mkdirSync(projectRoot);

    const runtime = createServerRuntimeSession(
      { MAPLE_DATA_DIR: dataRoot },
      { now: 1234, pid: 55, nonce: "test" }
    );

    expect(runtime.runtimeRoot).toBe(join(dataRoot, "runtime"));
    expect(runtime.outputRoot).toBe(join(runtime.sessionRoot, "deployment"));
    expect(existsSync(join(runtime.sessionRoot, "owner.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".maple"))).toBe(false);
    expect(removeServerRuntimeSession(runtime.sessionRoot)).toBeNull();
  });

  it("removes stale sessions while preserving live Server deployments", () => {
    const root = temporaryRoot();
    const env = { MAPLE_DATA_DIR: join(root, "data") };
    const live = createServerRuntimeSession(env, { now: 1, pid: 101, nonce: "live" });
    const stale = createServerRuntimeSession(env, { now: 2, pid: 202, nonce: "stale" });
    const abandoned = join(resolveServerRuntimeRoot(env), "server-abandoned");
    mkdirSync(abandoned, { recursive: true });
    writeFileSync(join(abandoned, "partial-build"), "incomplete");

    updateServerRuntimeOwner(live.sessionRoot, 101);
    updateServerRuntimeOwner(stale.sessionRoot, 202);
    const warnings = cleanupStaleServerRuntimeSessions(
      resolveServerRuntimeRoot(env),
      (pid) => pid === 101
    );

    expect(warnings).toEqual([]);
    expect(existsSync(live.sessionRoot)).toBe(true);
    expect(existsSync(stale.sessionRoot)).toBe(false);
    expect(existsSync(abandoned)).toBe(false);
  });
});

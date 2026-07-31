import { describe, expect, it } from "bun:test";
import {
  forceTerminateProcessTree,
  windowsForceKillCommand
} from "../src/execution/process-termination";

describe("Worker process termination", () => {
  it("builds a recursive forced Windows termination command", () => {
    expect(windowsForceKillCommand(4321)).toEqual([
      "taskkill.exe",
      "/PID",
      "4321",
      "/T",
      "/F"
    ]);
    expect(() => windowsForceKillCommand(0)).toThrow();
  });

  it("force-terminates a live subprocess", async () => {
    const subprocess = Bun.spawn([
      process.execPath,
      "-e",
      "setInterval(() => undefined, 1000)"
    ], {
      detached: process.platform !== "win32",
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore"
    });

    try {
      await forceTerminateProcessTree(subprocess);
      const exited = await Promise.race([
        subprocess.exited.then(() => true),
        Bun.sleep(2_000).then(() => false)
      ]);
      expect(exited).toBe(true);
    } finally {
      if (subprocess.exitCode === null) subprocess.kill("SIGKILL");
    }
  });
});

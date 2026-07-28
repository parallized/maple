import { describe, expect, it } from "bun:test";
import { defaultRunnerName, normalizeStoredRunnerName } from "../src/runner/runner-name";

describe("Runner device names", () => {
  it("uses only the hostname as the default device name", () => {
    expect(defaultRunnerName("holybread")).toBe("holybread");
    expect(defaultRunnerName("  studio-pc  ")).toBe("studio-pc");
  });

  it("removes only the old generated suffix from stored names", () => {
    expect(normalizeStoredRunnerName("holybread · Maple CLI", "holybread")).toBe("holybread");
    expect(normalizeStoredRunnerName("My Maple CLI", "holybread")).toBe("My Maple CLI");
    expect(normalizeStoredRunnerName("studio · Maple CLI", "holybread")).toBe("studio · Maple CLI");
  });
});

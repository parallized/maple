import { describe, expect, it } from "bun:test";
import { parseStandaloneArgs } from "../src/standalone/startup";

describe("Maple Local startup", () => {
  it("starts directly when bun local receives no arguments", () => {
    const args = parseStandaloneArgs([]);

    expect(args.command).toBe("tui");
  });

  it("shows help only when the user explicitly asks for it", () => {
    expect(parseStandaloneArgs(["help"]).command).toBe("help");
    expect(parseStandaloneArgs(["--help"]).command).toBe("--help");
  });
});

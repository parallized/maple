import { describe, expect, it } from "bun:test";
import { detectAvailableShells, isWorkerShell, wrapWorkerCommand } from "../src/execution/shells";
import { buildWorkerCommand } from "../src/execution/worker-command";

const base = {
  executable: "codex",
  args: ["--ask-for-approval", "never", "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--json", "-"],
  stdin: "Fix the bug"
};

describe("worker shells", () => {
  it("keeps the command untouched for direct", () => {
    expect(wrapWorkerCommand("direct", base)).toBe(base);
    expect(buildWorkerCommand("codex", "Fix the bug")).toEqual(base);
  });

  it("wraps POSIX shells with safe \"$@\" forwarding", () => {
    for (const shell of ["sh", "bash", "zsh"] as const) {
      const wrapped = wrapWorkerCommand(shell, base);
      expect(wrapped.executable).toBe(shell);
      expect(wrapped.args).toEqual([
        "-c",
        'exec "$@"',
        shell,
        "codex",
        "--ask-for-approval",
        "never",
        "exec",
        "--sandbox",
        "workspace-write",
        "--skip-git-repo-check",
        "--json",
        "-"
      ]);
      expect(wrapped.stdin).toBe("Fix the bug");
    }
  });

  it("wraps fish with $argv forwarding", () => {
    const wrapped = wrapWorkerCommand("fish", base);
    expect(wrapped.executable).toBe("fish");
    expect(wrapped.args).toEqual([
      "-c",
      "exec $argv",
      "codex",
      "--ask-for-approval",
      "never",
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "--json",
      "-"
    ]);
    expect(wrapped.stdin).toBe("Fix the bug");
  });

  it("wraps PowerShell with an encoded command that preserves quoting", () => {
    const wrapped = wrapWorkerCommand("pwsh", { executable: "codex", args: ["exec", "it's broken"] });
    expect(wrapped.executable).toBe("pwsh");
    expect(wrapped.args[0]).toBe("-NoProfile");
    expect(wrapped.args[1]).toBe("-EncodedCommand");
    const script = Buffer.from(wrapped.args[2]!, "base64").toString("utf16le");
    expect(script).toContain("& 'codex' 'exec' 'it''s broken'");
    expect(script).toContain("exit $LASTEXITCODE");
  });

  it("wraps cmd with CommandLineToArgvW-compatible quoting", () => {
    const wrapped = wrapWorkerCommand("cmd", { executable: "codex", args: ["exec", 'say "hi" now'] });
    expect(wrapped.executable).toBe("cmd");
    expect(wrapped.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(wrapped.args[3]).toBe(`""codex" "exec" "say \\"hi\\" now""`);
  });

  it("doubles trailing backslashes inside cmd quotes", () => {
    const wrapped = wrapWorkerCommand("cmd", { executable: "C:\\tools\\run.cmd", args: ["C:\\path\\"] });
    expect(wrapped.args[3]).toBe(`""C:\\tools\\run.cmd" "C:\\path\\\\""`);
  });

  it("validates shell names", () => {
    expect(isWorkerShell("bash")).toBe(true);
    expect(isWorkerShell("nu")).toBe(false);
  });

  it("detects only shells that resolve on PATH", () => {
    const found = detectAvailableShells((bin) => (bin === "bash" || bin === "pwsh" ? `/usr/bin/${bin}` : null));
    expect(found).toEqual(["bash", "pwsh"]);
  });

  it("builds worker commands through a shell when requested", () => {
    const command = buildWorkerCommand("claude", "Do it", "bash");
    expect(command.executable).toBe("bash");
    expect(command.args[0]).toBe("-c");
    expect(command.args.at(-1)).toBe("Do it");
    expect(command.args).toContain("claude");
  });

  it("preserves adapter-specific environment and stdin through shell wrappers", () => {
    const command = { ...base, env: { AGENT_PROFILE: "coding" } };
    for (const shell of ["bash", "fish", "pwsh", "cmd"] as const) {
      expect(wrapWorkerCommand(shell, command).env).toEqual(command.env);
      expect(wrapWorkerCommand(shell, command).stdin).toBe(command.stdin);
    }
  });
});

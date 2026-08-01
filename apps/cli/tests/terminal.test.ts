import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { detectCapabilities, detectShellFlavor, type CapabilityInput } from "../src/terminal/capabilities";
import { KeySource } from "../src/terminal/input";
import { KeyParser } from "../src/terminal/keymap";
import { createStyle, createSymbols, displayWidth, keepSgrOnly, stripAnsi, truncateDisplayWidth, truncateVisible, visibleLength } from "../src/terminal/style";
import { inputWindow } from "../src/terminal/widgets";

function caps(overrides: Partial<CapabilityInput> = {}) {
  return detectCapabilities({
    env: {},
    platform: "linux",
    stdinIsTTY: true,
    stdoutIsTTY: true,
    ...overrides
  });
}

class FakeTtyInput extends EventEmitter {
  readonly isTTY = true;
  readonly rawModes: boolean[] = [];

  setRawMode(enabled: boolean): this {
    this.rawModes.push(enabled);
    return this;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }
}

describe("terminal input sessions", () => {
  it("temporarily releases raw mode and restores the shared key source", () => {
    const input = new FakeTtyInput();
    const source = new KeySource(input as unknown as NodeJS.ReadStream);

    expect(input.listenerCount("data")).toBe(1);
    source.suspend();
    expect(input.listenerCount("data")).toBe(0);
    source.resume();
    expect(input.listenerCount("data")).toBe(1);
    source.close();

    expect(input.listenerCount("data")).toBe(0);
    expect(input.rawModes).toEqual([true, false, true, false]);
  });
});

describe("terminal capabilities", () => {
  it("enables everything on a modern POSIX terminal", () => {
    const cap = caps({ env: { TERM: "xterm-256color" } });
    expect(cap).toMatchObject({ interactive: true, ansi: true, color: true, unicode: true });
  });

  it("disables ANSI and interaction on dumb terminals", () => {
    const cap = caps({ env: { TERM: "dumb" } });
    expect(cap.interactive).toBe(false);
    expect(cap.ansi).toBe(false);
    expect(cap.color).toBe(false);
  });

  it("drops color when NO_COLOR is set", () => {
    expect(caps({ env: { NO_COLOR: "1" } }).color).toBe(false);
    expect(caps({ env: { NO_COLOR: "" } }).color).toBe(true);
  });

  it("requires a real TTY on both streams for interaction", () => {
    expect(caps({ stdinIsTTY: false }).interactive).toBe(false);
    expect(caps({ stdoutIsTTY: false }).interactive).toBe(false);
    expect(caps({ env: { CI: "true" } }).interactive).toBe(false);
  });

  it("treats MSYS pty (Git Bash) as TTY even when the runtime misdetects pipes", () => {
    // Bun 在 Windows 的 MSYS pty 下 isTTY 恒为 false，需要按 MSYSTEM 兜底。
    const cap = caps({
      platform: "win32",
      stdinIsTTY: false,
      stdoutIsTTY: false,
      env: { MSYSTEM: "MINGW64", TERM: "xterm" }
    });
    expect(cap.interactive).toBe(true);
    expect(cap.ansi).toBe(true);
    expect(cap.shell).toBe("git-bash");
  });

  it("falls back to ASCII on legacy Windows consoles", () => {
    const legacy = caps({ platform: "win32", env: { COMSPEC: "C:\\Windows\\System32\\cmd.exe" } });
    expect(legacy.unicode).toBe(false);
    const modern = caps({ platform: "win32", env: { WT_SESSION: "abc" } });
    expect(modern.unicode).toBe(true);
    const gitBash = caps({ platform: "win32", env: { MSYSTEM: "MINGW64", TERM: "xterm" } });
    expect(gitBash.unicode).toBe(true);
  });

  it("identifies common shell flavors", () => {
    expect(detectShellFlavor({ MSYSTEM: "MINGW64" }, "win32")).toBe("git-bash");
    expect(detectShellFlavor({ SHELL: "/bin/zsh" }, "darwin")).toBe("zsh");
    expect(detectShellFlavor({ SHELL: "/usr/bin/fish" }, "linux")).toBe("fish");
    expect(detectShellFlavor({ SHELL: "/bin/dash" }, "linux")).toBe("sh");
    expect(detectShellFlavor({ PSModulePath: "C:\\Modules" }, "win32")).toBe("powershell");
    expect(detectShellFlavor({ COMSPEC: "C:\\Windows\\System32\\cmd.exe" }, "win32")).toBe("cmd");
    expect(detectShellFlavor({}, "linux")).toBe("unknown");
  });
});

describe("key parser", () => {
  it("parses arrows in both CSI and application mode", () => {
    const parser = new KeyParser();
    expect(parser.push("\x1b[A\x1b[B")).toEqual([{ name: "up" }, { name: "down" }]);
    expect(parser.push("\x1bOA\x1bOD")).toEqual([{ name: "up" }, { name: "left" }]);
  });

  it("parses common keys", () => {
    const parser = new KeyParser();
    expect(parser.push("\r")).toEqual([{ name: "enter" }]);
    expect(parser.push("\x03")).toEqual([{ name: "ctrl-c" }]);
    expect(parser.push("\x15\x10")).toEqual([{ name: "ctrl-u" }, { name: "ctrl-p" }]);
    expect(parser.push("\x7f")).toEqual([{ name: "backspace" }]);
    expect(parser.push("\x1b[3~")).toEqual([{ name: "delete" }]);
    expect(parser.push("\x1b[Z")).toEqual([{ name: "tab" }]);
    expect(parser.push("\x1b[H\x1b[F")).toEqual([{ name: "home" }, { name: "end" }]);
  });

  it("emits printable characters including multibyte", () => {
    const parser = new KeyParser();
    expect(parser.push("a你")).toEqual([
      { name: "char", char: "a" },
      { name: "char", char: "你" }
    ]);
  });

  it("buffers split escape sequences across chunks", () => {
    const parser = new KeyParser();
    expect(parser.push("\x1b")).toEqual([]);
    expect(parser.hasPending()).toBe(true);
    expect(parser.push("[A")).toEqual([{ name: "up" }]);
    expect(parser.hasPending()).toBe(false);
  });

  it("resolves a lone escape on flush", () => {
    const parser = new KeyParser();
    parser.push("\x1b");
    expect(parser.flush()).toEqual([{ name: "escape" }]);
    expect(parser.hasPending()).toBe(false);
  });

  it("swallows unknown sequences without emitting keys", () => {
    const parser = new KeyParser();
    expect(parser.push("\x1b[9~x")).toEqual([{ name: "char", char: "x" }]);
  });
});

describe("style helpers", () => {
  it("measures visible length without ANSI codes", () => {
    expect(visibleLength("\x1b[31mabc\x1b[0m")).toBe(3);
    expect(stripAnsi("\x1b[2Khi")).toBe("hi");
  });

  it("truncates by visible width and keeps styles intact", () => {
    const out = truncateVisible("\x1b[31mabcdef\x1b[0m", 3);
    expect(visibleLength(out)).toBe(3);
    expect(out).toContain("\x1b[31m");
    expect(out.endsWith("\x1b[0m")).toBe(true);
  });

  it("measures CJK as wide while keeping terminal symbols single-column", () => {
    expect(displayWidth("A中◆" )).toBe(4);
    expect(stripAnsi(truncateDisplayWidth("中AB", 3))).toBe("中A");
  });

  it("keeps SGR color but drops cursor control in worker output", () => {
    expect(keepSgrOnly("\x1b[2K\x1b[31mred\x1b[0m\x1b[1A")).toBe("\x1b[31mred\x1b[0m");
  });

  it("degrades symbols to ASCII when unicode is unavailable", () => {
    expect(createSymbols({ unicode: true }).pointer).toBe("❯");
    expect(createSymbols({ unicode: false }).pointer).toBe(">");
    const style = createStyle({ ansi: false, color: false });
    expect(style.strong("plain")).toBe("plain");
    const colorStyle = createStyle({ ansi: true, color: true });
    expect(colorStyle.white("工具列表")).toContain("\x1b[97m");
    expect(colorStyle.softSuccess("Codex")).toContain("\x1b[92m");
    expect(colorStyle.muted("Claude")).toContain("\x1b[90m");
  });

  it("windows text input around the cursor", () => {
    const view = inputWindow(["a", "b", "c", "d", "e"], 4, 3);
    expect(view.chars).toEqual(["c", "d", "e"]);
    expect(view.cursor).toBe(2);
    expect(view.truncatedStart).toBe(true);
    expect(view.truncatedEnd).toBe(false);
    const head = inputWindow(["a", "b", "c", "d", "e"], 1, 3);
    expect(head.chars).toEqual(["a", "b", "c"]);
    expect(head.truncatedEnd).toBe(true);
  });
});

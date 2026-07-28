import { describe, expect, it } from "bun:test";
import type { TerminalCapabilities } from "../src/terminal/capabilities";
import { FullscreenSession } from "../src/terminal/fullscreen";
import { createStyle, createSymbols, displayWidth, stripAnsi } from "../src/terminal/style";
import { buildMainMenuFrame } from "../src/tui/main-menu";
import type { SelectOption } from "../src/terminal/widgets";

const options: SelectOption[] = [
  { value: "connect", label: "连接并运行", hint: "领取 Todo 并在本机执行" },
  { value: "projects", label: "项目管理" },
  { value: "unbind", label: "解除绑定" },
  { value: "status", label: "状态详情" },
  { value: "help", label: "使用帮助" },
  { value: "exit", label: "退出" }
];

function frame(columns: number, rows: number) {
  return buildMainMenuFrame({
    columns,
    rows,
    title: "http://127.0.0.1:45820 · 执行端 Maple CLI · 项目 4",
    options,
    selectedIndex: 0,
    style: createStyle({ ansi: false, color: false }),
    symbols: createSymbols({ unicode: true }),
    unicode: true
  });
}

describe("TUI main menu", () => {
  it("centers the vertical action group below the compact brand line", () => {
    const lines = frame(80, 24).map(stripAnsi);
    const brandRow = lines.findIndex((line) => line.includes("Maple CLI"));
    const firstButton = lines.findIndex((line) => line.includes("连接并运行"));
    const lastButton = lines.findIndex((line) => line.includes("退出"));
    const groupCenter = (firstButton + lastButton) / 2;
    const viewportCenter = (lines.length - 1) / 2;

    expect(lines).toHaveLength(23);
    expect(brandRow).toBeGreaterThanOrEqual(0);
    expect(brandRow).toBeLessThan(firstButton);
    expect(Math.abs(groupCenter - viewportCenter)).toBeLessThanOrEqual(2);
    expect(lines.some((line) => line.includes("Enter 确认"))).toBe(true);
  });

  it("keeps a text-only brand and never exceeds the viewport width", () => {
    const large = frame(120, 40);
    expect(large.some((line) => stripAnsi(line).includes("Maple CLI"))).toBe(true);
    expect(Math.max(...large.map(displayWidth))).toBeLessThanOrEqual(120);

    const narrow = frame(32, 18);
    expect(narrow).toHaveLength(17);
    expect(options.every((option) => narrow.some((line) => stripAnsi(line).includes(option.label)))).toBe(true);
    expect(Math.max(...narrow.map(displayWidth))).toBeLessThanOrEqual(32);
  });

  it("enters an alternate buffer and restores the original terminal on exit", () => {
    const writes: string[] = [];
    const stdout = { write: (value: string) => { writes.push(value); return true; } } as unknown as NodeJS.WriteStream;
    const cap: TerminalCapabilities = {
      interactive: true,
      ansi: true,
      color: true,
      unicode: true,
      shell: "pwsh",
      columns: 80,
      rows: 24
    };
    const session = new FullscreenSession(cap, stdout);

    expect(session.enter()).toBe(true);
    session.clear();
    session.leave();

    expect(writes[0]).toContain("\x1b[?1049h");
    expect(writes[1]).toContain("\x1b[2J");
    expect(writes[2]).toContain("\x1b[?1049l");
  });
});

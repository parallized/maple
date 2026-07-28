import type { TerminalCapabilities } from "./capabilities";

const RESET = "\x1b[0m";

type Sgr = (text: string) => string;

function sgr(code: string, enabled: boolean): Sgr {
  if (!enabled) return (text) => text;
  return (text) => `\x1b[${code}m${text}${RESET}`;
}

export interface Style {
  strong: Sgr;
  dim: Sgr;
  accent: Sgr;
  success: Sgr;
  softSuccess: Sgr;
  white: Sgr;
  muted: Sgr;
  danger: Sgr;
  warning: Sgr;
  inverse: Sgr;
  /** 面板边框：中灰，存在感低于内容但不至于隐形。 */
  panel: Sgr;
  /** 未选中标签的微弱灰底（256 色深灰，低存在感）。 */
  softBlock: Sgr;
}

/** 低噪声配色：默认前景 + 一个青色强调色，选中行用反色而不是花哨背景。 */
export function createStyle(cap: Pick<TerminalCapabilities, "color" | "ansi">): Style {
  const enabled = cap.ansi;
  const colored = cap.ansi && cap.color;
  return {
    strong: sgr("1", enabled),
    dim: sgr("2", enabled),
    accent: sgr("36", colored),
    success: sgr("32", colored),
    softSuccess: sgr("92", colored),
    white: sgr("97", colored),
    muted: sgr("90", colored),
    danger: sgr("31", colored),
    warning: sgr("33", colored),
    inverse: sgr("7", enabled),
    panel: sgr("38;5;245", colored),
    softBlock: sgr("48;5;236", colored)
  };
}

export interface Symbols {
  pointer: string;
  dot: string;
  ring: string;
  check: string;
  cross: string;
  ellipsis: string;
  hr: string;
  boxTL: string;
  boxTR: string;
  boxBL: string;
  boxBR: string;
  boxV: string;
  boxH: string;
}

export function createSymbols(cap: Pick<TerminalCapabilities, "unicode">): Symbols {
  if (cap.unicode) {
    return {
      pointer: "❯",
      dot: "●",
      ring: "○",
      check: "✓",
      cross: "✗",
      ellipsis: "…",
      hr: "─",
      boxTL: "╭",
      boxTR: "╮",
      boxBL: "╰",
      boxBR: "╯",
      boxV: "│",
      boxH: "─"
    };
  }
  return {
    pointer: ">",
    dot: "*",
    ring: "o",
    check: "v",
    cross: "x",
    ellipsis: "...",
    hr: "-",
    boxTL: "+",
    boxTR: "+",
    boxBL: "+",
    boxBR: "+",
    boxV: "|",
    boxH: "-"
  };
}

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function codePointColumns(codePoint: number): number {
  // 零宽：变体选择符（VS15/VS16 等）、ZWJ、组合附加符不占列。
  if (
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || codePoint === 0x200d
    || (codePoint >= 0x0300 && codePoint <= 0x036f)
    || codePoint === 0x200b
  ) return 0;
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    // Emoji 全段（含 0x1F650–0x1F8FF 的 🚀🚪 等，之前只到 0x1F64F 会漏算 1 列）
    || (codePoint >= 0x1f000 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) ? 2 : 1;
}

/** 终端显示宽度：宽字符（CJK 等）按 2 列计，用于居中、对齐等布局。 */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of stripAnsi(value)) {
    width += codePointColumns(char.codePointAt(0) ?? 0);
  }
  return width;
}

/** 按可见宽度截断，保留 ANSI 样式序列本身。 */
export function truncateVisible(value: string, width: number): string {
  if (width <= 0) return "";
  if (visibleLength(value) <= width) return value;
  let result = "";
  let visible = 0;
  let index = 0;
  while (index < value.length && visible < width) {
    const rest = value.slice(index);
    const ansi = rest.match(/^(\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\))/);
    if (ansi) {
      result += ansi[0];
      index += ansi[0].length;
      continue;
    }
    const codePoint = rest.codePointAt(0)!;
    const charLength = codePoint > 0xffff ? 2 : 1;
    result += rest.slice(0, charLength);
    index += charLength;
    visible += 1;
  }
  return `${result}${RESET}`;
}

/** 按终端列宽截断；CJK 等宽字符按 2 列计算。 */
export function truncateDisplayWidth(value: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(value) <= width) return value;
  let result = "";
  let columns = 0;
  let index = 0;
  while (index < value.length && columns < width) {
    const rest = value.slice(index);
    const ansi = rest.match(/^(\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\))/);
    if (ansi) {
      result += ansi[0];
      index += ansi[0].length;
      continue;
    }
    const codePoint = rest.codePointAt(0)!;
    const charLength = codePoint > 0xffff ? 2 : 1;
    const charWidth = codePointColumns(codePoint);
    if (columns + charWidth > width) break;
    result += rest.slice(0, charLength);
    index += charLength;
    columns += charWidth;
  }
  return `${result}${RESET}`;
}

/**
 * 过滤 Worker 输出中的终端控制序列：保留颜色（SGR），丢弃光标移动等
 * 会破坏日志面板布局的序列。
 */
export function keepSgrOnly(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, (sequence) => (/^\x1b\[[0-9;]*m$/.test(sequence) ? sequence : ""))
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

import { shellLabel } from "../terminal/capabilities";
import { wrapPanel } from "../terminal/panel";
import { Screen } from "../terminal/screen";
import { displayWidth, truncateDisplayWidth, type Style, type Symbols } from "../terminal/style";
import { selectOne, type SelectOption, type WidgetContext } from "../terminal/widgets";

export interface MainMenuFrameOptions {
  columns: number;
  rows: number;
  title: string;
  /** 品牌行下方的次级信息（终端 / 模式 / 色彩），空间不足时自动省略。 */
  subtitle?: string;
  options: SelectOption[];
  selectedIndex: number;
  style: Style;
  symbols: Symbols;
  unicode: boolean;
}

function place(lines: string[], row: number, value: string): void {
  if (row >= 0 && row < lines.length) lines[row] = value;
}

/**
 * 生成固定高度首页：品牌 + 状态在上，动作列表装在圆角面板里，
 * 内容列整体居中；空间不足时按“空白行 → 副标题”逐级省略。
 */
export function buildMainMenuFrame(options: MainMenuFrameOptions): string[] {
  const width = Math.max(20, options.columns);
  const height = Math.max(8, options.rows - 1);
  const { style, symbols } = options;
  const selected = Math.min(Math.max(options.selectedIndex, 0), options.options.length - 1);

  const brand = `${style.accent(symbols.dot)} ${style.strong("Maple CLI")}`;
  const subtitle = options.subtitle ? style.dim(`  ${options.subtitle}`) : null;
  const title = style.dim(truncateDisplayWidth(options.title, Math.max(10, width - 12)));

  const labelOf = (option: SelectOption) =>
    options.unicode && option.icon ? `${option.icon} ${option.label}` : option.label;
  const labelWidth = Math.max(...options.options.map((option) => displayWidth(labelOf(option))));
  const optionRows = options.options.map((option, index) => {
    const label = labelOf(option);
    const labelPad = " ".repeat(Math.max(0, labelWidth - displayWidth(label)));
    if (index === selected) {
      const plain = `${symbols.pointer} ${label}${labelPad}${option.hint ? `  ${option.hint}` : ""}`;
      // 不用 inverse：Windows Terminal 对反色单元格里的 emoji 宽度渲染有 bug，会把行顶出边框。
      return style.softBlock(` ${plain} `);
    }
    return `  ${label}${labelPad}${option.hint ? style.dim(`  ${option.hint}`) : ""}`;
  });
  const panel = wrapPanel(optionRows, null, style, symbols);
  const footer = style.dim("↑↓ 选择 · Enter 确认 · Q 退出");

  const block: string[] = [brand];
  if (subtitle) block.push(subtitle);
  block.push("", title, "", ...panel, "", footer);
  while (block.length > height) {
    if (subtitle && block[1] === subtitle) block.splice(1, 1);
    else {
      const blank = block.indexOf("");
      if (blank < 0) break;
      block.splice(blank, 1);
    }
  }

  const contentWidth = Math.min(width, Math.max(...block.map(displayWidth)));
  const leftPad = Math.max(0, Math.floor((width - contentWidth) / 2));
  const topPad = Math.max(0, Math.floor((height - block.length) / 2));
  const indent = " ".repeat(leftPad);

  const lines = Array.from({ length: height }, () => "");
  block.forEach((line, index) => place(lines, topPad + index, `${indent}${line}`));
  return lines.map((line) => truncateDisplayWidth(line, width));
}

export async function selectMainMenu(
  ctx: WidgetContext,
  title: string,
  options: SelectOption[],
  initialValue?: string
): Promise<string | null> {
  if (!ctx.cap.interactive || !ctx.cap.ansi || !ctx.keys) {
    return selectOne(ctx, title, options, initialValue);
  }
  if (options.length === 0) return null;

  const screen = new Screen(ctx.cap);
  const subtitle = `${shellLabel(ctx.cap.shell)} · ${ctx.keys ? "交互模式" : "逐行模式"} · ${ctx.cap.color ? "彩色" : "纯文本"}`;
  let index = Math.max(0, options.findIndex((option) => option.value === initialValue));
  const render = () => screen.renderDynamic((columns, rows) => buildMainMenuFrame({
    columns,
    rows,
    title,
    subtitle,
    options,
    selectedIndex: index,
    style: ctx.style,
    symbols: ctx.symbols,
    unicode: ctx.cap.unicode
  }));

  try {
    render();
    for (;;) {
      const key = await ctx.keys.next();
      if (key.name === "up") index = (index - 1 + options.length) % options.length;
      else if (key.name === "down") index = (index + 1) % options.length;
      else if (key.name === "home") index = 0;
      else if (key.name === "end") index = options.length - 1;
      else if (key.name === "enter") {
        const chosen = options[index]!;
        screen.discard();
        return chosen.value;
      } else if (key.name === "char" && key.char?.toLowerCase() === "q") {
        screen.discard();
        return options.find((option) => option.value === "exit")?.value ?? null;
      } else if (key.name === "escape" || key.name === "ctrl-c" || key.name === "ctrl-d") {
        screen.discard();
        return null;
      } else continue;
      render();
    }
  } finally {
    screen.discard();
  }
}

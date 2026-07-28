import { displayWidth, type Style, type Symbols } from "./style";

/**
 * 圆角面板：标题嵌在顶边（可选），内容左右各留 2 格、上下各一空行。
 * 边框用低存在感的中灰，现代 AI CLI 的通用装饰语言。
 */
export function wrapPanel(content: string[], title: string | null, style: Style, symbols: Symbols): string[] {
  const padX = 2;
  const inner = Math.max(1, ...content.map(displayWidth)) + padX * 2;
  const border = style.panel;
  const bar = symbols.boxH;
  const top = title
    ? border(`${symbols.boxTL}${bar} `) +
      title +
      border(` ${bar.repeat(Math.max(1, inner + 2 - displayWidth(title) - 5))}${symbols.boxTR}`)
    : border(`${symbols.boxTL}${bar.repeat(inner)}${symbols.boxTR}`);
  const bottom = border(`${symbols.boxBL}${bar.repeat(inner)}${symbols.boxBR}`);
  const empty = `${border(symbols.boxV)}${" ".repeat(inner)}${border(symbols.boxV)}`;
  const rows = content.map((line) => {
    const padRight = " ".repeat(Math.max(0, inner - padX - displayWidth(line)));
    return `${border(symbols.boxV)}${" ".repeat(padX)}${line}${padRight}${border(symbols.boxV)}`;
  });
  return [top, empty, ...rows, empty, bottom];
}

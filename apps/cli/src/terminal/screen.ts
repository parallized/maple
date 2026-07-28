import type { TerminalCapabilities } from "./capabilities";
import { truncateDisplayWidth } from "./style";

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_TO_EOL = "\x1b[0K";
const CLEAR_TO_EOS = "\x1b[0J";

/**
 * 行区域渲染器：在光标下方维护一块固定高度的区域，
 * 每次 render 全量重绘这块区域，commit/discard 结束该区域。
 * 只使用各终端普遍支持的基础序列（光标移动、清行、隐显光标）。
 */
export class Screen {
  private drawn = 0;
  private lastLines: string[] = [];
  private dynamicRenderer: ((columns: number, rows: number) => string[]) | null = null;
  private closed = false;
  private cursorHidden = false;
  private readonly onResize = () => this.redraw();

  constructor(
    private readonly cap: TerminalCapabilities,
    private readonly stdout: NodeJS.WriteStream = process.stdout
  ) {
    this.stdout.on("resize", this.onResize);
  }

  render(lines: string[]): void {
    if (this.closed || !this.cap.ansi) return;
    this.dynamicRenderer = null;
    this.lastLines = lines;
    this.redraw();
  }

  /** 全屏布局可在终端尺寸变化时按最新行列数重新排版。 */
  renderDynamic(renderer: (columns: number, rows: number) => string[]): void {
    if (this.closed || !this.cap.ansi) return;
    this.dynamicRenderer = renderer;
    this.redraw();
  }

  /** 保留最终内容并把光标移到区域下方。 */
  commit(finalLines?: string[]): void {
    if (this.closed) return;
    if (finalLines) this.render(finalLines);
    this.closed = true;
    if (this.cap.ansi) {
      if (this.drawn > 0) this.stdout.write("\n");
      this.showCursor();
    }
    this.detach();
  }

  /** 整块区域擦除，如同没有渲染过。 */
  discard(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.cap.ansi && this.drawn > 0) {
      const up = this.drawn - 1;
      this.stdout.write(`\r${up > 0 ? `\x1b[${up}A` : ""}${CLEAR_TO_EOS}`);
      this.drawn = 0;
      this.showCursor();
    }
    this.detach();
  }

  private redraw(): void {
    if (this.drawn === 0 && !this.cursorHidden) {
      this.stdout.write(HIDE_CURSOR);
      this.cursorHidden = true;
    }
    const width = Math.max(20, this.stdout.columns ?? this.cap.columns);
    const rows = Math.max(8, this.stdout.rows ?? this.cap.rows);
    if (this.dynamicRenderer) this.lastLines = this.dynamicRenderer(width, rows);
    const lines = this.lastLines.map((line) => truncateDisplayWidth(line, width));
    let output = "";
    if (this.drawn > 0) output += `\r${this.drawn - 1 > 0 ? `\x1b[${this.drawn - 1}A` : ""}`;
    lines.forEach((line, index) => {
      output += `${line}${CLEAR_TO_EOL}`;
      if (index < lines.length - 1) output += "\r\n";
    });
    output += CLEAR_TO_EOS;
    this.stdout.write(output);
    this.drawn = lines.length;
  }

  private showCursor(): void {
    if (this.cursorHidden) {
      this.stdout.write(SHOW_CURSOR);
      this.cursorHidden = false;
    }
  }

  private detach(): void {
    this.stdout.off("resize", this.onResize);
    this.drawn = 0;
  }
}

import { createInterface } from "node:readline/promises";
import type { TerminalCapabilities } from "./capabilities";
import { KeySource } from "./input";
import { wrapPanel } from "./panel";
import { Screen } from "./screen";
import { createStyle, createSymbols, displayWidth, type Style, type Symbols } from "./style";

export interface WidgetContext {
  cap: TerminalCapabilities;
  style: Style;
  symbols: Symbols;
  /**
   * 会话级共享按键源。部分运行时（Bun/ConPTY）反复开关 raw mode 会让
   * stdin 静默失效，因此整个 TUI 会话共用一个 source，组件不负责关闭。
   */
  keys?: KeySource;
}

export function createWidgetContext(cap: TerminalCapabilities, keys?: KeySource): WidgetContext {
  return { cap, style: createStyle(cap), symbols: createSymbols(cap), keys };
}

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  /** 装饰图标（几何符号，仅 Unicode 终端显示，宽度计入对齐）。 */
  icon?: string;
}

/** 计算输入框的可见窗口（按字符数，光标始终落在窗口内）。 */
export function inputWindow(
  chars: string[],
  cursor: number,
  width: number
): { chars: string[]; cursor: number; truncatedStart: boolean; truncatedEnd: boolean } {
  if (width <= 0 || chars.length <= width) {
    return { chars, cursor, truncatedStart: false, truncatedEnd: false };
  }
  const start = Math.min(Math.max(cursor - width + 1, 0), chars.length - width);
  return {
    chars: chars.slice(start, start + width),
    cursor: cursor - start,
    truncatedStart: start > 0,
    truncatedEnd: start + width < chars.length
  };
}

function canInteract(ctx: WidgetContext): boolean {
  return ctx.cap.interactive && (ctx.keys !== undefined || KeySource.canUseRawMode());
}

/** 与主菜单同一版式：内容列水平居中、整体垂直居中（略偏上），resize 时按新行列重排。 */
function renderFramed(screen: Screen, lines: string[]): void {
  screen.renderDynamic((columns, rows) => {
    const contentWidth = Math.min(columns, Math.max(...lines.map(displayWidth)));
    const leftPad = Math.max(0, Math.floor((columns - contentWidth) / 2));
    const topPad = Math.max(0, Math.floor((rows - lines.length) / 2) - 1);
    const framed = lines.map((line) => `${" ".repeat(leftPad)}${line}`);
    return [...Array<string>(topPad).fill(""), ...framed];
  });
}

/** 取按键源：优先用会话共享的，否则临时创建（调用方负责关闭）。 */
function acquireKeys(ctx: WidgetContext): { source: KeySource; owned: boolean } {
  // 注意：不要在这里清空队列——用户在界面切换间隙的提前输入应该被保留，
  // 清掉会表现为“按键丢失”。
  if (ctx.keys) return { source: ctx.keys, owned: false };
  return { source: new KeySource(), owned: true };
}

/**
 * 逐行模式提问。stdin 被重定向（管道 / EOF）时 readline 可能永不返回，
 * 监听 close 兜底返回 null，调用方视为“取消”，避免空转刷屏。
 */
function askFallback(question: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const done = (value: string | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    rl.once("close", () => done(null));
    rl.question(question).then(
      (answer) => done(answer),
      () => done(null)
    );
  }).finally(() => rl.close());
}

export async function selectOne(
  ctx: WidgetContext,
  title: string,
  options: SelectOption[],
  initialValue?: string
): Promise<string | null> {
  if (options.length === 0) return null;
  const initial = Math.max(0, options.findIndex((option) => option.value === initialValue));
  if (!canInteract(ctx)) return selectFallback(ctx, title, options, initial);

  const { style, symbols } = ctx;
  const { source, owned } = acquireKeys(ctx);
  const screen = new Screen(ctx.cap);
  let index = initial;
  const render = () => {
    const rows = options.map((option, position) => {
      const icon = ctx.cap.unicode && option.icon ? `${option.icon} ` : "";
      const hint = option.hint ? style.dim(`  ${option.hint}`) : "";
      // 不用 inverse：Windows Terminal 对反色单元格里的 emoji 宽度渲染有 bug。
      return position === index
        ? style.softBlock(` ${symbols.pointer} ${icon}${option.label} `) + hint
        : `   ${icon}${option.label}${hint}`;
    });
    const panel = wrapPanel(rows, `${style.accent(symbols.dot)} ${style.strong(title)}`, style, symbols);
    renderFramed(screen, [...panel, "", style.dim("↑↓ 选择 · Enter 确认 · Esc 返回")]);
  };

  try {
    render();
    for (;;) {
      const key = await source.next();
      if (key.name === "up") index = (index - 1 + options.length) % options.length;
      else if (key.name === "down") index = (index + 1) % options.length;
      else if (key.name === "home") index = 0;
      else if (key.name === "end") index = options.length - 1;
      else if (key.name === "enter") {
        const chosen = options[index]!;
        screen.discard();
        return chosen.value;
      } else if (key.name === "escape" || key.name === "ctrl-c" || key.name === "ctrl-d") {
        screen.discard();
        return null;
      } else continue;
      render();
    }
  } finally {
    if (owned) source.close();
  }
}

async function selectFallback(
  ctx: WidgetContext,
  title: string,
  options: SelectOption[],
  initial: number
): Promise<string | null> {
  console.log(`${ctx.style.strong(title)}`);
  options.forEach((option, position) => {
    const hint = option.hint ? ctx.style.dim(`  ${option.hint}`) : "";
    console.log(`  ${position + 1}. ${option.label}${hint}`);
  });
  for (;;) {
    const raw = await askFallback(`选择 [${initial + 1}]（q 取消）：`);
    if (raw === null) return null;
    const answer = raw.trim();
    if (!answer) return options[initial]!.value;
    if (answer.toLowerCase() === "q") return null;
    const picked = Number.parseInt(answer, 10);
    if (Number.isInteger(picked) && picked >= 1 && picked <= options.length) return options[picked - 1]!.value;
    console.log(ctx.style.warning("请输入列表序号。"));
  }
}

export interface TextInputOptions {
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  /** 校验：返回错误文案则阻止提交。 */
  validate?: (value: string) => string | null;
}

export async function textInput(ctx: WidgetContext, label: string, options: TextInputOptions = {}): Promise<string | null> {
  if (!canInteract(ctx)) return textFallback(ctx, label, options);

  const { style, symbols } = ctx;
  const { source, owned } = acquireKeys(ctx);
  const screen = new Screen(ctx.cap);
  const chars = [...(options.defaultValue ?? "")];
  let cursor = chars.length;
  let error: string | null = null;

  const render = () => {
    const width = Math.max(10, (process.stdout.columns ?? ctx.cap.columns) - 6);
    const view = inputWindow(chars, cursor, width);
    const before = view.chars.slice(0, view.cursor).join("");
    const current = view.chars[view.cursor];
    const after = view.chars.slice(view.cursor + 1).join("");
    const field =
      chars.length === 0 && options.placeholder
        ? style.dim(options.placeholder)
        : before + style.inverse(current ?? " ") + after;
    const fieldLine = ` ${symbols.pointer} ${view.truncatedStart ? style.dim(symbols.ellipsis) : ""}${field}${view.truncatedEnd ? style.dim(symbols.ellipsis) : ""}`;
    const content = [fieldLine, ...(error ? ["", style.danger(error)] : [])];
    const panel = wrapPanel(content, `${style.accent(symbols.dot)} ${style.strong(label)}`, style, symbols);
    renderFramed(screen, [...panel, "", style.dim(options.hint ?? "Enter 确认 · Esc 取消")]);
  };

  try {
    render();
    for (;;) {
      const key = await source.next();
      if (key.name === "enter") {
        const value = chars.join("");
        const message = options.validate?.(value) ?? null;
        if (message) {
          error = message;
          render();
          continue;
        }
        screen.commit([`${style.strong(label)}：${value || style.dim(options.placeholder ?? "")}`]);
        return value;
      }
      if (key.name === "escape" || key.name === "ctrl-c" || key.name === "ctrl-d") {
        screen.discard();
        return null;
      }
      error = null;
      if (key.name === "left") cursor = Math.max(0, cursor - 1);
      else if (key.name === "right") cursor = Math.min(chars.length, cursor + 1);
      else if (key.name === "home") cursor = 0;
      else if (key.name === "end") cursor = chars.length;
      else if (key.name === "backspace") {
        if (cursor > 0) {
          chars.splice(cursor - 1, 1);
          cursor -= 1;
        }
      } else if (key.name === "delete") {
        if (cursor < chars.length) chars.splice(cursor, 1);
      } else if (key.name === "char" && key.char) {
        chars.splice(cursor, 0, key.char);
        cursor += 1;
      }
      render();
    }
  } finally {
    if (owned) source.close();
  }
}

async function textFallback(ctx: WidgetContext, label: string, options: TextInputOptions): Promise<string | null> {
  for (;;) {
    const suffix = options.defaultValue ? ` [${options.defaultValue}]` : "";
    const raw = await askFallback(`${label}${suffix}：`);
    if (raw === null) return null;
    const value = raw.trim() || options.defaultValue || "";
    const message = options.validate?.(value) ?? null;
    if (!message) return value;
    console.log(ctx.style.warning(message));
  }
}

export async function confirm(ctx: WidgetContext, label: string, defaultYes = false): Promise<boolean | null> {
  const mark = defaultYes ? "(Y/n)" : "(y/N)";
  if (!canInteract(ctx)) {
    const raw = await askFallback(`${label} ${mark.replace(/[()]/g, "")}：`);
    if (raw === null) return null;
    const answer = raw.trim().toLowerCase();
    if (!answer) return defaultYes;
    if (answer === "y" || answer === "yes" || answer === "是") return true;
    if (answer === "n" || answer === "no" || answer === "否") return false;
    return null;
  }

  const { style, symbols } = ctx;
  const { source, owned } = acquireKeys(ctx);
  const screen = new Screen(ctx.cap);
  const render = () => renderFramed(
    screen,
    wrapPanel([`${style.accent(symbols.dot)} ${style.strong(label)} ${style.dim(mark)}`], null, style, symbols)
  );
  try {
    render();
    for (;;) {
      const key = await source.next();
      if (key.name === "enter") {
        screen.commit([`${style.strong(label)}：${defaultYes ? "是" : "否"}`]);
        return defaultYes;
      }
      if (key.name === "escape" || key.name === "ctrl-c" || key.name === "ctrl-d") {
        screen.discard();
        return null;
      }
      if (key.name === "char") {
        const char = key.char?.toLowerCase();
        if (char === "y") {
          screen.commit([`${style.strong(label)}：是`]);
          return true;
        }
        if (char === "n") {
          screen.commit([`${style.strong(label)}：否`]);
          return false;
        }
      }
    }
  } finally {
    if (owned) source.close();
  }
}

export async function pause(ctx: WidgetContext, message: string | string[]): Promise<void> {
  const lines = Array.isArray(message) ? message : [message];
  if (!canInteract(ctx)) {
    for (const line of lines) console.log(line);
    await askFallback(ctx.style.dim("按回车继续…"));
    return;
  }
  const { style, symbols } = ctx;
  const { source, owned } = acquireKeys(ctx);
  const screen = new Screen(ctx.cap);
  let offset = 0;
  const render = () => {
    screen.renderDynamic((columns, rows) => {
      const panel = wrapPanel(lines, null, style, symbols);
      // 装得下就沿用面板居中版式；装不下退化为顶对齐 + 上下滚动，底行固定提示。
      if (panel.length + 2 <= rows) {
        const block = [...panel, "", style.dim("按任意键继续")];
        const contentWidth = Math.min(columns, Math.max(...block.map(displayWidth)));
        const leftPad = Math.max(0, Math.floor((columns - contentWidth) / 2));
        const topPad = Math.max(0, Math.floor((rows - block.length) / 2) - 1);
        return [...Array<string>(topPad).fill(""), ...block.map((line) => `${" ".repeat(leftPad)}${line}`)];
      }
      const viewport = Math.max(1, rows - 1);
      const maxOffset = Math.max(0, lines.length - viewport);
      offset = Math.min(Math.max(offset, 0), maxOffset);
      const visible = lines.slice(offset, offset + viewport);
      while (visible.length < viewport) visible.push("");
      const progress = maxOffset > 0 ? `${Math.min(offset + viewport, lines.length)}/${lines.length}` : "";
      return [...visible, style.dim(`↑↓ 滚动${progress ? ` ${progress}` : ""} · 其他键继续`)];
    });
  };
  try {
    render();
    for (;;) {
      const key = await source.next();
      if (key.name === "up") { offset -= 1; render(); continue; }
      if (key.name === "down") { offset += 1; render(); continue; }
      if (key.name === "home") { offset = 0; render(); continue; }
      if (key.name === "end") { offset = Number.MAX_SAFE_INTEGER; render(); continue; }
      screen.commit(lines);
      return;
    }
  } finally {
    if (owned) source.close();
  }
}

import { KeyParser, type Key } from "./keymap";

const ESCAPE_DELAY_MS = 30;

/**
 * 从 stdin 持续读取按键。进入 raw mode（终端支持时），
 * 单独的 ESC 通过短暂延迟与转义序列区分。
 */
export class KeySource {
  private readonly parser = new KeyParser();
  private readonly decoder = new TextDecoder();
  private readonly queue: Key[] = [];
  private readonly waiters: Array<(key: Key) => void> = [];
  private escapeTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private suspended = true;

  constructor(private readonly stdin: NodeJS.ReadStream = process.stdin) {
    this.onData = this.onData.bind(this);
    this.resume();
  }

  static canUseRawMode(stdin: NodeJS.ReadStream = process.stdin): boolean {
    return Boolean(stdin.isTTY) && typeof stdin.setRawMode === "function";
  }

  next(): Promise<Key> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    if (this.closed) return;
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    this.escapeTimer = null;
    this.suspend();
    this.closed = true;
  }

  suspend(): void {
    if (this.suspended) return;
    if (this.escapeTimer) clearTimeout(this.escapeTimer);
    this.escapeTimer = null;
    this.parser.flush();
    this.stdin.off("data", this.onData);
    if (this.stdin.isTTY && typeof this.stdin.setRawMode === "function") {
      this.stdin.setRawMode(false);
    }
    this.stdin.pause();
    this.suspended = true;
  }

  resume(): void {
    if (this.closed || !this.suspended) return;
    this.stdin.on("data", this.onData);
    if (this.stdin.isTTY && typeof this.stdin.setRawMode === "function") {
      this.stdin.setRawMode(true);
    }
    this.stdin.resume();
    this.suspended = false;
  }

  /** 丢弃队列里残留的按键（切换组件时调用，避免上个界面的输入泄漏过来）。 */
  clear(): void {
    this.queue.length = 0;
  }

  private onData(chunk: string | Uint8Array): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    if (!text) return;
    this.deliver(this.parser.push(text));
    if (this.parser.hasPending()) {
      if (this.escapeTimer) clearTimeout(this.escapeTimer);
      this.escapeTimer = setTimeout(() => this.deliver(this.parser.flush()), ESCAPE_DELAY_MS);
    }
  }

  private deliver(keys: Key[]): void {
    for (const key of keys) {
      const waiter = this.waiters.shift();
      if (waiter) waiter(key);
      else this.queue.push(key);
    }
  }
}

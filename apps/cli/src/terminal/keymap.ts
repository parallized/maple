/**
 * 键盘输入解析：把终端原始字节流解析成规范化按键事件。
 * 只依赖字符串处理，不绑定具体运行时，方便测试。
 */

export type KeyName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "delete"
  | "backspace"
  | "enter"
  | "escape"
  | "tab"
  | "ctrl-c"
  | "ctrl-d"
  | "char";

export interface Key {
  name: KeyName;
  /** name 为 char 时的可见字符（可以是多字节字符）。 */
  char?: string;
}

/** 值为 null 表示识别但需要丢弃的序列（如 Insert、PageUp/Down）。 */
const ESCAPE_SEQUENCES: Record<string, KeyName | null> = {
  "\x1b[A": "up",
  "\x1bOA": "up",
  "\x1b[B": "down",
  "\x1bOB": "down",
  "\x1b[C": "right",
  "\x1bOC": "right",
  "\x1b[D": "left",
  "\x1bOD": "left",
  "\x1b[H": "home",
  "\x1bOH": "home",
  "\x1b[1~": "home",
  "\x1b[7~": "home",
  "\x1b[F": "end",
  "\x1bOF": "end",
  "\x1b[4~": "end",
  "\x1b[8~": "end",
  "\x1b[2~": null,
  "\x1b[3~": "delete",
  "\x1b[5~": null,
  "\x1b[6~": null,
  "\x1b[Z": "tab"
};

const CONTROL_KEYS: Record<number, KeyName> = {
  0x03: "ctrl-c",
  0x04: "ctrl-d",
  0x09: "tab",
  0x0a: "enter",
  0x0d: "enter",
  0x08: "backspace",
  0x7f: "backspace"
};

const UNKNOWN_SEQUENCE = /^\x1b(?:\[[0-?]*[ -/]*[@-~]|O.|.)/;

export class KeyParser {
  private buffer = "";

  push(chunk: string): Key[] {
    this.buffer += chunk;
    const keys: Key[] = [];
    while (this.buffer.length > 0) {
      if (this.buffer[0] === "\x1b") {
        const exact = this.matchSequence();
        if (exact !== undefined) {
          this.buffer = this.buffer.slice(exact.sequence.length);
          if (exact.name) keys.push({ name: exact.name });
          continue;
        }
        if (this.isSequencePrefix()) break;
        const unknown = this.buffer.match(UNKNOWN_SEQUENCE);
        if (unknown) {
          this.buffer = this.buffer.slice(unknown[0].length);
          continue;
        }
        // 仅剩一个 \x1b：等待后续字节或 flush。
        break;
      }
      const codePoint = this.buffer.codePointAt(0)!;
      const length = codePoint > 0xffff ? 2 : 1;
      const char = this.buffer.slice(0, length);
      this.buffer = this.buffer.slice(length);
      const control = CONTROL_KEYS[codePoint];
      if (control) keys.push({ name: control });
      else if (codePoint >= 0x20) keys.push({ name: "char", char });
    }
    return keys;
  }

  /** 缓冲区还有不完整内容（例如单独的 ESC，需要超时后 flush）。 */
  hasPending(): boolean {
    return this.buffer.length > 0;
  }

  /** 超时后调用：把缓冲区里残留的 ESC 当作独立按键。 */
  flush(): Key[] {
    if (this.buffer === "\x1b") {
      this.buffer = "";
      return [{ name: "escape" }];
    }
    this.buffer = "";
    return [];
  }

  private matchSequence(): { sequence: string; name: KeyName | null } | undefined {
    for (const sequence of Object.keys(ESCAPE_SEQUENCES)) {
      if (this.buffer.startsWith(sequence)) {
        return { sequence, name: ESCAPE_SEQUENCES[sequence]! };
      }
    }
    return undefined;
  }

  private isSequencePrefix(): boolean {
    return Object.keys(ESCAPE_SEQUENCES).some((sequence) => sequence.startsWith(this.buffer));
  }
}

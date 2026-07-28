import type { TerminalCapabilities } from "./capabilities";

const ENTER_ALTERNATE_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H";
const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const LEAVE_ALTERNATE_SCREEN = "\x1b[?25h\x1b[?1049l";

/** CLI 会话级全屏缓冲区；退出后恢复用户原有终端内容。 */
export class FullscreenSession {
  private active = false;

  constructor(
    private readonly cap: TerminalCapabilities,
    private readonly stdout: NodeJS.WriteStream = process.stdout
  ) {}

  enter(): boolean {
    if (this.active || !this.cap.ansi || !this.cap.interactive) return false;
    this.stdout.write(ENTER_ALTERNATE_SCREEN);
    this.active = true;
    return true;
  }

  clear(): void {
    if (this.active) this.stdout.write(CLEAR_SCREEN);
  }

  leave(): void {
    if (!this.active) return;
    this.stdout.write(LEAVE_ALTERNATE_SCREEN);
    this.active = false;
  }
}

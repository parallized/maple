import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REMINDER_AUDIO_FILE_NAME = "reminder-audio.bin";

/**
 * 完成提醒音频文件本体存储（服务端数据目录内单文件）。
 * 文件名 / MIME 元信息保存在 SettingsRepository 中。
 */
export class ReminderAudioRepository {
  constructor(private readonly dataDir: string) {}

  path(): string {
    return join(this.dataDir, REMINDER_AUDIO_FILE_NAME);
  }

  exists(): boolean {
    return existsSync(this.path());
  }

  save(bytes: Uint8Array): void {
    writeFileSync(this.path(), bytes);
  }

  remove(): void {
    rmSync(this.path(), { force: true });
  }
}

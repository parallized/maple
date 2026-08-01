/** 完成提醒音频大小上限（500kB），与 Server 端一致。 */
export const REMINDER_AUDIO_MAX_BYTES = 500 * 1024;

const REMINDER_AUDIO_KEY = "maple.reminder.audio";
const REMINDER_PLAY_CLI_KEY = "maple.reminder.playCli";
const REMINDER_PLAY_MAPLE_KEY = "maple.reminder.playMaple";

export interface LocalReminderAudio {
  name: string;
  mime: string;
  dataUrl: string;
}

/** 非 Server-backed 平台（桌面 / 纯浏览器）的完成提醒本地存储回退。 */

export function loadLocalReminderAudio(): LocalReminderAudio | null {
  try {
    const raw = localStorage.getItem(REMINDER_AUDIO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalReminderAudio;
    if (!parsed?.name || !parsed?.dataUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalReminderAudio(audio: LocalReminderAudio): void {
  try {
    localStorage.setItem(REMINDER_AUDIO_KEY, JSON.stringify(audio));
  } catch {
    // 存储不可用时静默忽略。
  }
}

export function removeLocalReminderAudio(): void {
  try {
    localStorage.removeItem(REMINDER_AUDIO_KEY);
  } catch {
    // 忽略。
  }
}

export function loadLocalReminderPlayCli(): boolean {
  try {
    return localStorage.getItem(REMINDER_PLAY_CLI_KEY) === "true";
  } catch {
    return false;
  }
}

export function loadLocalReminderPlayMaple(): boolean {
  try {
    return localStorage.getItem(REMINDER_PLAY_MAPLE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveLocalReminderPlayCli(enabled: boolean): void {
  try {
    localStorage.setItem(REMINDER_PLAY_CLI_KEY, enabled ? "true" : "false");
  } catch {
    // 忽略。
  }
}

export function saveLocalReminderPlayMaple(enabled: boolean): void {
  try {
    localStorage.setItem(REMINDER_PLAY_MAPLE_KEY, enabled ? "true" : "false");
  } catch {
    // 忽略。
  }
}

/** 将本地音频文件读取为 base64 data URL（本地存储回退用）。 */
export function fileToReminderDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("读取音频文件失败。"));
    reader.readAsDataURL(file);
  });
}

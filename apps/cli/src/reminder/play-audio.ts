import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 在本地播放任务完成提醒音频（fire-and-forget，不阻塞 Runner 循环）。
 *
 * - Windows：WAV 用 System.Media.SoundPlayer；其他格式用
 *   System.Windows.Media.MediaPlayer（隐藏窗口限时播放）。
 * - macOS：afplay；Linux：默认 paplay，可用 MAPLE_AUDIO_PLAYER 覆盖。
 */
export function playReminderAudio(bytes: Uint8Array, mime: string): void {
  try {
    const isWav = mime === "audio/wav" || mime === "audio/x-wav" || mime === "audio/wave";
    const extension = isWav ? "wav" : "audio";
    const filePath = join(tmpdir(), `maple-reminder-${process.pid}-${Date.now()}.${extension}`);
    writeFileSync(filePath, bytes);
    spawnReminderPlayer(filePath, mime);
    // 播放完成后延迟清理临时文件（播放器进程可能仍在读取）。
    setTimeout(() => {
      try {
        rmSync(filePath, { force: true });
      } catch {
        // 清理失败可忽略。
      }
    }, 30_000).unref();
  } catch {
    // 提醒音频播放失败不应影响任务流程。
  }
}

function spawnReminderPlayer(filePath: string, mime: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    const isWav = mime === "audio/wav" || mime === "audio/x-wav" || mime === "audio/wave";
    const escaped = filePath.replace(/'/g, "''");
    const script = isWav
      ? `(New-Object Media.SoundPlayer '${escaped}').PlaySync()`
      : [
          "Add-Type -AssemblyName PresentationCore",
          `$p = New-Object System.Windows.Media.MediaPlayer`,
          `$p.Open([uri]'${escaped}')`,
          "$p.Play()",
          "Start-Sleep -Seconds 30"
        ].join(";");
    const child = spawn(
      "powershell",
      ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
      { stdio: "ignore", windowsHide: true, detached: true }
    );
    child.unref();
    return;
  }
  if (platform === "darwin") {
    const child = spawn("afplay", [filePath], { stdio: "ignore", detached: true });
    child.unref();
    return;
  }
  const player = process.env.MAPLE_AUDIO_PLAYER?.trim() || "paplay";
  const child = spawn(player, [filePath], { stdio: "ignore", detached: true });
  child.unref();
}

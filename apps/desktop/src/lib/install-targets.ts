export type InstallTargetId = "codex" | "claude" | "iflow" | "windsurf";

export const INSTALL_TARGETS: InstallTargetId[] = ["codex", "claude", "iflow", "windsurf"];

export function formatInstallTargetLabel(target: InstallTargetId): string {
  if (target === "codex") return "Codex";
  if (target === "claude") return "Claude";
  if (target === "iflow") return "iFlow";
  return "Windsurf";
}

export function formatInstallTargetIcon(target: InstallTargetId): string {
  if (target === "codex") return "mingcute:code-line";
  if (target === "claude") return "mingcute:chat-1-line";
  if (target === "iflow") return "mingcute:flash-line";
  return "mingcute:wind-line";
}


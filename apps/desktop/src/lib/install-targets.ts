export type InstallTargetId =
  | "codex"
  | "claude"
  | "iflow"
  | "windsurf"
  | "wsl:codex"
  | "wsl:claude"
  | "wsl:iflow";

export const INSTALL_TARGETS: InstallTargetId[] = [
  "codex",
  "claude",
  "iflow",
  "windsurf",
  "wsl:codex",
  "wsl:claude",
  "wsl:iflow"
];

export function formatInstallTargetLabel(target: InstallTargetId): string {
  if (target === "codex") return "Codex";
  if (target === "claude") return "Claude";
  if (target === "iflow") return "iFlow";
  if (target === "wsl:codex") return "WSL · Codex";
  if (target === "wsl:claude") return "WSL · Claude";
  if (target === "wsl:iflow") return "WSL · iFlow";
  return "Windsurf";
}

export function formatInstallTargetIcon(target: InstallTargetId): string {
  if (target === "codex") return "mingcute:code-line";
  if (target === "claude") return "mingcute:chat-1-line";
  if (target === "iflow") return "mingcute:flash-line";
  if (target === "wsl:codex") return "mingcute:code-line";
  if (target === "wsl:claude") return "mingcute:chat-1-line";
  if (target === "wsl:iflow") return "mingcute:flash-line";
  return "mingcute:wind-line";
}

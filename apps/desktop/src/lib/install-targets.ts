export type InstallTargetId =
  | "codex"
  | "claude"
  | "iflow"
  | "gemini"
  | "windsurf"
  | "wsl:codex"
  | "wsl:claude"
  | "wsl:iflow"
  | "wsl:gemini";

export const INSTALL_TARGETS: InstallTargetId[] = [
  "codex",
  "claude",
  "iflow",
  "gemini",
  "windsurf",
  "wsl:codex",
  "wsl:claude",
  "wsl:iflow",
  "wsl:gemini"
];

export function formatInstallTargetLabel(target: InstallTargetId): string {
  if (target === "codex") return "Codex";
  if (target === "claude") return "Claude";
  if (target === "iflow") return "iFlow";
  if (target === "gemini") return "Gemini";
  if (target === "wsl:codex") return "WSL · Codex";
  if (target === "wsl:claude") return "WSL · Claude";
  if (target === "wsl:iflow") return "WSL · iFlow";
  if (target === "wsl:gemini") return "WSL · Gemini";
  return "Windsurf";
}

export function formatInstallTargetIcon(target: InstallTargetId): string {
  if (target === "codex") return "mingcute:code-line";
  if (target === "claude") return "mingcute:chat-1-line";
  if (target === "iflow") return "mingcute:flash-line";
  if (target === "gemini") return "mingcute:ai-line";
  if (target === "wsl:codex") return "mingcute:code-line";
  if (target === "wsl:claude") return "mingcute:chat-1-line";
  if (target === "wsl:iflow") return "mingcute:flash-line";
  if (target === "wsl:gemini") return "mingcute:ai-line";
  return "mingcute:wind-line";
}

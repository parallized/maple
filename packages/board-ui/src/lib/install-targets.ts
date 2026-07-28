export type InstallTargetId =
  | "codex"
  | "claude"
  | "iflow"
  | "gemini"
  | "opencode"
  | "windsurf"
  | "wsl:codex"
  | "wsl:claude"
  | "wsl:iflow"
  | "wsl:gemini"
  | "wsl:opencode";

export const INSTALL_TARGETS: InstallTargetId[] = [
  "codex",
  "claude",
  "iflow",
  "gemini",
  "opencode",
  "windsurf",
  "wsl:codex",
  "wsl:claude",
  "wsl:iflow",
  "wsl:gemini",
  "wsl:opencode"
];

export function formatInstallTargetLabel(target: InstallTargetId): string {
  if (target === "codex") return "Codex";
  if (target === "claude") return "Claude";
  if (target === "iflow") return "iFlow";
  if (target === "gemini") return "Gemini";
  if (target === "opencode") return "OpenCode";
  if (target === "wsl:codex") return "WSL · Codex";
  if (target === "wsl:claude") return "WSL · Claude";
  if (target === "wsl:iflow") return "WSL · iFlow";
  if (target === "wsl:gemini") return "WSL · Gemini";
  if (target === "wsl:opencode") return "WSL · OpenCode";
  return "Windsurf";
}

export function formatInstallTargetIcon(target: InstallTargetId): string {
  if (target === "codex") return "mingcute:code-line";
  if (target === "claude") return "mingcute:chat-1-line";
  if (target === "iflow") return "mingcute:flash-line";
  if (target === "gemini") return "mingcute:ai-line";
  if (target === "opencode") return "mingcute:terminal-line";
  if (target === "wsl:codex") return "mingcute:code-line";
  if (target === "wsl:claude") return "mingcute:chat-1-line";
  if (target === "wsl:iflow") return "mingcute:flash-line";
  if (target === "wsl:gemini") return "mingcute:ai-line";
  if (target === "wsl:opencode") return "mingcute:terminal-box-line";
  return "mingcute:wind-line";
}

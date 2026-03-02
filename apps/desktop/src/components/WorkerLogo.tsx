import { Icon } from "@iconify/react";
import type { WorkerKind } from "../domain";

import claudeLogo from "../assets/worker-claude.png";
import codexLogo from "../assets/worker-codex.png";
import geminiLogo from "../assets/worker-gemini.png";
import iflowLogo from "../assets/worker-iflow.png";
import opencodeLogo from "../assets/worker-opencode.png";

const WORKER_LOGO_SRC: Partial<Record<WorkerKind, string>> = {
  claude: claudeLogo,
  codex: codexLogo,
  gemini: geminiLogo,
  iflow: iflowLogo,
  opencode: opencodeLogo
};

const WORKER_LOGO_ALT: Record<WorkerKind, string> = {
  claude: "Claude",
  codex: "Codex",
  iflow: "iFlow",
  gemini: "Gemini",
  opencode: "OpenCode",
};

type WorkerLogoProps = {
  kind: WorkerKind;
  size?: number;
  className?: string;
};

export function WorkerLogo({ kind, size = 18, className = "" }: WorkerLogoProps) {
  const src = WORKER_LOGO_SRC[kind];
  if (!src) {
    return (
      <span
        role="img"
        aria-label={WORKER_LOGO_ALT[kind]}
        className={`worker-logo worker-logo--${kind} inline-flex items-center justify-center ${className}`.trim()}
        style={{ width: size, height: size }}
      >
        <Icon icon="mingcute:ai-line" style={{ fontSize: Math.max(12, Math.round(size * 0.85)) }} />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={WORKER_LOGO_ALT[kind]}
      width={size}
      height={size}
      className={`worker-logo worker-logo--${kind} ${className}`.trim()}
      loading="lazy"
      decoding="async"
    />
  );
}


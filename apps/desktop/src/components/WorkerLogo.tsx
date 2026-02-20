import type { WorkerKind } from "../domain";

import claudeLogo from "../assets/worker-claude.png";
import codexLogo from "../assets/worker-codex.png";
import iflowLogo from "../assets/worker-iflow.png";

const WORKER_LOGO_SRC: Record<WorkerKind, string> = {
  claude: claudeLogo,
  codex: codexLogo,
  iflow: iflowLogo
};

const WORKER_LOGO_ALT: Record<WorkerKind, string> = {
  claude: "Claude",
  codex: "Codex",
  iflow: "iFlow"
};

type WorkerLogoProps = {
  kind: WorkerKind;
  size?: number;
  className?: string;
};

export function WorkerLogo({ kind, size = 18, className = "" }: WorkerLogoProps) {
  return (
    <img
      src={WORKER_LOGO_SRC[kind]}
      alt={WORKER_LOGO_ALT[kind]}
      width={size}
      height={size}
      className={`worker-logo worker-logo--${kind} ${className}`.trim()}
      loading="lazy"
      decoding="async"
    />
  );
}


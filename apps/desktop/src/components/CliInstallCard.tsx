import { Icon } from "@iconify/react";
import { useState } from "react";

import { copyTextToClipboard } from "../lib/clipboard";
import type { InstallPlatform } from "../lib/cli-install";
import { getCliInstallOptions } from "../lib/cli-install";
import type { UiLanguage } from "../lib/constants";
import type { WorkerKind } from "../domain";

type CliInstallCardProps = {
  workerKind: WorkerKind;
  workerLabel: string;
  uiLanguage: UiLanguage;
  className?: string;
};

function detectPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

function workerKindToTargetId(kind: WorkerKind): "codex" | "claude" | "iflow" {
  return kind;
}

export function CliInstallCard({ workerKind, workerLabel, uiLanguage, className }: CliInstallCardProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const platform = detectPlatform();
  const targetId = workerKindToTargetId(workerKind);
  const options = getCliInstallOptions(targetId, platform);

  if (options.length === 0) return null;

  return (
    <div
      className={`rounded-[12px] border border-[color-mix(in_srgb,var(--color-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_5%,transparent)] p-3 flex flex-col gap-2 ${className ?? ""}`.trim()}
    >
      <div className="flex items-center gap-2 text-[12px] font-sans">
        <Icon icon="mingcute:download-2-line" className="text-[14px] opacity-70" />
        <span className="font-medium text-(--color-base-content)">
          {t(`安装 ${workerLabel} CLI`, `Install ${workerLabel} CLI`)}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {options.map((option) => {
          const isCopied = copiedId === option.id;
          const title = uiLanguage === "en" ? option.titleEn : option.titleZh;
          const note = uiLanguage === "en" ? option.noteEn : option.noteZh;

          return (
            <div key={option.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted font-sans">{title}</span>
                <button
                  type="button"
                  className={`ui-btn ui-btn--xs ui-btn--ghost gap-1 flex-none ${isCopied ? "opacity-80" : ""}`}
                  onClick={async () => {
                    const ok = await copyTextToClipboard(option.command);
                    if (ok) {
                      setCopiedId(option.id);
                      window.setTimeout(() => setCopiedId(null), 1600);
                    }
                  }}
                >
                  <Icon icon={isCopied ? "mingcute:check-line" : "mingcute:copy-2-line"} className="text-[12px]" />
                  <span className="text-[10px]">{isCopied ? t("已复制", "Copied") : t("复制", "Copy")}</span>
                </button>
              </div>
              <pre className="m-0 text-[11px] leading-[1.5] font-mono text-(--color-base-content) bg-[color-mix(in_srgb,var(--color-base-200)_65%,transparent)] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] rounded-[8px] px-2.5 py-1.5 whitespace-pre-wrap break-words select-all">
                {option.command}
              </pre>
              {note ? (
                <p className="m-0 text-[10px] text-muted font-sans opacity-70">{note}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

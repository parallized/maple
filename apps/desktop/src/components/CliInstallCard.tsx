import { Icon } from "@iconify/react";
import { useState } from "react";

import { copyTextToClipboard } from "../lib/clipboard";
import type { InstallPlatform, CliInstallOption } from "../lib/cli-install";
import { getCliInstallOptions, getNodeInstallHint } from "../lib/cli-install";
import type { UiLanguage } from "../lib/constants";
import type { WorkerKind } from "../domain";

type CliInstallCardProps = {
  workerKind: WorkerKind;
  workerLabel: string;
  uiLanguage: UiLanguage;
  className?: string;
  /** Whether npm is available for native runtime */
  nativeNpmFound?: boolean;
  /** Whether npm is available for WSL runtime */
  wslNpmFound?: boolean;
  /** Whether native CLI is detected (undefined = show all) */
  nativeCliFound?: boolean;
  /** Whether WSL CLI is detected (undefined = show all) */
  wslCliFound?: boolean;
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

function OptionItem({
  option,
  uiLanguage,
  copiedId,
  onCopy,
}: {
  option: CliInstallOption;
  uiLanguage: UiLanguage;
  copiedId: string | null;
  onCopy: (id: string, command: string) => void;
}) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const isCopied = copiedId === option.id;
  const title = uiLanguage === "en" ? option.titleEn : option.titleZh;
  const note = uiLanguage === "en" ? option.noteEn : option.noteZh;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted font-sans">{title}</span>
        <button
          type="button"
          className={`ui-btn ui-btn--xs ui-btn--ghost gap-1 flex-none ${isCopied ? "opacity-80" : ""}`}
          onClick={() => onCopy(option.id, option.command)}
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
}

function CliInstallContent({
  workerKind,
  workerLabel,
  uiLanguage,
  nativeNpmFound,
  wslNpmFound,
  nativeCliFound,
  wslCliFound,
}: Pick<CliInstallCardProps, "workerKind" | "workerLabel" | "uiLanguage" | "nativeNpmFound" | "wslNpmFound" | "nativeCliFound" | "wslCliFound">) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const platform = detectPlatform();
  const targetId = workerKindToTargetId(workerKind);
  const options = getCliInstallOptions(targetId, platform);

  if (options.length === 0) return null;

  const handleCopy = async (id: string, command: string) => {
    const ok = await copyTextToClipboard(command);
    if (ok) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1600);
    }
  };

  const isWindows = platform === "windows";
  const hasRuntimeSplit = isWindows && options.some((o) => o.runtime);

  // Show Node.js install hint if npm not found
  const showNativeNpmHint = nativeNpmFound === false;
  const showWslNpmHint = wslNpmFound === false;

  if (hasRuntimeSplit) {
    // Only show sections for runtimes where CLI is NOT detected
    const showNative = nativeCliFound !== true;
    const showWsl = wslCliFound !== true;
    const nativeOptions = showNative ? options.filter((o) => o.runtime === "native") : [];
    const wslOptions = showWsl ? options.filter((o) => o.runtime === "wsl") : [];

    return (
      <div className="flex flex-col gap-3">
        {/* Native section */}
        {nativeOptions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-sans font-medium text-muted">
              <Icon icon="mingcute:computer-line" className="text-[13px] opacity-60" />
              {t("本机（PowerShell / CMD）", "Local (PowerShell / CMD)")}
            </div>
            {showNativeNpmHint && (
              <p className="m-0 text-[10px] font-sans rounded-md px-2 py-1.5 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] border border-[color-mix(in_srgb,var(--color-warning)_20%,transparent)]" style={{ color: "var(--color-warning)" }}>
                <Icon icon="mingcute:information-line" className="text-[11px] mr-1 inline-block -translate-y-px" />
                {t(getNodeInstallHint(platform, "native").zh, getNodeInstallHint(platform, "native").en)}
              </p>
            )}
            {nativeOptions.map((option) => (
              <OptionItem key={option.id} option={option} uiLanguage={uiLanguage} copiedId={copiedId} onCopy={handleCopy} />
            ))}
          </div>
        )}

        {/* WSL section */}
        {wslOptions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-sans font-medium text-muted">
              <Icon icon="mingcute:terminal-box-line" className="text-[13px] opacity-60" />
              {t("WSL 终端", "WSL Terminal")}
            </div>
            {showWslNpmHint && (
              <p className="m-0 text-[10px] font-sans rounded-md px-2 py-1.5 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] border border-[color-mix(in_srgb,var(--color-warning)_20%,transparent)]" style={{ color: "var(--color-warning)" }}>
                <Icon icon="mingcute:information-line" className="text-[11px] mr-1 inline-block -translate-y-px" />
                {t(getNodeInstallHint(platform, "wsl").zh, getNodeInstallHint(platform, "wsl").en)}
              </p>
            )}
            {wslOptions.map((option) => (
              <OptionItem key={option.id} option={option} uiLanguage={uiLanguage} copiedId={copiedId} onCopy={handleCopy} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Non-Windows: flat list
  return (
    <div className="flex flex-col gap-1.5">
      {showNativeNpmHint && (
        <p className="m-0 text-[10px] font-sans rounded-md px-2 py-1.5 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] border border-[color-mix(in_srgb,var(--color-warning)_20%,transparent)]" style={{ color: "var(--color-warning)" }}>
          <Icon icon="mingcute:information-line" className="text-[11px] mr-1 inline-block -translate-y-px" />
          {t(getNodeInstallHint(platform).zh, getNodeInstallHint(platform).en)}
        </p>
      )}
      {options.map((option) => (
        <OptionItem key={option.id} option={option} uiLanguage={uiLanguage} copiedId={copiedId} onCopy={handleCopy} />
      ))}
    </div>
  );
}

export function CliInstallCard({ workerKind, workerLabel, uiLanguage, className, nativeNpmFound, wslNpmFound, nativeCliFound, wslCliFound }: CliInstallCardProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);

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
      <CliInstallContent
        workerKind={workerKind}
        workerLabel={workerLabel}
        uiLanguage={uiLanguage}
        nativeNpmFound={nativeNpmFound}
        wslNpmFound={wslNpmFound}
        nativeCliFound={nativeCliFound}
        wslCliFound={wslCliFound}
      />
    </div>
  );
}

/** Dialog version of CLI install card */
export function CliInstallDialog({
  open,
  workerKind,
  workerLabel,
  uiLanguage,
  nativeNpmFound,
  wslNpmFound,
  nativeCliFound,
  wslCliFound,
  onClose,
}: CliInstallCardProps & { open: boolean; onClose: () => void }) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);

  if (!open) return null;

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label={t("安装 CLI", "Install CLI")}>
      <div className="ui-modal-backdrop" onClick={onClose} />
      <div className="ui-modal-panel" style={{ maxWidth: 520 }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Icon icon="mingcute:download-2-line" className="text-[16px] opacity-70" />
            <h3 className="m-0 text-[14px] font-semibold font-sans">
              {t(`安装 ${workerLabel} CLI`, `Install ${workerLabel} CLI`)}
            </h3>
          </div>
          <button
            type="button"
            className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn"
            onClick={onClose}
            aria-label={t("关闭", "Close")}
          >
            <Icon icon="mingcute:close-line" />
          </button>
        </div>
        <div className="px-4 pb-4">
          <CliInstallContent
            workerKind={workerKind}
            workerLabel={workerLabel}
            uiLanguage={uiLanguage}
            nativeNpmFound={nativeNpmFound}
            wslNpmFound={wslNpmFound}
            nativeCliFound={nativeCliFound}
            wslCliFound={wslCliFound}
          />
        </div>
      </div>
    </div>
  );
}

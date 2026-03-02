import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { copyTextToClipboard } from "../lib/clipboard";
import type { UiLanguage } from "../lib/constants";
import { getCliInstallOptions, getNodeInstallHint } from "../lib/cli-install";
import type { WorkerKind } from "../domain";
import type { InstallTargetId } from "../lib/install-targets";

type InstallRuntime = "native" | "wsl";

type InstallGuideDialogProps = {
  open: boolean;
  uiLanguage: UiLanguage;
  workerKind: WorkerKind;
  workerLabel: string;
  runtime: InstallRuntime;
  mcpUrl: string;
  cliFound: boolean;
  npmFound?: boolean;
  mcpInstalled: boolean;
  installingMcp: boolean;
  onRefresh: () => void;
  onStartMcpInstall: () => void;
  onClose: () => void;
};

type StepProps = {
  index: number;
  title: string;
  icon: string;
  children?: ReactNode;
  isLast?: boolean;
};

function Step({ index, title, icon, children, isLast }: StepProps) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center pt-0.5">
        <div
          className="w-7 h-7 rounded-full border border-[color-mix(in_srgb,var(--color-base-content)_10%,transparent)] bg-(--color-base-100) flex items-center justify-center text-[11px] font-sans text-muted flex-none"
          aria-hidden="true"
        >
          {index}
        </div>
        {!isLast ? (
          <div className="w-px flex-1 mt-1 bg-[color-mix(in_srgb,var(--color-base-content)_10%,transparent)]" />
        ) : null}
      </div>

      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center gap-2">
          <Icon icon={icon} className="text-[16px] opacity-70 flex-none" />
          <div className="text-[13px] font-sans font-medium text-(--color-base-content)">{title}</div>
        </div>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}

function detectPlatform(): "windows" | "macos" | "linux" {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

function getVerifyCommand(workerKind: WorkerKind): string {
  if (workerKind === "claude") return "claude doctor";
  if (workerKind === "iflow") return "iflow --version";
  if (workerKind === "gemini") return "gemini --version";
  if (workerKind === "opencode") return "opencode --version";
  return "codex --version";
}

function CliOptionItem({
  title,
  note,
  command,
  copied,
  onCopy,
  uiLanguage,
}: {
  title: string;
  note?: string;
  command: string;
  copied: boolean;
  onCopy: () => void;
  uiLanguage: UiLanguage;
}) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted font-sans">{title}</span>
        <button
          type="button"
          className={`ui-btn ui-btn--xs ui-btn--ghost gap-1 flex-none ${copied ? "opacity-80" : ""}`}
          onClick={onCopy}
        >
          <Icon icon={copied ? "mingcute:check-line" : "mingcute:copy-2-line"} className="text-[12px]" />
          <span className="text-[10px]">{copied ? t("已复制", "Copied") : t("复制", "Copy")}</span>
        </button>
      </div>
      <pre className="m-0 text-[11px] leading-[1.55] font-mono text-(--color-base-content) bg-[color-mix(in_srgb,var(--color-base-200)_65%,transparent)] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] rounded-[10px] px-2.5 py-2 whitespace-pre-wrap break-words select-all">
        {command}
      </pre>
      {note ? <p className="m-0 text-[10px] text-muted font-sans opacity-70">{note}</p> : null}
    </div>
  );
}

function CommandSnippet({
  uiLanguage,
  command,
  copied,
  onCopy,
}: {
  uiLanguage: UiLanguage;
  command: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted font-sans">{t("命令", "Command")}</span>
        <button
          type="button"
          className={`ui-btn ui-btn--xs ui-btn--ghost gap-1 flex-none ${copied ? "opacity-80" : ""}`}
          onClick={onCopy}
        >
          <Icon icon={copied ? "mingcute:check-line" : "mingcute:copy-2-line"} className="text-[12px]" />
          <span className="text-[10px]">{copied ? t("已复制", "Copied") : t("复制", "Copy")}</span>
        </button>
      </div>
      <pre className="m-0 text-[11px] leading-[1.55] font-mono text-(--color-base-content) bg-[color-mix(in_srgb,var(--color-base-200)_65%,transparent)] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] rounded-[10px] px-2.5 py-2 whitespace-pre-wrap break-words select-all">
        {command}
      </pre>
    </div>
  );
}

export function InstallGuideDialog({
  open,
  uiLanguage,
  workerKind,
  workerLabel,
  runtime,
  mcpUrl,
  cliFound,
  npmFound,
  mcpInstalled,
  installingMcp,
  onRefresh,
  onStartMcpInstall,
  onClose,
}: InstallGuideDialogProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedVerify, setCopiedVerify] = useState(false);

  const platform = detectPlatform();
  const runtimeLabel = runtime === "wsl" ? "WSL" : t("本机", "Local");

  const options = useMemo(() => {
    const targetId = workerKind as unknown as InstallTargetId;
    const raw = getCliInstallOptions(targetId, platform);
    if (platform === "windows") return raw.filter((o) => !o.runtime || o.runtime === runtime);
    return raw;
  }, [workerKind, platform, runtime]);

  const verifyCommand = useMemo(() => getVerifyCommand(workerKind), [workerKind]);

  const showNodeHint = npmFound === false && options.some((o) => o.command.toLowerCase().includes("npm"));
  const nodeHint = showNodeHint ? getNodeInstallHint(platform, platform === "windows" ? runtime : undefined) : null;

  if (!open) return null;

  const mode: "cli" | "mcp" | "ready" = cliFound ? (mcpInstalled ? "ready" : "mcp") : "cli";
  const title =
    mode === "cli" ? t("安装 CLI", "Install CLI") : mode === "mcp" ? t("安装 MCP", "Install MCP") : t("已就绪", "Ready");
  const subtitle = t(`${runtimeLabel} · ${workerLabel}`, `${runtimeLabel} · ${workerLabel}`);

  const canStartMcp = cliFound && !mcpInstalled && !installingMcp;
  const cliReady = cliFound;

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ui-modal-backdrop" onClick={onClose} />
      <div className="ui-modal-panel" style={{ maxWidth: 760 }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Icon icon="mingcute:book-2-line" className="text-[16px] opacity-70" />
              <h3 className="m-0 text-[14px] font-semibold font-sans text-(--color-base-content)">{title}</h3>
            </div>
            <p className="m-0 mt-1 text-[11px] text-muted font-sans opacity-75 truncate">{subtitle}</p>
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

        <div className="ui-modal-body" style={{ paddingRight: 24, paddingLeft: 24 }}>
          <div className="flex flex-col gap-4">
            <Step index={1} title={t("准备 CLI", "Install CLI")} icon="mingcute:download-2-line">
              <p className="m-0 text-[11px] text-muted font-sans leading-relaxed">
                {cliReady
                  ? t("已检测到 CLI，无需重复安装。", "CLI is detected; no need to reinstall.")
                  : t("根据你的环境选择一种安装方式。安装完成后回到 Maple 继续下一步。", "Choose an option below, then return to Maple to continue.")}
              </p>
              {cliReady ? (
                <div className="mt-2 rounded-[10px] border border-[color-mix(in_srgb,var(--color-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_7%,transparent)] px-3 py-2 text-[11px] font-sans text-[var(--color-success)]">
                  <Icon icon="mingcute:check-line" className="text-[12px] mr-1 inline-block -translate-y-px" />
                  {t("CLI 已就绪", "CLI ready")}
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {showNodeHint && nodeHint ? (
                    <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--color-warning)_22%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] px-3 py-2 text-[11px] font-sans" style={{ color: "var(--color-warning)" }}>
                      <Icon icon="mingcute:information-line" className="text-[12px] mr-1 inline-block -translate-y-px" />
                      {t(nodeHint.zh, nodeHint.en)}
                    </div>
                  ) : null}

                  {options.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {options.map((option) => {
                        const titleText = uiLanguage === "en" ? option.titleEn : option.titleZh;
                        const noteText = uiLanguage === "en" ? option.noteEn : option.noteZh;
                        const isCopied = copiedId === option.id;
                        return (
                          <CliOptionItem
                            key={option.id}
                            title={titleText}
                            note={noteText}
                            command={option.command}
                            copied={isCopied}
                            uiLanguage={uiLanguage}
                            onCopy={async () => {
                              const ok = await copyTextToClipboard(option.command);
                              if (!ok) return;
                              setCopiedId(option.id);
                              window.setTimeout(() => setCopiedId(null), 1600);
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--color-warning)_22%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] px-3 py-2 text-[11px] font-sans" style={{ color: "var(--color-warning)" }}>
                      <Icon icon="mingcute:information-line" className="text-[12px] mr-1 inline-block -translate-y-px" />
                      {t("当前平台暂无可用的安装方式。", "No install option is available for this platform.")}
                    </div>
                  )}
                </div>
              )}
            </Step>

            <Step index={2} title={t("验证安装", "Verify")} icon="mingcute:check-circle-line">
              <p className="m-0 text-[11px] text-muted font-sans leading-relaxed">
                {t("在对应终端执行一次检查命令，确保 CLI 可用。", "Run a quick check command in the matching terminal to ensure the CLI works.")}
              </p>
              <div className="mt-3">
                <CommandSnippet
                  uiLanguage={uiLanguage}
                  command={verifyCommand}
                  copied={copiedVerify}
                  onCopy={async () => {
                    const ok = await copyTextToClipboard(verifyCommand);
                    if (!ok) return;
                    setCopiedVerify(true);
                    window.setTimeout(() => setCopiedVerify(false), 1600);
                  }}
                />
              </div>
            </Step>

            <Step index={3} title={t("刷新检测", "Refresh detection")} icon="mingcute:refresh-3-line">
              <p className="m-0 text-[11px] text-muted font-sans leading-relaxed">
                {t("安装完成后点击刷新，让 Maple 重新检测本机 / WSL 环境。", "After installation, click refresh so Maple can re-detect Local / WSL.")}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={onRefresh}>
                  <Icon icon="mingcute:refresh-3-line" className="text-[14px]" />
                  {t("刷新", "Refresh")}
                </button>
                {cliFound ? (
                  <span className="text-[11px] font-sans text-[var(--color-success)]">
                    <Icon icon="mingcute:check-line" className="text-[12px] mr-1 inline-block -translate-y-px" />
                    {t("已检测到 CLI", "CLI detected")}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted font-sans opacity-70">{t("尚未检测到 CLI", "CLI not detected yet")}</span>
                )}
              </div>
            </Step>

            <Step index={4} title={t("安装 MCP", "Install MCP")} icon="mingcute:plugin-2-line" isLast>
              <p className="m-0 text-[11px] text-muted font-sans leading-relaxed">
                {t(
                  "Maple 会为你的 CLI 写入 MCP 配置，并注册 /maple 命令。完成后可在 Worker 卡片中看到「MCP ✓」。",
                  "Maple will write MCP config for your CLI and register the /maple command. After it finishes, you’ll see “MCP ✓” on the Worker card."
                )}
              </p>

              <div className="mt-3 flex items-center gap-2">
                {mcpInstalled ? (
                  <span className="text-[11px] font-sans text-[var(--color-success)]">
                    <Icon icon="mingcute:check-line" className="text-[12px] mr-1 inline-block -translate-y-px" />
                    {t("MCP 已安装", "MCP installed")}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={`ui-btn ui-btn--sm ui-btn--accent gap-1 ${canStartMcp ? "" : "opacity-60"}`.trim()}
                    disabled={!canStartMcp}
                    onClick={onStartMcpInstall}
                  >
                    <Icon icon={installingMcp ? "mingcute:loading-3-line" : "mingcute:download-2-line"} className="text-[14px]" />
                    {installingMcp ? t("安装中…", "Installing…") : t("安装 MCP", "Install MCP")}
                  </button>
                )}

                <button
                  type="button"
                  className="ui-btn ui-btn--sm ui-btn--ghost gap-1"
                  onClick={async () => {
                    const ok = await copyTextToClipboard(mcpUrl);
                    if (!ok) return;
                  }}
                >
                  <Icon icon="mingcute:copy-2-line" className="text-[14px]" />
                  {t("复制 MCP 地址", "Copy MCP URL")}
                </button>
              </div>

              <p className="m-0 mt-2 text-[10px] font-sans text-muted opacity-70">
                MCP: <span className="font-mono">{mcpUrl}</span>
              </p>
            </Step>
          </div>
        </div>
      </div>
    </div>
  );
}

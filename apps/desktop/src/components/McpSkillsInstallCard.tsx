import { Icon } from "@iconify/react";
import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { UiLanguage } from "../lib/constants";
import { hasTauriRuntime } from "../lib/utils";

type InstallPlatform = "windows" | "macos" | "linux";
type InstallTargetId = "codex" | "claude" | "iflow" | "windsurf";

type McpSkillsInstallCardProps = {
  uiLanguage: UiLanguage;
  defaultOpen?: boolean;
  className?: string;
};

type InstallTargetResult = {
  id: InstallTargetId;
  success: boolean;
  skipped: boolean;
  cliFound: boolean | null;
  writtenFiles: string[];
  stdout: string;
  stderr: string;
  error: string | null;
};

type InstallMcpSkillsReport = {
  mcpUrl: string;
  targets: InstallTargetResult[];
};

function detectPlatform(): InstallPlatform {
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac")) return "macos";
  return "linux";
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function formatPlatformLabel(platform: InstallPlatform): string {
  if (platform === "windows") return "Windows";
  if (platform === "macos") return "macOS";
  return "Linux";
}

function formatTargetLabel(target: InstallTargetId): string {
  if (target === "codex") return "Codex";
  if (target === "claude") return "Claude";
  if (target === "iflow") return "iFlow";
  return "Windsurf";
}

function formatTargetIcon(target: InstallTargetId): string {
  if (target === "codex") return "mingcute:code-line";
  if (target === "claude") return "mingcute:chat-1-line";
  if (target === "iflow") return "mingcute:flash-line";
  return "mingcute:wind-line";
}

export function McpSkillsInstallCard({ uiLanguage, defaultOpen = false, className }: McpSkillsInstallCardProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const isTauri = hasTauriRuntime();
  const [open, setOpen] = useState(defaultOpen);
  const [platform, setPlatform] = useState<InstallPlatform>(() => detectPlatform());
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [targets, setTargets] = useState<Record<InstallTargetId, boolean>>(() => ({
    codex: true,
    claude: true,
    iflow: true,
    windsurf: true
  }));
  const [report, setReport] = useState<InstallMcpSkillsReport | null>(null);
  const [installError, setInstallError] = useState("");

  const commandByPlatform = useMemo<Record<InstallPlatform, string>>(
    () => ({
      windows: "powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\maple-install.ps1",
      macos: "bash ./scripts/maple-install.sh",
      linux: "bash ./scripts/maple-install.sh"
    }),
    []
  );

  const command = commandByPlatform[platform];
  const mcpUrl = report?.mcpUrl ?? "http://localhost:45819/mcp";
  const selectedTargets = Object.entries(targets).filter(([, enabled]) => enabled).map(([id]) => id as InstallTargetId);

  return (
    <details
      className={`rounded-[14px] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] bg-(--color-base-100) ${className ?? ""}`.trim()}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="list-none cursor-pointer select-none p-3 lg:p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-[10px] bg-(--color-base-200) flex items-center justify-center flex-none">
            <Icon icon="mingcute:download-2-line" className="text-[16px] opacity-80" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-sans font-semibold text-(--color-base-content) truncate">
              {t("一键安装 MCP & Skills", "Install MCP & Skills")}
            </div>
            <div className="text-[11px] text-muted font-sans opacity-80 truncate">
              {t("配置 Worker 接入，并写入本地 /maple 工作流。", "Configure workers and write local /maple workflow files.")}
            </div>
          </div>
        </div>
        <Icon icon="mingcute:down-line" className="text-[18px] text-muted opacity-70 flex-none" />
      </summary>

      <div className="px-3 lg:px-3.5 pb-3.5 lg:pb-4">
        {isTauri ? (
          <>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Icon icon="mingcute:link-2-line" className="text-[16px] text-muted opacity-80 flex-none" />
                  <span className="text-[12px] text-muted font-sans">
                    {t("MCP 地址", "MCP URL")}
                  </span>
                  <span className="text-[12px] font-mono text-(--color-base-content) opacity-80 truncate">
                    {mcpUrl}
                  </span>
                </div>
                <button
                  type="button"
                  className={`ui-btn ui-btn--xs ui-btn--outline gap-1 ${copied ? "opacity-80" : ""}`}
                  onClick={async () => {
                    const ok = await copyToClipboard(mcpUrl);
                    setCopied(ok);
                    window.setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  <Icon icon={copied ? "mingcute:check-line" : "mingcute:copy-2-line"} className="text-[14px]" />
                  {copied ? t("已复制", "Copied") : t("复制", "Copy")}
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(["codex", "claude", "iflow", "windsurf"] as const).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`ui-btn ui-btn--xs gap-1 ${targets[id] ? "ui-btn--outline" : "ui-btn--ghost"}`}
                    onClick={() => setTargets((prev) => ({ ...prev, [id]: !prev[id] }))}
                    aria-pressed={targets[id]}
                    title={formatTargetLabel(id)}
                  >
                    <Icon icon={formatTargetIcon(id)} className="text-[14px]" />
                    {formatTargetLabel(id)}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-[11px] text-muted font-sans opacity-80">
                  {t(
                    "将写入全局配置目录（如 ~/.codex、~/.claude、~/.iflow、~/.codeium）。",
                    "Writes to global config directories (e.g. ~/.codex, ~/.claude, ~/.iflow, ~/.codeium)."
                  )}
                </p>
                <button
                  type="button"
                  className={`ui-btn ui-btn--sm ui-btn--accent gap-1 ${installing ? "opacity-80" : ""}`}
                  disabled={installing || selectedTargets.length === 0}
                  onClick={async () => {
                    setInstallError("");
                    setReport(null);
                    setInstalling(true);
                    try {
                      const next = await invoke<InstallMcpSkillsReport>("install_mcp_skills", {
                        options: {
                          codex: targets.codex,
                          claude: targets.claude,
                          iflow: targets.iflow,
                          windsurf: targets.windsurf
                        }
                      });
                      setReport(next);
                    } catch (error) {
                      setInstallError(String(error));
                    } finally {
                      setInstalling(false);
                    }
                  }}
                >
                  <Icon icon={installing ? "mingcute:loading-3-line" : "mingcute:download-2-line"} className="text-[16px]" />
                  {installing ? t("安装中…", "Installing…") : t("一键安装", "Install")}
                </button>
              </div>
            </div>

            {installError ? (
              <div className="mt-2 rounded-[10px] border border-[color-mix(in_srgb,var(--color-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-error)_7%,transparent)] px-3 py-2">
                <div className="flex items-center gap-2 text-[12px] font-sans text-(--color-base-content)">
                  <Icon icon="mingcute:warning-line" className="text-[16px]" />
                  <span>{t("安装失败", "Install failed")}</span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-(--color-base-content) opacity-80 whitespace-pre-wrap break-words">
                  {installError}
                </div>
              </div>
            ) : null}

            {report ? (
              <div className="mt-3 flex flex-col gap-2">
                {report.targets.map((target) => {
                  const ok = Boolean(target.success) && !target.error;
                  const icon = ok ? "mingcute:check-line" : "mingcute:close-line";
                  const iconColor = ok ? "var(--color-success)" : "var(--color-error)";
                  const title = formatTargetLabel(target.id);
                  const subtitle =
                    target.cliFound === false
                      ? t("未检测到 CLI，已写入配置文件", "CLI not found; files written")
                      : ok
                        ? t("已完成", "Done")
                        : t("未完成", "Not finished");

                  return (
                    <details
                      key={target.id}
                      className="rounded-[12px] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-base-200)_35%,transparent)] px-3 py-2.5"
                    >
                      <summary className="list-none cursor-pointer select-none flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Icon icon={icon} className="text-[16px] flex-none" style={{ color: iconColor }} />
                          <div className="min-w-0">
                            <div className="text-[12px] font-sans font-semibold text-(--color-base-content) truncate">{title}</div>
                            <div className="text-[11px] text-muted font-sans opacity-80 truncate">{subtitle}</div>
                          </div>
                        </div>
                        <Icon icon="mingcute:down-line" className="text-[16px] text-muted opacity-70 flex-none" />
                      </summary>

                      <div className="mt-2 text-[11px] font-sans text-(--color-base-content) opacity-80">
                        {target.writtenFiles?.length ? (
                          <div className="flex flex-col gap-1">
                            {target.writtenFiles.map((file) => (
                              <div key={file} className="font-mono whitespace-pre-wrap break-words">
                                {file}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-muted">{t("未写入文件。", "No files written.")}</div>
                        )}

                        {target.error ? (
                          <div className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-words" style={{ color: "var(--color-error)" }}>
                            {target.error}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-1">
                {(["windows", "macos", "linux"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`ui-btn ui-btn--xs ${platform === item ? "ui-btn--outline" : "ui-btn--ghost"}`}
                    onClick={() => setPlatform(item)}
                  >
                    {formatPlatformLabel(item)}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`ui-btn ui-btn--xs ui-btn--outline gap-1 ${copied ? "opacity-80" : ""}`}
                onClick={async () => {
                  const ok = await copyToClipboard(command);
                  setCopied(ok);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              >
                <Icon icon={copied ? "mingcute:check-line" : "mingcute:copy-2-line"} className="text-[14px]" />
                {copied ? t("已复制", "Copied") : t("复制命令", "Copy")}
              </button>
            </div>

            <pre className="m-0 text-[11px] leading-relaxed font-mono text-(--color-base-content) bg-[color-mix(in_srgb,var(--color-base-200)_55%,transparent)] border border-[color-mix(in_srgb,var(--color-base-300)_55%,transparent)] rounded-[10px] px-3 py-2.5 whitespace-pre-wrap break-words">
              {command}
            </pre>

            <p className="m-0 mt-2 text-[11px] text-muted font-sans opacity-80">
              {t(
                "请在 Maple 仓库根目录执行。安装后重启对应 Worker（Codex / Claude / iFlow / Windsurf）。",
                "Run from the Maple repo root. Restart the worker (Codex / Claude / iFlow / Windsurf) after install."
              )}
            </p>
          </>
        )}
      </div>
    </details>
  );
}

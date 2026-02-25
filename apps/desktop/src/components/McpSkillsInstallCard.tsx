import { Icon } from "@iconify/react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { copyTextToClipboard } from "../lib/clipboard";
import type { UiLanguage } from "../lib/constants";
import { hasTauriRuntime } from "../lib/utils";
import { INSTALL_TARGETS, type InstallTargetId, formatInstallTargetIcon, formatInstallTargetLabel } from "../lib/install-targets";
import { InstallTaskWindow, type InstallTargetResult, type InstallTargetState } from "./InstallTaskWindow";

type InstallPlatform = "windows" | "macos" | "linux";

type McpSkillsInstallCardProps = {
  uiLanguage: UiLanguage;
  defaultOpen?: boolean;
  className?: string;
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

function formatPlatformLabel(platform: InstallPlatform): string {
  if (platform === "windows") return "Windows";
  if (platform === "macos") return "macOS";
  return "Linux";
}

type InstallTaskEvent =
  | { kind: "log"; installId: string; targetId?: string | null; stream?: string | null; line?: string | null }
  | { kind: "target_state"; installId: string; targetId?: string | null; state?: string | null }
  | { kind: "target_result"; installId: string; targetId?: string | null; target?: InstallTargetResult | null };

function isInstallTargetId(value: string): value is InstallTargetId {
  return INSTALL_TARGETS.includes(value as InstallTargetId);
}

function formatInstallLogLine(payload: Extract<InstallTaskEvent, { kind: "log" }>): string {
  const raw = payload.line ?? "";
  if (!raw) return "";

  const targetId = (payload.targetId ?? "").trim();
  const stream = (payload.stream ?? "").trim();
  const tags: string[] = [];

  if (targetId) {
    tags.push(isInstallTargetId(targetId) ? formatInstallTargetLabel(targetId) : targetId);
  }
  if (stream) {
    tags.push(stream);
  }

  if (tags.length === 0) return raw;
  const prefix = `[${tags.join("][")}] `;
  const normalized = raw.replace(/\r\n/g, "\n");
  return normalized
    .split("\n")
    .map((line) => (line.trim().length === 0 ? line : `${prefix}${line}`))
    .join("\n");
}

export function McpSkillsInstallCard({ uiLanguage, defaultOpen = false, className }: McpSkillsInstallCardProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const isTauri = hasTauriRuntime();
  const [open, setOpen] = useState(defaultOpen);
  const [platform, setPlatform] = useState<InstallPlatform>(() => detectPlatform());
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installWindowOpen, setInstallWindowOpen] = useState(false);
  const [installWindowTargets, setInstallWindowTargets] = useState<InstallTargetId[]>([]);
  const [installId, setInstallId] = useState("");
  const installIdRef = useRef("");
  const [installLog, setInstallLog] = useState("");
  const [installTargetStates, setInstallTargetStates] = useState<Record<InstallTargetId, InstallTargetState>>(() => ({
    codex: "idle",
    claude: "idle",
    iflow: "idle",
    windsurf: "idle"
  }));
  const [installTargetResults, setInstallTargetResults] = useState<Partial<Record<InstallTargetId, InstallTargetResult>>>({});
  const [targets, setTargets] = useState<Record<InstallTargetId, boolean>>(() => ({
    codex: true,
    claude: true,
    iflow: true,
    windsurf: true
  }));
  const [report, setReport] = useState<InstallMcpSkillsReport | null>(null);
  const [installError, setInstallError] = useState("");

  useEffect(() => {
    installIdRef.current = installId;
  }, [installId]);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen<InstallTaskEvent>("maple://install-task-event", (event) => {
      const payload = event.payload;
      if (!payload) return;
      if (!payload.installId || payload.installId !== installIdRef.current) return;

      if (payload.kind === "log") {
        const line = formatInstallLogLine(payload);
        if (!line) return;
        setInstallLog((prev) => `${prev}${line}`);
        return;
      }

      const rawTargetId = (payload.targetId ?? "").trim();
      if (!rawTargetId || !isInstallTargetId(rawTargetId)) return;

      if (payload.kind === "target_state") {
        const state = (payload.state ?? "").trim();
        if (state !== "running" && state !== "success" && state !== "error") return;
        setInstallTargetStates((prev) => ({ ...prev, [rawTargetId]: state }));
        return;
      }

      if (payload.kind === "target_result") {
        const target = payload.target ?? null;
        if (!target) return;
        setInstallTargetResults((prev) => ({ ...prev, [rawTargetId]: target }));
        return;
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [isTauri]);

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
  const canReopenInstallWindow = !installWindowOpen && (installing || installLog.trim().length > 0 || Boolean(installError));
  const reopenInstallWindowLabel = installing ? t("查看进度", "View progress") : t("查看日志", "View log");

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
                      const ok = await copyTextToClipboard(mcpUrl);
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
                    title={formatInstallTargetLabel(id)}
                  >
                    <Icon icon={formatInstallTargetIcon(id)} className="text-[14px]" />
                    {formatInstallTargetLabel(id)}
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
                <div className="flex items-center gap-2 flex-none">
                  {canReopenInstallWindow ? (
                    <button
                      type="button"
                      className="ui-btn ui-btn--sm ui-btn--outline gap-1"
                      onClick={() => setInstallWindowOpen(true)}
                    >
                      <Icon icon="mingcute:terminal-box-line" className="text-[16px]" />
                      {reopenInstallWindowLabel}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`ui-btn ui-btn--sm ui-btn--accent gap-1 ${installing ? "opacity-80" : ""}`}
                    disabled={installing || selectedTargets.length === 0}
                    onClick={async () => {
                      const nextInstallId = `install-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                      installIdRef.current = nextInstallId;
                      setInstallId(nextInstallId);
                      setInstallError("");
                      setReport(null);
                      setInstallLog("");
                      setInstallTargetResults({});
                      setInstallTargetStates({
                        codex: "idle",
                        claude: "idle",
                        iflow: "idle",
                        windsurf: "idle"
                      });
                      setInstallWindowTargets(selectedTargets);
                      setInstallWindowOpen(true);
                      setInstalling(true);
                      try {
                        const next = await invoke<InstallMcpSkillsReport>("install_mcp_skills", {
                          options: {
                            codex: targets.codex,
                            claude: targets.claude,
                            iflow: targets.iflow,
                            windsurf: targets.windsurf,
                            installId: nextInstallId
                          }
                        });
                        setReport(next);
                        setInstallTargetResults(next.targets.reduce((acc, item) => {
                          acc[item.id] = item;
                          return acc;
                        }, {} as Partial<Record<InstallTargetId, InstallTargetResult>>));
                        setInstallTargetStates((prev) => {
                          const nextStates = { ...prev };
                          for (const item of next.targets) {
                            nextStates[item.id] = item.success && !item.error ? "success" : "error";
                          }
                          return nextStates;
                        });
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
                  const title = formatInstallTargetLabel(target.id);
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

            <InstallTaskWindow
              open={installWindowOpen}
              uiLanguage={uiLanguage}
              title={t("安装 MCP & Skills", "Install MCP & Skills")}
              subtitle={installing ? t("正在写入配置并注册 MCP…", "Writing config and registering MCP…") : `MCP: ${mcpUrl}`}
              installing={installing}
              targets={installWindowTargets}
              targetStates={installTargetStates}
              results={installTargetResults}
              log={installLog}
              error={installError}
              onClose={() => setInstallWindowOpen(false)}
            />
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
                      const ok = await copyTextToClipboard(command);
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

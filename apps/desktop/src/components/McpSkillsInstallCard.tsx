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

type InstallTargetProbe = {
  id: InstallTargetId;
  runtime: "native" | "wsl";
  cliFound: boolean;
  installed: boolean;
};

type McpSkillsInstallCardProps = {
  uiLanguage: UiLanguage;
  defaultOpen?: boolean;
  className?: string;
  showDetectButton?: boolean;
  probeToken?: number;
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

export function McpSkillsInstallCard({
  uiLanguage,
  defaultOpen = false,
  className,
  showDetectButton = true,
  probeToken
}: McpSkillsInstallCardProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const isTauri = hasTauriRuntime();
  const isWindows = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");
  const [open, setOpen] = useState(defaultOpen);
  const [platform, setPlatform] = useState<InstallPlatform>(() => detectPlatform());
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState("");
  const [installWindowOpen, setInstallWindowOpen] = useState(false);
  const [installWindowTargets, setInstallWindowTargets] = useState<InstallTargetId[]>([]);
  const [installId, setInstallId] = useState("");
  const installIdRef = useRef("");
  const targetsEditedRef = useRef(false);
  const [installLog, setInstallLog] = useState("");
  const [installTargetStates, setInstallTargetStates] = useState<Record<InstallTargetId, InstallTargetState>>(
    () => Object.fromEntries(INSTALL_TARGETS.map((id) => [id, "idle"])) as Record<InstallTargetId, InstallTargetState>
  );
  const [installTargetResults, setInstallTargetResults] = useState<Partial<Record<InstallTargetId, InstallTargetResult>>>({});
  const [targets, setTargets] = useState<Record<InstallTargetId, boolean>>(
    () => Object.fromEntries(INSTALL_TARGETS.map((id) => [id, id === "windsurf"])) as Record<InstallTargetId, boolean>
  );
  const [probeById, setProbeById] = useState<Partial<Record<InstallTargetId, InstallTargetProbe>>>({});
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

  async function probeTargets() {
    if (!isTauri) return;

    setProbing(true);
    setProbeError("");

    try {
      const probes = await invoke<InstallTargetProbe[]>("probe_install_targets");
      const nextProbeById: Partial<Record<InstallTargetId, InstallTargetProbe>> = {};
      for (const probe of probes) {
        nextProbeById[probe.id] = probe;
      }
      setProbeById(nextProbeById);

      setTargets((prev) => {
        const next = { ...prev };
        for (const probe of probes) {
          const selectable = Boolean(probe.cliFound);
          if (targetsEditedRef.current) {
            next[probe.id] = Boolean(prev[probe.id]) && selectable;
          } else {
            next[probe.id] = selectable && !probe.installed;
          }
        }

        if (!isWindows) {
          next["wsl:codex"] = false;
          next["wsl:claude"] = false;
          next["wsl:iflow"] = false;
        }

        // Do not override Windsurf selection based on probing.
        next.windsurf = prev.windsurf;
        return next;
      });
    } catch (error) {
      setProbeError(String(error));
    } finally {
      setProbing(false);
    }
  }

  useEffect(() => {
    if (!isTauri) return;
    void probeTargets();
  }, [isTauri, probeToken]);

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

  const installTargetHintLabels = selectedTargets.map((id) => formatInstallTargetLabel(id));

  const installHint =
    installTargetHintLabels.length > 0
      ? t(`将安装：${installTargetHintLabels.join("、")}`, `Will install: ${installTargetHintLabels.join(", ")}`)
      : "";

  const probeIds: InstallTargetId[] = isWindows
    ? ["codex", "claude", "iflow", "wsl:codex", "wsl:claude", "wsl:iflow"]
    : ["codex", "claude", "iflow"];
  const detectedLabels = probeIds.filter((id) => Boolean(probeById[id]?.cliFound)).map((id) => formatInstallTargetLabel(id));

  const detectedSummary =
    probing
      ? t("正在检测环境…", "Detecting environment…")
      : detectedLabels.length > 0
        ? t(`已检测到：${detectedLabels.join("、")}`, `Detected: ${detectedLabels.join(", ")}`)
        : t("未检测到可用的 CLI。先安装 CLI，再回到这里一键接入。", "No CLI detected. Install the CLI first, then come back to connect.");

  const canReopenInstallWindow = !installWindowOpen && (installing || installLog.trim().length > 0 || Boolean(installError));
  const reopenInstallWindowLabel = installing ? t("查看进度", "View progress") : t("查看日志", "View log");
  const installButtonLabel =
    selectedTargets.length > 0
      ? t(`安装 ${installTargetHintLabels.join(" · ")}`, `Install ${installTargetHintLabels.join(" · ")}`)
      : t("请选择目标", "Select targets");

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

              <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-[11px] text-muted font-sans opacity-80 truncate">
                  {detectedSummary}
                </p>
                {showDetectButton ? (
                  <button
                    type="button"
                    className="ui-btn ui-btn--xs ui-btn--ghost gap-1 flex-none"
                    onClick={() => void probeTargets()}
                    disabled={probing || installing}
                    title={t("重新检测", "Re-detect")}
                  >
                    <Icon icon={probing ? "mingcute:loading-3-line" : "mingcute:refresh-2-line"} className="text-[14px]" />
                    <span className="text-[11px]">{t("刷新", "Refresh")}</span>
                  </button>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(isWindows
                  ? (["codex", "claude", "iflow", "wsl:codex", "wsl:claude", "wsl:iflow", "windsurf"] as const)
                  : (["codex", "claude", "iflow", "windsurf"] as const)
                ).map((id) => {
                  const probe = probeById[id];
                  const selectable = id === "windsurf" ? true : Boolean(probe?.cliFound);
                  const installed = id === "windsurf" ? false : Boolean(probe?.installed);
                  const disabled = installing || !selectable;
                  const label = formatInstallTargetLabel(id);
                  const notes: string[] = [];
                  if (installed) notes.push(t("已安装", "Installed"));
                  if (!selectable && id !== "windsurf") notes.push(t("未检测到 CLI", "CLI not detected"));
                  const title = notes.length > 0 ? `${label} · ${notes.join(" · ")}` : label;

                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={disabled}
                      className={`ui-btn ui-btn--xs gap-1 ${targets[id] ? "ui-btn--outline" : "ui-btn--ghost"} ${disabled ? "opacity-45 cursor-not-allowed" : ""}`}
                      onClick={() => {
                        targetsEditedRef.current = true;
                        setTargets((prev) => ({ ...prev, [id]: !prev[id] }));
                      }}
                      aria-pressed={targets[id]}
                      title={title}
                    >
                      <Icon icon={formatInstallTargetIcon(id)} className="text-[14px]" />
                      {label}
                      {installed ? <Icon icon="mingcute:check-line" className="text-[12px] opacity-60" /> : null}
                    </button>
                  );
                })}
              </div>

              {probeError ? (
                <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--color-error)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-error)_6%,transparent)] px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] font-sans text-(--color-base-content) opacity-85">
                    <Icon icon="mingcute:warning-line" className="text-[14px]" />
                    <span className="truncate">{t("环境检测失败", "Detection failed")}</span>
                  </div>
                  <div className="mt-1 text-[10px] font-mono text-(--color-base-content) opacity-75 whitespace-pre-wrap break-words">
                    {probeError}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-[11px] text-muted font-sans opacity-80">
                  {t(
                    "将写入全局配置目录（~/.codex、~/.claude、~/.iflow、~/.codeium）。Windows 上支持分别配置本机与 WSL：会写入对应的 home 目录，并在对应环境内注册 MCP。",
                    "Writes to global config directories (~/.codex, ~/.claude, ~/.iflow, ~/.codeium). On Windows, Maple can configure both Local and WSL: it writes to the corresponding home directory and registers MCP in that runtime."
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
                      setInstallTargetStates(
                        Object.fromEntries(INSTALL_TARGETS.map((id) => [id, "idle"])) as Record<InstallTargetId, InstallTargetState>
                      );
                      setInstallWindowTargets(selectedTargets);
                      setInstallWindowOpen(true);
                      setInstalling(true);
                      try {
                        const next = await invoke<InstallMcpSkillsReport>("install_mcp_skills", {
                          options: {
                            codex: targets.codex,
                            claude: targets.claude,
                            iflow: targets.iflow,
                            wslCodex: targets["wsl:codex"],
                            wslClaude: targets["wsl:claude"],
                            wslIflow: targets["wsl:iflow"],
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
                    {installing ? t("安装中…", "Installing…") : installButtonLabel}
                  </button>
                </div>
              </div>

              {installHint ? (
                <p className="m-0 text-[10px] text-muted font-sans opacity-70">
                  {installHint}
                </p>
              ) : null}
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
                  const showScopeLabel = !target.id.startsWith("wsl:");
                  const scopeLabel =
                    showScopeLabel
                      ? target.runtime === "wsl"
                        ? "WSL"
                        : target.runtime === "native"
                          ? t("本机", "Local")
                          : ""
                      : "";
                  const subtitle =
                    target.skipped
                      ? t("未检测到 CLI，已跳过", "CLI not found; skipped")
                      : ok
                        ? t("已完成", "Done")
                        : t("未完成", "Not finished");
                  const subtitleText = scopeLabel ? `${scopeLabel} · ${subtitle}` : subtitle;

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
                            <div className="text-[11px] text-muted font-sans opacity-80 truncate">{subtitleText}</div>
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

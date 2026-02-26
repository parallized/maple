import { Icon } from "@iconify/react";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { WorkerLogo } from "./WorkerLogo";
import { CliInstallCard, CliInstallDialog } from "./CliInstallCard";
import { InstallTaskWindow, type InstallTargetResult, type InstallTargetState } from "./InstallTaskWindow";
import { copyTextToClipboard } from "../lib/clipboard";
import type { UiLanguage } from "../lib/constants";
import type { WorkerKind } from "../domain";
import { hasTauriRuntime } from "../lib/utils";
import type { InstallTargetId } from "../lib/install-targets";
import { INSTALL_TARGETS, formatInstallTargetLabel, formatInstallTargetIcon } from "../lib/install-targets";

export type WorkerProbe = {
  id: InstallTargetId;
  runtime: "native" | "wsl";
  cliFound: boolean;
  installed: boolean;
  npmFound: boolean;
};

type InstallTaskEvent =
  | { kind: "log"; installId: string; targetId?: string | null; stream?: string | null; line?: string | null }
  | { kind: "target_state"; installId: string; targetId?: string | null; state?: string | null }
  | { kind: "target_result"; installId: string; targetId?: string | null; target?: InstallTargetResult | null };

type InstallMcpSkillsReport = {
  mcpUrl: string;
  targets: InstallTargetResult[];
};

type WorkerConfigCardProps = {
  kind: WorkerKind;
  label: string;
  executable: string;
  available: boolean;
  /** native probe for this worker */
  nativeProbe?: WorkerProbe;
  /** wsl probe for this worker (Windows only) */
  wslProbe?: WorkerProbe;
  uiLanguage: UiLanguage;
  /** Variant: "overview" shows compact, "settings" shows full with install */
  variant?: "overview" | "settings";
};

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
  if (stream) tags.push(stream);
  if (tags.length === 0) return raw;
  const prefix = `[${tags.join("][")}] `;
  const normalized = raw.replace(/\r\n/g, "\n");
  return normalized
    .split("\n")
    .map((line) => (line.trim().length === 0 ? line : `${prefix}${line}`))
    .join("\n");
}

export function WorkerConfigCard({
  kind,
  label,
  executable,
  available,
  nativeProbe,
  wslProbe,
  uiLanguage,
  variant = "settings",
}: WorkerConfigCardProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const isTauri = hasTauriRuntime();
  const isWindows = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");

  const [installing, setInstalling] = useState(false);
  const [installWindowOpen, setInstallWindowOpen] = useState(false);
  const [installWindowTargets, setInstallWindowTargets] = useState<InstallTargetId[]>([]);
  const [installId, setInstallId] = useState("");
  const installIdRef = useRef("");
  const [installLog, setInstallLog] = useState("");
  const [installError, setInstallError] = useState("");
  const [installTargetStates, setInstallTargetStates] = useState<Record<InstallTargetId, InstallTargetState>>(
    () => Object.fromEntries(INSTALL_TARGETS.map((id) => [id, "idle"])) as Record<InstallTargetId, InstallTargetState>
  );
  const [installTargetResults, setInstallTargetResults] = useState<Partial<Record<InstallTargetId, InstallTargetResult>>>({});
  const [cliDialogOpen, setCliDialogOpen] = useState(false);

  useEffect(() => {
    installIdRef.current = installId;
  }, [installId]);

  // Listen for install events
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
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [isTauri]);

  // Determine what install targets are relevant for this worker
  const nativeTargetId: InstallTargetId = kind;
  const wslTargetId: InstallTargetId = `wsl:${kind}` as InstallTargetId;

  const nativeCliFound = nativeProbe?.cliFound ?? false;
  const nativeInstalled = nativeProbe?.installed ?? false;
  const wslCliFound = wslProbe?.cliFound ?? false;
  const wslInstalled = wslProbe?.installed ?? false;

  const mcpUrl = "http://localhost:45819/mcp";

  const canReopenInstallWindow = !installWindowOpen && (installing || installLog.trim().length > 0 || Boolean(installError));

  async function doInstall(targetIds: InstallTargetId[]) {
    if (!isTauri || installing) return;

    const nextInstallId = `install-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    installIdRef.current = nextInstallId;
    setInstallId(nextInstallId);
    setInstallError("");
    setInstallLog("");
    setInstallTargetResults({});
    setInstallTargetStates(
      Object.fromEntries(INSTALL_TARGETS.map((id) => [id, "idle"])) as Record<InstallTargetId, InstallTargetState>
    );
    setInstallWindowTargets(targetIds);
    setInstallWindowOpen(true);
    setInstalling(true);

    try {
      const options: Record<string, boolean | string> = {
        codex: false,
        claude: false,
        iflow: false,
        wslCodex: false,
        wslClaude: false,
        wslIflow: false,
        windsurf: false,
        installId: nextInstallId,
      };
      for (const id of targetIds) {
        if (id === "codex") options.codex = true;
        else if (id === "claude") options.claude = true;
        else if (id === "iflow") options.iflow = true;
        else if (id === "wsl:codex") options.wslCodex = true;
        else if (id === "wsl:claude") options.wslClaude = true;
        else if (id === "wsl:iflow") options.wslIflow = true;
        else if (id === "windsurf") options.windsurf = true;
      }

      const report = await invoke<InstallMcpSkillsReport>("install_mcp_skills", { options });
      setInstallTargetResults(
        report.targets.reduce((acc, item) => {
          acc[item.id] = item;
          return acc;
        }, {} as Partial<Record<InstallTargetId, InstallTargetResult>>)
      );
      setInstallTargetStates((prev) => {
        const next = { ...prev };
        for (const item of report.targets) {
          next[item.id] = item.success && !item.error ? "success" : "error";
        }
        return next;
      });
    } catch (error) {
      setInstallError(String(error));
    } finally {
      setInstalling(false);
    }
  }

  // Build rows for native and WSL
  type Row = {
    id: InstallTargetId;
    runtimeLabel: string;
    cliFound: boolean;
    installed: boolean;
  };
  const rows: Row[] = [
    { id: nativeTargetId, runtimeLabel: t("本机", "Local"), cliFound: nativeCliFound, installed: nativeInstalled },
  ];
  if (isWindows) {
    rows.push({ id: wslTargetId, runtimeLabel: "WSL", cliFound: wslCliFound, installed: wslInstalled });
  }

  // For overview variant, show compact card with install actions
  if (variant === "overview") {
    const uninstalledMcpRows = rows.filter((r) => r.cliFound && !r.installed);

    return (
      <div className="group rounded-[12px] lg:rounded-[14px] bg-(--color-base-100) hover:bg-(--color-base-200) transition-all duration-300 flex flex-col flex-none overflow-hidden">
        <div className="p-3 lg:p-4 flex flex-col gap-1.5 lg:gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative w-6 h-6 rounded-lg bg-(--color-base-200) flex items-center justify-center flex-none">
                <WorkerLogo kind={kind} size={16} />
                <span
                  className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-(--color-base-100) ${available ? "bg-green-500" : "bg-(--color-base-300)"}`}
                  aria-label={available ? t("可用", "Available") : t("未配置", "Not configured")}
                />
              </div>
              <span className="font-medium text-[13px] lg:text-[14px] font-sans text-(--color-base-content) truncate">{label}</span>
            </div>
            {/* MCP status badges */}
            <div className="flex items-center gap-1.5">
              {rows.map((row) => {
                if (!row.cliFound) return null;
                return (
                  <span
                    key={row.id}
                    className={`text-[10px] font-sans px-1.5 py-0.5 rounded-md ${
                      row.installed
                        ? "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                        : "bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]"
                    }`}
                  >
                    {row.runtimeLabel} MCP {row.installed ? "✓" : "✗"}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="text-[10px] lg:text-[11px] text-muted font-mono opacity-60 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 pl-3 lg:pl-4">
            <Icon icon="mingcute:terminal-box-line" className="text-[12px] lg:text-[13px] flex-none" />
            <span className="truncate">{executable || t("未检测到", "Not detected")}</span>
          </div>

          {/* Install actions */}
          {rows.some((r) => !r.cliFound) ? (
            <div className="flex flex-col gap-1.5 mt-0.5">
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--outline gap-1 self-start ml-3 lg:ml-4"
                onClick={() => setCliDialogOpen(true)}
              >
                <Icon icon="mingcute:download-2-line" className="text-[12px]" />
                {t("安装 CLI", "Install CLI")}
              </button>
            </div>
          ) : uninstalledMcpRows.length > 0 ? (
            <div className="flex items-center gap-1.5 mt-0.5 pl-3 lg:pl-4">
              {uninstalledMcpRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`ui-btn ui-btn--xs ui-btn--outline gap-1 ${installing ? "opacity-70" : ""}`}
                  disabled={installing}
                  onClick={() => void doInstall([row.id])}
                >
                  <Icon icon={installing ? "mingcute:loading-3-line" : "mingcute:download-2-line"} className="text-[12px]" />
                  {installing
                    ? t("安装中…", "Installing…")
                    : uninstalledMcpRows.length > 1
                      ? t(`安装 ${row.runtimeLabel} MCP`, `Install ${row.runtimeLabel} MCP`)
                      : t("安装 MCP", "Install MCP")}
                </button>
              ))}
            </div>
          ) : null}

          {/* Reopen install window */}
          {canReopenInstallWindow && (
            <div className="pl-3 lg:pl-4">
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--ghost gap-1"
                onClick={() => setInstallWindowOpen(true)}
              >
                <Icon icon="mingcute:terminal-box-line" className="text-[12px]" />
                {installing ? t("查看进度", "View progress") : t("查看日志", "View log")}
              </button>
            </div>
          )}
        </div>

        {/* Install task modal */}
        <InstallTaskWindow
          open={installWindowOpen}
          uiLanguage={uiLanguage}
          title={t(`安装 ${label} MCP`, `Install ${label} MCP`)}
          subtitle={installing ? t("正在写入配置并注册 MCP…", "Writing config and registering MCP…") : `MCP: ${mcpUrl}`}
          installing={installing}
          targets={installWindowTargets}
          targetStates={installTargetStates}
          results={installTargetResults}
          log={installLog}
          error={installError}
          onClose={() => setInstallWindowOpen(false)}
        />

        {/* CLI install dialog */}
        <CliInstallDialog
          open={cliDialogOpen}
          workerKind={kind}
          workerLabel={label}
          uiLanguage={uiLanguage}
          nativeNpmFound={nativeProbe?.npmFound}
          wslNpmFound={wslProbe?.npmFound}
          nativeCliFound={nativeCliFound}
          wslCliFound={wslCliFound}
          onClose={() => setCliDialogOpen(false)}
        />
      </div>
    );
  }

  // Settings variant - full card with install capability
  return (
    <div className="rounded-[14px] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] bg-(--color-base-100) flex flex-col overflow-hidden">
      <div className="p-3.5 lg:p-4 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative w-8 h-8 rounded-[10px] bg-(--color-base-200) flex items-center justify-center flex-none">
              <WorkerLogo kind={kind} size={20} />
              <span
                className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-(--color-base-100) ${available ? "bg-green-500" : "bg-(--color-base-300)"}`}
              />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-[14px] font-sans text-(--color-base-content) truncate">{label}</div>
              <div className="text-[11px] text-muted font-mono opacity-70 flex items-center gap-1.5">
                <Icon icon="mingcute:terminal-box-line" className="text-[12px] flex-none" />
                <span className="truncate">{executable || t("未检测到", "Not detected")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Per-runtime MCP/Skills status rows */}
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <Icon
                  icon={row.id.startsWith("wsl:") ? "mingcute:terminal-box-line" : "mingcute:computer-line"}
                  className="text-[14px] text-muted opacity-70 flex-none"
                />
                <span className="text-[12px] font-sans text-(--color-base-content)">{row.runtimeLabel}</span>
                {row.cliFound ? (
                  <span className="text-[11px] text-muted font-sans opacity-70">CLI ✓</span>
                ) : (
                  <span className="text-[11px] font-sans opacity-60" style={{ color: "var(--color-warning)" }}>
                    {t("CLI 未检测到", "CLI not detected")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-none">
                {row.cliFound ? (
                  row.installed ? (
                    <span className="text-[11px] font-sans px-2 py-0.5 rounded-md bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-[var(--color-success)]">
                      MCP {t("已安装", "Installed")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={`ui-btn ui-btn--xs ui-btn--outline gap-1 ${installing ? "opacity-70" : ""}`}
                      disabled={installing}
                      onClick={() => void doInstall([row.id])}
                    >
                      <Icon icon={installing ? "mingcute:loading-3-line" : "mingcute:download-2-line"} className="text-[14px]" />
                      {installing ? t("安装中…", "Installing…") : t("安装 MCP", "Install MCP")}
                    </button>
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* Install all button when multiple uninstalled targets exist */}
        {(() => {
          const uninstalledRows = rows.filter((r) => r.cliFound && !r.installed);
          if (uninstalledRows.length <= 1) return null;
          return (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                className={`ui-btn ui-btn--xs ui-btn--accent gap-1 ${installing ? "opacity-70" : ""}`}
                disabled={installing}
                onClick={() => void doInstall(uninstalledRows.map((r) => r.id))}
              >
                <Icon icon={installing ? "mingcute:loading-3-line" : "mingcute:download-2-line"} className="text-[14px]" />
                {installing ? t("安装中…", "Installing…") : t("全部安装 MCP", "Install All MCP")}
              </button>
            </div>
          );
        })()}

        {/* Reopen install window */}
        {canReopenInstallWindow ? (
          <div className="flex justify-end">
            <button
              type="button"
              className="ui-btn ui-btn--xs ui-btn--outline gap-1"
              onClick={() => setInstallWindowOpen(true)}
            >
              <Icon icon="mingcute:terminal-box-line" className="text-[14px]" />
              {installing ? t("查看进度", "View progress") : t("查看日志", "View log")}
            </button>
          </div>
        ) : null}

        {/* CLI Install instructions when any CLI not found */}
        {rows.some((r) => !r.cliFound) ? (
          <CliInstallCard
            workerKind={kind}
            workerLabel={label}
            uiLanguage={uiLanguage}
            nativeNpmFound={nativeProbe?.npmFound}
            wslNpmFound={wslProbe?.npmFound}
            nativeCliFound={nativeCliFound}
            wslCliFound={wslCliFound}
          />
        ) : null}
      </div>

      {/* Install task modal */}
      <InstallTaskWindow
        open={installWindowOpen}
        uiLanguage={uiLanguage}
        title={t(`安装 ${label} MCP`, `Install ${label} MCP`)}
        subtitle={installing ? t("正在写入配置并注册 MCP…", "Writing config and registering MCP…") : `MCP: ${mcpUrl}`}
        installing={installing}
        targets={installWindowTargets}
        targetStates={installTargetStates}
        results={installTargetResults}
        log={installLog}
        error={installError}
        onClose={() => setInstallWindowOpen(false)}
      />
    </div>
  );
}

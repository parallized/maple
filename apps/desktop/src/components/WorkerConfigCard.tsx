import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import { InstallGuideDialog } from "./InstallGuideDialog";
import { InstallTaskWindow, type InstallTargetResult, type InstallTargetState } from "./InstallTaskWindow";
import { WorkerLogo } from "./WorkerLogo";
import type { WorkerKind } from "../domain";
import type { UiLanguage } from "../lib/constants";
import type { InstallTargetId } from "../lib/install-targets";
import { INSTALL_TARGETS, formatInstallTargetLabel } from "../lib/install-targets";
import { hasTauriRuntime } from "../lib/utils";

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
  onRefreshProbes?: () => void;
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

type RuntimeRow = {
  id: InstallTargetId;
  runtime: "native" | "wsl";
  runtimeLabel: string;
  runtimeIcon: string;
  cliFound: boolean;
  installed: boolean;
  npmFound?: boolean;
};

export function WorkerConfigCard({
  kind,
  label,
  executable,
  available,
  nativeProbe,
  wslProbe,
  uiLanguage,
  variant = "settings",
  onRefreshProbes,
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
  const [installTargetResults, setInstallTargetResults] = useState<Partial<Record<InstallTargetId, InstallTargetResult>>>(
    {}
  );

  const [guideOpen, setGuideOpen] = useState(false);
  const [guideRuntime, setGuideRuntime] = useState<"native" | "wsl">("native");
  const [guideTargetId, setGuideTargetId] = useState<InstallTargetId>(kind);

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

  const canReopenInstallWindow =
    !installWindowOpen && (installing || installLog.trim().length > 0 || Boolean(installError));

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
        gemini: false,
        opencode: false,
        wslCodex: false,
        wslClaude: false,
        wslIflow: false,
        wslGemini: false,
        wslOpencode: false,
        windsurf: false,
        installId: nextInstallId,
      };

      for (const id of targetIds) {
        if (id === "codex") options.codex = true;
        else if (id === "claude") options.claude = true;
        else if (id === "iflow") options.iflow = true;
        else if (id === "gemini") options.gemini = true;
        else if (id === "opencode") options.opencode = true;
        else if (id === "wsl:codex") options.wslCodex = true;
        else if (id === "wsl:claude") options.wslClaude = true;
        else if (id === "wsl:iflow") options.wslIflow = true;
        else if (id === "wsl:gemini") options.wslGemini = true;
        else if (id === "wsl:opencode") options.wslOpencode = true;
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

  const runtimeRows: RuntimeRow[] = [
    {
      id: nativeTargetId,
      runtime: "native",
      runtimeLabel: t("本机", "Local"),
      runtimeIcon: "mingcute:computer-line",
      cliFound: nativeCliFound,
      installed: nativeInstalled,
      npmFound: nativeProbe?.npmFound,
    },
  ];

  if (isWindows) {
    runtimeRows.push({
      id: wslTargetId,
      runtime: "wsl",
      runtimeLabel: "WSL",
      runtimeIcon: "mingcute:terminal-box-line",
      cliFound: wslCliFound,
      installed: wslInstalled,
      npmFound: wslProbe?.npmFound,
    });
  }

  const allReady = runtimeRows.every((row) => row.cliFound && row.installed);
  const showRefresh = typeof onRefreshProbes === "function" && !allReady;

  function openGuide(row: RuntimeRow) {
    setGuideRuntime(row.runtime);
    setGuideTargetId(row.id);
    setGuideOpen(true);
  }

  const containerClass =
    variant === "overview"
      ? "group rounded-[12px] lg:rounded-[14px] bg-(--color-base-100) hover:bg-(--color-base-200) transition-all duration-300 flex flex-col flex-none overflow-hidden"
      : "rounded-[14px] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] bg-(--color-base-100) flex flex-col overflow-hidden";

  const contentPaddingClass = variant === "overview" ? "p-3 lg:p-4" : "p-3.5 lg:p-4";

  const guideRow = runtimeRows.find((row) => row.runtime === guideRuntime) ?? runtimeRows[0];

  return (
    <div className={containerClass}>
      <div className={`${contentPaddingClass} flex flex-col gap-2.5`}>
        {/* Row 1: icon + label */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative w-8 h-8 rounded-[10px] bg-(--color-base-200) flex items-center justify-center flex-none">
              <WorkerLogo kind={kind} size={20} />
              <span
                className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-(--color-base-100) ${available ? "bg-green-500" : "bg-(--color-base-300)"}`}
                aria-label={available ? t("可用", "Available") : t("未配置", "Not configured")}
              />
            </div>
            <span className="font-medium text-[14px] font-sans text-(--color-base-content) truncate">{label}</span>
          </div>
        </div>

        {/* Row 2: executable + action buttons */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-1.5 text-[11px] text-muted font-mono opacity-75">
            <Icon icon="mingcute:terminal-box-line" className="text-[13px] flex-none opacity-80" />
            <span className="truncate">{executable || t("未检测到", "Not detected")}</span>
          </div>

          <div className="flex items-center gap-1.5 flex-none">
            {runtimeRows.map((row) => {
              const needsCli = !row.cliFound;
              const needsMcp = row.cliFound && !row.installed;
              const ready = row.cliFound && row.installed;

              const isTargetInstalling = installing && installWindowTargets.includes(row.id);
              const statusIcon = isTargetInstalling
                ? "mingcute:loading-3-line"
                : ready
                  ? "mingcute:check-line"
                  : "mingcute:download-2-line";

              const text = isTargetInstalling
                ? t("安装中…", "Installing…")
                : needsCli
                  ? t("安装", "Install")
                  : needsMcp
                    ? t("安装 MCP", "Install MCP")
                    : `${row.runtimeLabel} MCP`;

              const buttonClass = ready
                ? "ui-btn ui-btn--xs gap-1 border border-[color-mix(in_srgb,var(--color-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                : "ui-btn ui-btn--xs ui-btn--outline gap-1";

              return (
                <button
                  key={row.id}
                  type="button"
                  className={`${buttonClass} ${installing ? "opacity-70" : ""}`.trim()}
                  disabled={installing}
                  onClick={() => openGuide(row)}
                  aria-label={text}
                  title={text}
                >
                  <Icon icon={row.runtimeIcon} className="text-[13px] opacity-80" />
                  <span className="text-[11px] font-sans">{text}</span>
                  <Icon icon={statusIcon} className="text-[13px]" />
                </button>
              );
            })}

            {showRefresh ? (
              <button
                type="button"
                className={`ui-btn ui-btn--xs ui-btn--outline ui-icon-btn ${installing ? "opacity-70" : ""}`.trim()}
                disabled={installing}
                onClick={onRefreshProbes}
                aria-label={t("刷新检测", "Refresh detection")}
                title={t("刷新检测", "Refresh detection")}
              >
                <Icon icon="mingcute:refresh-3-line" className="text-[14px]" />
              </button>
            ) : null}
          </div>
        </div>

        {canReopenInstallWindow ? (
          <div className="flex justify-end">
            <button type="button" className="ui-btn ui-btn--xs ui-btn--ghost gap-1" onClick={() => setInstallWindowOpen(true)}>
              <Icon icon="mingcute:terminal-box-line" className="text-[13px]" />
              <span className="text-[11px] font-sans">{installing ? t("查看进度", "View progress") : t("查看日志", "View log")}</span>
            </button>
          </div>
        ) : null}
      </div>

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

      <InstallGuideDialog
        open={guideOpen}
        uiLanguage={uiLanguage}
        workerKind={kind}
        workerLabel={label}
        runtime={guideRow.runtime}
        mcpUrl={mcpUrl}
        cliFound={guideRow.cliFound}
        npmFound={guideRow.npmFound}
        mcpInstalled={guideRow.installed}
        installingMcp={installing && installWindowTargets.includes(guideTargetId)}
        onRefresh={() => onRefreshProbes?.()}
        onStartMcpInstall={() => {
          setGuideOpen(false);
          void doInstall([guideTargetId]);
        }}
        onClose={() => setGuideOpen(false)}
      />
    </div>
  );
}

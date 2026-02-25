import { Icon } from "@iconify/react";
import { useEffect, useMemo, useRef } from "react";

import { copyTextToClipboard } from "../lib/clipboard";
import type { UiLanguage } from "../lib/constants";
import type { InstallTargetId } from "../lib/install-targets";
import { formatInstallTargetIcon, formatInstallTargetLabel } from "../lib/install-targets";

export type InstallTargetState = "idle" | "running" | "success" | "error";

export type InstallTargetResult = {
  id: InstallTargetId;
  success: boolean;
  skipped: boolean;
  cliFound: boolean | null;
  writtenFiles: string[];
  stdout: string;
  stderr: string;
  error: string | null;
};

type InstallTaskWindowProps = {
  open: boolean;
  uiLanguage: UiLanguage;
  title: string;
  subtitle?: string;
  installing: boolean;
  targets: InstallTargetId[];
  targetStates: Record<InstallTargetId, InstallTargetState>;
  results: Partial<Record<InstallTargetId, InstallTargetResult>>;
  log: string;
  error: string;
  onClose: () => void;
};

function stateIcon(
  state: InstallTargetState,
  installing: boolean,
  t: (zh: string, en: string) => string
): { icon: string; color: string; label: string } {
  if (state === "running") {
    return {
      icon: "mingcute:loading-3-line",
      color: "var(--color-primary)",
      label: installing ? t("进行中", "Running") : t("处理中", "Processing"),
    };
  }
  if (state === "success") {
    return { icon: "mingcute:check-line", color: "var(--color-success)", label: t("已完成", "Done") };
  }
  if (state === "error") {
    return { icon: "mingcute:close-line", color: "var(--color-error)", label: t("失败", "Failed") };
  }
  return {
    icon: "mingcute:time-line",
    color: "color-mix(in srgb, var(--color-secondary) 55%, transparent)",
    label: t("等待", "Waiting"),
  };
}

export function InstallTaskWindow({
  open,
  uiLanguage,
  title,
  subtitle,
  installing,
  targets,
  targetStates,
  results,
  log,
  error,
  onClose,
}: InstallTaskWindowProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const logHostRef = useRef<HTMLDivElement | null>(null);

  const summary = useMemo(() => {
    const selected = targets.length;
    const succeeded = targets.filter((id) => targetStates[id] === "success").length;
    const failed = targets.filter((id) => targetStates[id] === "error").length;
    const running = targets.filter((id) => targetStates[id] === "running").length;
    return { selected, succeeded, failed, running };
  }, [targets, targetStates]);

  useEffect(() => {
    if (!open) return;
    if (!installing) return;
    const host = logHostRef.current;
    if (!host) return;
    host.scrollTop = host.scrollHeight;
  }, [open, installing, log]);

  if (!open) return null;

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label={t("安装任务", "Install task")}>
      <div
        className="ui-modal-backdrop"
        onClick={() => {
          if (installing) return;
          onClose();
        }}
      />
      <div className="ui-modal-panel ui-modal-panel--console">
        <div className="worker-console-header">
          <div className="worker-console-meta terminal-meta">
            <h3 className="m-0 font-semibold">{title}</h3>
            <p className="m-0 text-muted text-xs">
              {subtitle ? subtitle : installing ? t("安装中…", "Installing…") : t("已完成", "Finished")}
            </p>
          </div>

          <div className="worker-console-actions flex items-center gap-2">
            <span className="text-[11px] text-muted font-sans opacity-80">
              {t(
                `${summary.succeeded}/${summary.selected} 完成${summary.failed ? ` · ${summary.failed} 失败` : ""}`,
                `${summary.succeeded}/${summary.selected} done${summary.failed ? ` · ${summary.failed} failed` : ""}`
              )}
            </span>
            <button
              type="button"
              className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn"
              onClick={onClose}
              aria-label={installing ? t("隐藏", "Hide") : t("关闭", "Close")}
            >
              <Icon icon={installing ? "mingcute:minus-line" : "mingcute:close-line"} />
            </button>
          </div>
        </div>

        <div className="ui-modal-body worker-console-body">
          <div className="worker-console-pool">
            <div className="worker-console-pool-header">
              <span className="text-xs text-muted">{t("目标", "Targets")}</span>
              <span className="text-xs text-muted">{targets.length}</span>
            </div>
            <div className="worker-console-pool-list" role="list">
              {targets.map((id) => {
                const state = targetStates[id] ?? "idle";
                const meta = stateIcon(state, installing, t);
                const result = results[id];
                const subtitleText =
                  result?.cliFound === false
                    ? t("未检测到 CLI，已写入配置", "CLI not found; config written")
                    : state === "running"
                      ? t("正在处理…", "Running…")
                      : state === "success"
                        ? t("已完成", "Done")
                        : state === "error"
                          ? (result?.error ?? t("出现错误", "Error"))
                          : t("等待开始", "Waiting");

                return (
                  <div
                    key={id}
                    role="listitem"
                    className="worker-console-pool-item"
                  >
                    <div className="worker-console-pool-item-main">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-content)_8%,transparent)] flex items-center justify-center flex-none">
                          <Icon icon={formatInstallTargetIcon(id)} className="text-[16px] opacity-80" />
                        </div>
                        <span className="worker-console-pool-item-title">{formatInstallTargetLabel(id)}</span>
                      </div>
                      <span className="worker-console-pool-item-sub truncate" title={subtitleText}>
                        {subtitleText}
                      </span>
                    </div>
                    <span className="worker-console-pool-item-mode flex items-center gap-1">
                      <Icon icon={meta.icon} className="text-[14px]" style={{ color: meta.color }} />
                      <span className="text-[11px] text-muted">{meta.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--outline gap-1"
                onClick={async () => {
                  const ok = await copyTextToClipboard(log);
                  if (!ok) return;
                }}
                disabled={!log.trim()}
              >
                <Icon icon="mingcute:copy-2-line" className="text-[14px]" />
                {t("复制日志", "Copy log")}
              </button>
              {error ? (
                <span className="text-[11px] font-mono" style={{ color: "var(--color-error)" }}>
                  {error}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Icon icon="mingcute:terminal-box-line" className="text-[16px] opacity-70" />
                <span className="text-xs text-muted">{t("实时输出", "Live output")}</span>
              </div>
              {installing ? (
                <span className="text-[11px] text-muted font-sans opacity-70">{t("正在运行…", "Running…")}</span>
              ) : null}
            </div>

            <div
              ref={logHostRef}
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-base-200)_45%,transparent)] p-3 overflow-auto flex-1 min-h-0"
            >
              <pre className="m-0 text-[11px] leading-[1.55] font-mono text-(--color-base-content) whitespace-pre-wrap break-words">
                {log.trim().length > 0 ? log : t("等待输出…", "Waiting for output…")}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

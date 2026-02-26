import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

import type { WorkerKind } from "../domain";
import { WORKER_KINDS } from "../lib/constants";
import { hasTauriRuntime } from "../lib/utils";
import { WorkerLogo } from "./WorkerLogo";

type WorkerPickerModalProps = {
  onSelect: (kind: WorkerKind) => void;
  onClose: () => void;
};

type InstallTargetProbe = {
  id: string;
  runtime: "native" | "wsl";
  cliFound: boolean;
  installed: boolean;
};

export function WorkerPickerModal({ onSelect, onClose }: WorkerPickerModalProps) {
  const isTauri = hasTauriRuntime();
  const [loading, setLoading] = useState(isTauri);
  const [probeError, setProbeError] = useState("");
  const [probeById, setProbeById] = useState<Record<string, InstallTargetProbe>>({});

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;

    setLoading(true);
    setProbeError("");

    void invoke<InstallTargetProbe[]>("probe_install_targets")
      .then((probes) => {
        if (disposed) return;
        const next: Record<string, InstallTargetProbe> = {};
        for (const probe of probes) {
          next[probe.id] = probe;
        }
        setProbeById(next);
      })
      .catch((error) => {
        if (disposed) return;
        setProbeError(String(error));
      })
      .finally(() => {
        if (disposed) return;
        setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [isTauri]);

  const options = useMemo(() => {
    if (!isTauri) return WORKER_KINDS.map((item) => ({ ...item, hint: "" }));

    return WORKER_KINDS
      .map((item) => {
        const native = probeById[item.kind];
        const wsl = probeById[`wsl:${item.kind}`];
        const nativeReady = Boolean(native?.cliFound) && Boolean(native?.installed);
        const wslReady = Boolean(wsl?.cliFound) && Boolean(wsl?.installed);
        if (!nativeReady && !wslReady) return null;
        const hint = !nativeReady && wslReady ? "WSL" : "";
        return { ...item, hint };
      })
      .filter(Boolean) as Array<{ kind: WorkerKind; label: string; color: string; hint: string }>;
  }, [isTauri, probeById]);

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label="选择 Worker">
      <div className="ui-modal-backdrop" onClick={onClose} />
      <div className="ui-modal-panel">
        <div className="ui-modal-body">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold m-0">选择 Worker</h3>
              <p className="text-muted text-sm mt-1">绑定后会执行当前项目的待办任务。</p>
            </div>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
              onClick={onClose}
              aria-label="关闭"
            >
              <Icon icon="mingcute:close-line" />
            </button>
          </div>

          <div className="mt-4">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Icon icon="mingcute:loading-3-line" className="text-[16px]" />
                <span>正在检测可用 Worker…</span>
              </div>
            ) : options.length === 0 ? (
              <div className="rounded-[12px] border border-[color-mix(in_srgb,var(--color-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] px-3 py-2.5">
                <div className="flex items-center gap-2 text-[12px] font-sans text-(--color-base-content)">
                  <Icon icon="mingcute:warning-line" className="text-[16px] opacity-80" />
                  <span>未检测到可用的 Worker</span>
                </div>
                <p className="m-0 mt-1 text-[11px] text-muted font-sans opacity-80">
                  请先在概览页点击「一键安装 MCP & Skills」，安装完成后再回来选择。
                </p>
                {probeError ? (
                  <p className="m-0 mt-2 text-[10px] font-mono whitespace-pre-wrap break-words" style={{ color: "var(--color-error)" }}>
                    {probeError}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {options.map(({ kind, label, hint }) => (
                  <button
                    key={kind}
                    type="button"
                    className="ui-btn ui-btn--sm ui-btn--outline gap-1"
                    onClick={() => onSelect(kind)}
                  >
                    <WorkerLogo kind={kind} size={18} />
                    {label}
                    {hint ? (
                      <span className="ml-1 text-[10px] font-sans text-muted opacity-75">{hint}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end mt-4">
            <button type="button" className="ui-btn ui-btn--sm ui-btn--ghost" onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

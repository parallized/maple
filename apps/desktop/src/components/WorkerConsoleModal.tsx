import { Icon } from "@iconify/react";
import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { WORKER_KINDS } from "../lib/constants";
import type { WorkerKind } from "../domain";
import { WorkerLogo } from "./WorkerLogo";

type WorkerConsoleModalProps = {
  workerConsoleWorkerId: string;
  currentWorkerLog: string;
  executingWorkers: Set<string>;
  workerPool: Array<{
    workerId: string;
    workerLabel: string;
    projectName: string;
    mode: "task";
    kind: WorkerKind | null;
  }>;
  onClose: () => void;
  onSelectWorker: (workerId: string) => void;
};

export function WorkerConsoleModal({
  workerConsoleWorkerId,
  currentWorkerLog,
  executingWorkers,
  workerPool,
  onClose,
  onSelectWorker
}: WorkerConsoleModalProps) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastLogLengthRef = useRef(0);

  const currentWorkerLabel =
    workerPool.find((w) => w.workerId === workerConsoleWorkerId)?.workerLabel
    ?? WORKER_KINDS.find((w) => `worker-${w.kind}` === workerConsoleWorkerId)?.label
    ?? workerConsoleWorkerId;
  const isExecutingTask = executingWorkers.has(workerConsoleWorkerId);

  function formatMode(mode: "task"): string {
    return "任务执行";
  }

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: false,
      convertEol: true,
      disableStdin: true,
      fontFamily: "\"SF Mono\", \"Menlo\", \"Monaco\", \"Courier New\", monospace",
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 8000,
      theme: {
        background: "#f7f6f3",
        foreground: "#2b2b29",
        cursor: "#68635d"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastLogLengthRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    lastLogLengthRef.current = 0;

    if (currentWorkerLog.length > 0) {
      terminal.write(currentWorkerLog);
      lastLogLengthRef.current = currentWorkerLog.length;
    }
    fitAddonRef.current?.fit();
  }, [workerConsoleWorkerId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const previousLength = lastLogLengthRef.current;

    if (currentWorkerLog.length < previousLength) {
      terminal.reset();
      lastLogLengthRef.current = 0;
      if (currentWorkerLog.length > 0) {
        terminal.write(currentWorkerLog);
        lastLogLengthRef.current = currentWorkerLog.length;
      }
      return;
    }

    const delta = currentWorkerLog.slice(previousLength);
    if (!delta) return;
    terminal.write(delta);
    lastLogLengthRef.current = currentWorkerLog.length;
  }, [currentWorkerLog]);

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label="Worker 控制台">
      <div className="ui-modal-backdrop" onClick={onClose} />
      <div className="ui-modal-panel ui-modal-panel--console">
        <div className="worker-console-header">
          <div className="worker-console-meta terminal-meta">
            <h3 className="m-0 font-semibold">Terminal</h3>
            <p className="m-0 text-muted text-xs">{currentWorkerLabel}</p>
          </div>

          <div className="worker-console-actions">
            <button
              type="button"
              className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn"
              onClick={onClose}
              aria-label="关闭"
            >
              <Icon icon="mingcute:close-line" />
            </button>
          </div>
        </div>

        <div className="ui-modal-body worker-console-body">
          <div className="worker-console-pool">
            <div className="worker-console-pool-header">
              <span className="text-xs text-muted">Worker 池</span>
              <span className="text-xs text-muted">{workerPool.length}</span>
            </div>
            {workerPool.length === 0 ? (
              <div className="worker-console-pool-empty">当前没有运行中的 Worker</div>
            ) : (
              <div className="worker-console-pool-list" role="list">
                {workerPool.map((entry) => {
                  const selected = entry.workerId === workerConsoleWorkerId;
                  return (
                    <button
                      key={entry.workerId}
                      type="button"
                      role="listitem"
                      className={`worker-console-pool-item ${selected ? "active" : ""}`}
                      onClick={() => onSelectWorker(entry.workerId)}
                    >
                      <div className="worker-console-pool-item-main">
                        <div className="flex items-center gap-2 min-w-0">
                          {entry.kind ? (
                            <div className="w-6 h-6 rounded-lg bg-(--color-base-100) border border-[color-mix(in_srgb,var(--color-base-content)_8%,transparent)] flex items-center justify-center flex-none">
                              <WorkerLogo kind={entry.kind} size={16} />
                            </div>
                          ) : (
                            <Icon icon="mingcute:terminal-box-line" className="text-base opacity-70" />
                          )}
                          <span className="worker-console-pool-item-title">{entry.workerLabel}</span>
                        </div>
                        <span className="worker-console-pool-item-sub">{entry.projectName}</span>
                      </div>
                      <span className="worker-console-pool-item-mode">{formatMode(entry.mode)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="worker-terminal-wrap">
            <div ref={terminalHostRef} className="worker-terminal-surface" />
            {!isExecutingTask ? (
              <div className="worker-terminal-overlay">
                <Icon icon="mingcute:terminal-box-line" />
                <span>当前没有运行中的 Worker 输出。</span>
              </div>
            ) : null}
          </div>
          <p className="worker-terminal-hint">
            {isExecutingTask
              ? "任务执行中：控制台为只读输出，你可以实时查看执行日志。"
              : "暂无运行中的 Worker。触发任务执行后，这里会自动显示输出。"}
          </p>
        </div>
      </div>
    </div>
  );
}

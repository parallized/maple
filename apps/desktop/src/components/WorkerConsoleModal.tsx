import { Icon } from "@iconify/react";
import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { WORKER_KINDS } from "../lib/constants";

type WorkerConsoleModalProps = {
  workerConsoleWorkerId: string;
  currentWorkerLog: string;
  runningWorkers: Set<string>;
  executingWorkers: Set<string>;
  workerPool: Array<{
    workerId: string;
    workerLabel: string;
    projectName: string;
    mode: "interactive" | "task" | "mixed";
  }>;
  onClose: () => void;
  onStartWorker: (workerId: string) => void;
  onStopWorker: (workerId: string) => void;
  onSendRawInput: (workerId: string, input: string) => void;
  onSelectWorker: (workerId: string) => void;
};

export function WorkerConsoleModal({
  workerConsoleWorkerId,
  currentWorkerLog,
  runningWorkers,
  executingWorkers,
  workerPool,
  onClose,
  onStartWorker,
  onStopWorker,
  onSendRawInput,
  onSelectWorker
}: WorkerConsoleModalProps) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const runningWorkersRef = useRef(runningWorkers);
  const workerIdRef = useRef(workerConsoleWorkerId);
  const lastLogLengthRef = useRef(0);

  const currentWorkerLabel =
    workerPool.find((w) => w.workerId === workerConsoleWorkerId)?.workerLabel
    ?? WORKER_KINDS.find((w) => `worker-${w.kind}` === workerConsoleWorkerId)?.label
    ?? workerConsoleWorkerId;
  const isInteractiveRunning = runningWorkers.has(workerConsoleWorkerId);
  const isExecutingTask = executingWorkers.has(workerConsoleWorkerId);
  const canStartSession = !isInteractiveRunning && !isExecutingTask;

  function formatMode(mode: "interactive" | "task" | "mixed"): string {
    if (mode === "mixed") return "交互 + 任务";
    if (mode === "interactive") return "交互会话";
    return "任务执行";
  }

  useEffect(() => {
    runningWorkersRef.current = runningWorkers;
  }, [runningWorkers]);

  useEffect(() => {
    workerIdRef.current = workerConsoleWorkerId;
  }, [workerConsoleWorkerId]);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
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

    const disposable = terminal.onData((input) => {
      const activeWorkerId = workerIdRef.current;
      if (!runningWorkersRef.current.has(activeWorkerId)) return;
      onSendRawInput(activeWorkerId, input);
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      disposable.dispose();
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastLogLengthRef.current = 0;
    };
  }, [onSendRawInput]);

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
            {canStartSession ? (
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--outline gap-1"
                onClick={() => onStartWorker(workerConsoleWorkerId)}
              >
                <Icon icon="mingcute:terminal-line" />
                启动
              </button>
            ) : null}
            {isInteractiveRunning ? (
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--outline ui-btn--danger gap-1"
                onClick={() => onStopWorker(workerConsoleWorkerId)}
              >
                <Icon icon="mingcute:stop-circle-line" />
                停止
              </button>
            ) : null}
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
                        <span className="worker-console-pool-item-title">{entry.workerLabel}</span>
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
            {!isInteractiveRunning && !isExecutingTask ? (
              <div className="worker-terminal-overlay">
                <Icon icon="mingcute:terminal-box-line" />
                <span>点击「启动」连接真实终端会话。</span>
              </div>
            ) : null}
          </div>
          <p className="worker-terminal-hint">
            {isInteractiveRunning
              ? "终端已连接：直接键入命令即可（支持 ANSI/TUI 输出）。需要加载 Maple 时：Claude/iFlow 输入 /maple，Codex 输入 $maple。"
              : isExecutingTask
                ? "任务执行中：当前终端为只读输出，你可以实时查看执行日志。"
                : "终端未连接：启动后可直接在窗口内输入，无需额外模拟输入框。"}
          </p>
        </div>
      </div>
    </div>
  );
}

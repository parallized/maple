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
  onClose: () => void;
  onStartWorker: (workerId: string) => void;
  onStopWorker: (workerId: string) => void;
  onSendRawInput: (workerId: string, input: string) => void;
};

export function WorkerConsoleModal({
  workerConsoleWorkerId,
  currentWorkerLog,
  runningWorkers,
  executingWorkers,
  onClose,
  onStartWorker,
  onStopWorker,
  onSendRawInput
}: WorkerConsoleModalProps) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const runningWorkersRef = useRef(runningWorkers);
  const workerIdRef = useRef(workerConsoleWorkerId);
  const lastLogLengthRef = useRef(0);

  const currentWorkerLabel =
    WORKER_KINDS.find((w) => `worker-${w.kind}` === workerConsoleWorkerId)?.label ?? workerConsoleWorkerId;
  const isInteractiveRunning = runningWorkers.has(workerConsoleWorkerId);
  const isExecutingTask = executingWorkers.has(workerConsoleWorkerId);
  const canStartSession = !isInteractiveRunning && !isExecutingTask;

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
      convertEol: false,
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
    } else {
      terminal.write("$ ");
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
      } else {
        terminal.write("$ ");
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
          <div className="worker-terminal-wrap">
            <div ref={terminalHostRef} className="worker-terminal-surface" />
            {!isInteractiveRunning ? (
              <div className="worker-terminal-overlay">
                <Icon icon="mingcute:terminal-box-line" />
                <span>{isExecutingTask ? "任务执行中，终端只读。" : "点击「启动」连接真实终端会话。"}</span>
              </div>
            ) : null}
          </div>
          <p className="worker-terminal-hint">
            {isInteractiveRunning
              ? "终端已连接：直接键入命令即可（支持 ANSI/TUI 输出）。"
              : "终端未连接：启动后可直接在窗口内输入，无需额外模拟输入框。"}
          </p>
        </div>
      </div>
    </div>
  );
}

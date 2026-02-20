import { Icon } from "@iconify/react";
import { useEffect, useRef } from "react";
import { WORKER_KINDS } from "../lib/constants";

type WorkerConsoleModalProps = {
  workerConsoleWorkerId: string;
  currentWorkerLog: string;
  consoleInput: string;
  runningWorkers: Set<string>;
  executingWorkers: Set<string>;
  onClose: () => void;
  onConsoleInputChange: (value: string) => void;
  onSendCommand: (workerId: string, input: string) => void;
  onStopWorker: (workerId: string) => void;
};

export function WorkerConsoleModal({
  workerConsoleWorkerId,
  currentWorkerLog,
  consoleInput,
  runningWorkers,
  executingWorkers,
  onClose,
  onConsoleInputChange,
  onSendCommand,
  onStopWorker
}: WorkerConsoleModalProps) {
  const logRef = useRef<HTMLPreElement>(null);
  const currentWorkerLabel =
    WORKER_KINDS.find((w) => `worker-${w.kind}` === workerConsoleWorkerId)?.label ?? workerConsoleWorkerId;
  const isInteractiveRunning = runningWorkers.has(workerConsoleWorkerId);
  const isExecutingTask = executingWorkers.has(workerConsoleWorkerId);
  const isReadOnly = isExecutingTask && !isInteractiveRunning;
  const inputPlaceholder = isReadOnly
    ? "任务执行中，终端只读…"
    : isInteractiveRunning
      ? "输入命令并回车…"
      : "输入命令并回车（如 /maple 或 $maple）…";

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
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
          <pre ref={logRef} className="worker-console-log">
            {currentWorkerLog || "$ "}
          </pre>
          <div className="console-input-row flex gap-2 mt-2">
            <input
              className="ui-input ui-input--sm flex-1 font-mono text-xs"
              value={consoleInput}
              onChange={(e) => onConsoleInputChange(e.target.value)}
              placeholder={inputPlaceholder}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendCommand(workerConsoleWorkerId, consoleInput);
                }
              }}
              disabled={!workerConsoleWorkerId || isReadOnly}
            />
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--outline gap-1"
              onClick={() => onSendCommand(workerConsoleWorkerId, consoleInput)}
              disabled={!workerConsoleWorkerId || !consoleInput.trim() || isReadOnly}
            >
              <Icon icon="mingcute:send-plane-line" />
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

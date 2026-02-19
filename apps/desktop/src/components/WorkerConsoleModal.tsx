import { Icon } from "@iconify/react";
import { useEffect, useRef } from "react";
import { WORKER_KINDS } from "../lib/constants";

type WorkerConsoleModalProps = {
  workerConsoleWorkerId: string;
  currentWorkerLog: string;
  consoleInput: string;
  runningWorkers: Set<string>;
  workerLogs: Record<string, string>;
  onClose: () => void;
  onWorkerSelect: (workerId: string) => void;
  onConsoleInputChange: (value: string) => void;
  onSendCommand: (workerId: string, input: string) => void;
  onStopWorker: (workerId: string) => void;
  onClearLog: (workerId: string) => void;
  onNotice: (msg: string) => void;
};

export function WorkerConsoleModal({
  workerConsoleWorkerId,
  currentWorkerLog,
  consoleInput,
  runningWorkers,
  workerLogs,
  onClose,
  onWorkerSelect,
  onConsoleInputChange,
  onSendCommand,
  onStopWorker,
  onClearLog,
  onNotice
}: WorkerConsoleModalProps) {
  const logRef = useRef<HTMLPreElement>(null);
  const currentWorkerLabel =
    WORKER_KINDS.find((w) => `worker-${w.kind}` === workerConsoleWorkerId)?.label ?? workerConsoleWorkerId;
  const isRunning = runningWorkers.has(workerConsoleWorkerId);

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
          <div className="worker-console-meta">
            <h3 className="m-0 font-semibold">Worker 控制台</h3>
            <label className="worker-console-select-wrap">
              <span className="text-muted text-xs">当前 Worker</span>
              <select
                className="ui-input ui-input--sm worker-console-select"
                value={workerConsoleWorkerId}
                onChange={(event) => onWorkerSelect(event.target.value)}
              >
                {WORKER_KINDS.map(({ kind, label }) => (
                  <option key={kind} value={`worker-${kind}`}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="m-0 text-muted text-xs">
              {isRunning ? `${currentWorkerLabel} 会话运行中，输入将直接发送到 CLI。` : `${currentWorkerLabel} 未连接会话，输入后将自动开始交互。`}
            </p>
          </div>

          <div className="worker-console-actions">
            {isRunning ? (
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
              className="ui-btn ui-btn--xs ui-btn--outline gap-1"
              onClick={async () => {
                const text = workerConsoleWorkerId ? workerLogs[workerConsoleWorkerId] ?? "" : "";
                if (!text.trim()) {
                  onNotice("当前没有可复制的日志。");
                  return;
                }
                try {
                  await navigator.clipboard.writeText(text);
                  onNotice("已复制到剪贴板。");
                } catch {
                  onNotice("复制失败，请稍后重试。");
                }
              }}
              disabled={!workerConsoleWorkerId}
            >
              <Icon icon="mingcute:copy-2-line" />
              复制
            </button>
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
            {currentWorkerLog || "暂无日志\n输入命令后将进入交互会话…"}
          </pre>
          <div className="console-input-row flex gap-2 mt-2">
            <input
              className="ui-input ui-input--sm flex-1 font-mono text-xs"
              value={consoleInput}
              onChange={(e) => onConsoleInputChange(e.target.value)}
              placeholder={isRunning ? "输入命令并回车…" : "输入命令并回车，自动进入交互…"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendCommand(workerConsoleWorkerId, consoleInput);
                }
              }}
              disabled={!workerConsoleWorkerId}
            />
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--outline gap-1"
              onClick={() => onClearLog(workerConsoleWorkerId)}
              disabled={!workerConsoleWorkerId}
            >
              <Icon icon="mingcute:delete-2-line" />
              清空
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--outline gap-1"
              onClick={() => onSendCommand(workerConsoleWorkerId, consoleInput)}
              disabled={!workerConsoleWorkerId || !consoleInput.trim()}
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

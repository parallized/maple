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

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [currentWorkerLog]);

  return (
    <div className="ui-modal" role="dialog" aria-modal="true" aria-label="Worker 控制台">
      <div className="ui-modal-backdrop" onClick={onClose} />
      <div className="ui-modal-panel">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[color:var(--color-base-200)]">
          <h3 className="m-0 font-semibold">Worker 控制台</h3>
          <button
            type="button"
            className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
            onClick={onClose}
            aria-label="关闭"
          >
            <Icon icon="mingcute:close-line" />
          </button>
        </div>
        <div className="ui-modal-body">
          <div className="grid grid-cols-[180px_1fr] gap-3">
            <div className="flex flex-col gap-1">
              {WORKER_KINDS.map(({ kind, label }) => {
                const wId = `worker-${kind}`;
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`ui-btn ui-btn--sm ui-btn--ghost justify-start gap-2 ${workerConsoleWorkerId === wId ? "bg-[color:var(--sidebar-active)]" : ""}`}
                    onClick={() => onWorkerSelect(wId)}
                  >
                    <span className={runningWorkers.has(wId) ? "ui-badge ui-badge--solid" : "ui-badge ui-badge--success"}>
                      {runningWorkers.has(wId) ? "运行中" : "就绪"}
                    </span>
                    <span className="flex-1 text-left">{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="min-w-0 flex flex-col">
              <div className="flex items-center justify-between gap-2">
                <p className="m-0 text-muted text-xs">
                  {workerConsoleWorkerId ? `当前：${WORKER_KINDS.find((w) => `worker-${w.kind}` === workerConsoleWorkerId)?.label ?? workerConsoleWorkerId}` : "当前：-"}
                  {runningWorkers.has(workerConsoleWorkerId) ? " (运行中)" : ""}
                </p>
                <div className="flex gap-2">
                  {runningWorkers.has(workerConsoleWorkerId) ? (
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
                    onClick={() => onClearLog(workerConsoleWorkerId)}
                    disabled={!workerConsoleWorkerId}
                  >
                    <Icon icon="mingcute:delete-2-line" />
                    清空
                  </button>
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
                </div>
              </div>
              <pre ref={logRef} className="mt-2 bg-[color:var(--color-base-200)] rounded-lg p-3 text-xs whitespace-pre-wrap break-words m-0 border-0 max-h-[48vh] overflow-auto flex-1">
                {currentWorkerLog || "暂无日志\n输入命令开始交互…"}
              </pre>
              <div className="console-input-row flex gap-2 mt-2">
                <input
                  className="ui-input ui-input--sm flex-1 font-mono text-xs"
                  value={consoleInput}
                  onChange={(e) => onConsoleInputChange(e.target.value)}
                  placeholder={runningWorkers.has(workerConsoleWorkerId) ? "输入内容发送到 Worker…" : "输入命令启动 Worker 会话…"}
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
      </div>
    </div>
  );
}

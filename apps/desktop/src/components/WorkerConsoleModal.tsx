import { Icon } from "@iconify/react";
import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { WORKER_KINDS, type ThemeMode } from "../lib/constants";
import type { WorkerKind } from "../domain";
import { WorkerLogo } from "./WorkerLogo";

type WorkerConsoleModalProps = {
  workerConsoleWorkerId: string;
  currentWorkerLog: string;
  executingWorkers: Set<string>;
  theme: ThemeMode;
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

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function resolveIsDarkMode(theme: ThemeMode): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
}

function resolveTerminalFontFamily(): string {
  const fromVar = readCssVar("--font-mono", "");
  return fromVar || "\"SF Mono\", \"Menlo\", \"Monaco\", \"Courier New\", monospace";
}

function resolveTerminalTheme(theme: ThemeMode): ITheme {
  const base200 = readCssVar("--color-base-200", "#f7f6f3");
  const content = readCssVar("--color-base-content", "#2b2b29");
  const secondary = readCssVar("--color-secondary", "#68635d");
  const ringPrimary = readCssVar("--ring-primary", "rgba(242, 114, 60, 0.2)");
  const isDark = resolveIsDarkMode(theme);

  return {
    background: base200,
    foreground: content,
    cursor: secondary,
    cursorAccent: base200,
    selectionBackground: ringPrimary,
    black: isDark ? "#0f1011" : "#2b2b29",
    red: isDark ? "#ff453a" : "#d47049",
    green: isDark ? "#30d158" : "#4da872",
    yellow: isDark ? "#ffd60a" : "#e3b341",
    blue: isDark ? "#0a84ff" : "#2563eb",
    magenta: isDark ? "#bf5af2" : "#a855f7",
    cyan: isDark ? "#64d2ff" : "#0891b2",
    white: isDark ? "#d1d1d6" : "#f7f6f3",
    brightBlack: isDark ? "#3a3a3c" : "#68635d",
    brightRed: isDark ? "#ff6961" : "#e07a54",
    brightGreen: isDark ? "#34c759" : "#55b97c",
    brightYellow: isDark ? "#ffe15a" : "#f0c24f",
    brightBlue: isDark ? "#5ac8fa" : "#3b82f6",
    brightMagenta: isDark ? "#d480ff" : "#c084fc",
    brightCyan: isDark ? "#7ef0ff" : "#22d3ee",
    brightWhite: "#ffffff"
  };
}

export function WorkerConsoleModal({
  workerConsoleWorkerId,
  currentWorkerLog,
  executingWorkers,
  theme,
  workerPool,
  onClose,
  onSelectWorker
}: WorkerConsoleModalProps) {
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastLogLengthRef = useRef(0);
  const lastFitRef = useRef(0);
  const pendingCarriageReturnRef = useRef(false);

  const currentWorkerLabel =
    workerPool.find((w) => w.workerId === workerConsoleWorkerId)?.workerLabel
    ?? WORKER_KINDS.find((w) => `worker-${w.kind}` === workerConsoleWorkerId)?.label
    ?? workerConsoleWorkerId;
  const isExecutingTask = executingWorkers.has(workerConsoleWorkerId);

  function formatMode(mode: "task"): string {
    return "任务执行";
  }

  function writeToTerminal(raw: string) {
    const terminal = terminalRef.current;
    if (!terminal) return;
    if (!raw) return;

    let text = raw;
    if (pendingCarriageReturnRef.current) {
      text = `\r${text}`;
      pendingCarriageReturnRef.current = false;
    }
    if (text.endsWith("\r")) {
      pendingCarriageReturnRef.current = true;
      text = text.slice(0, -1);
    }
    text = text.replace(/\r\n/g, "\n");
    if (!text) return;

    const fitAddon = fitAddonRef.current;
    terminal.write(text, () => {
      terminal.scrollToBottom();
      const now = Date.now();
      if (fitAddon && now - lastFitRef.current > 650) {
        fitAddon.fit();
        lastFitRef.current = now;
      }
    });
  }

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: false,
      convertEol: true,
      disableStdin: true,
      fontFamily: resolveTerminalFontFamily(),
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 8000,
      theme: resolveTerminalTheme(theme)
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    const refit = () => {
      try {
        fitAddon.fit();
      } catch {
        // noop
      }
      lastFitRef.current = Date.now();
    };
    refit();
    queueMicrotask(refit);
    requestAnimationFrame(refit);
    document.fonts?.ready.then(refit).catch(() => undefined);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const handleResize = () => refit();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => refit());
    resizeObserver?.observe(host);
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver?.disconnect();
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
    terminal.options.theme = resolveTerminalTheme(theme);
    terminal.refresh(0, Math.max(terminal.rows - 1, 0));
    fitAddonRef.current?.fit();
    lastFitRef.current = Date.now();
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const handler = () => {
      terminal.options.theme = resolveTerminalTheme(theme);
      terminal.refresh(0, Math.max(terminal.rows - 1, 0));
      fitAddonRef.current?.fit();
      lastFitRef.current = Date.now();
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.reset();
    lastLogLengthRef.current = 0;
    pendingCarriageReturnRef.current = false;

    if (currentWorkerLog.length > 0) {
      writeToTerminal(currentWorkerLog);
      lastLogLengthRef.current = currentWorkerLog.length;
    }
    fitAddonRef.current?.fit();
    lastFitRef.current = Date.now();
  }, [workerConsoleWorkerId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const previousLength = lastLogLengthRef.current;

    if (currentWorkerLog.length < previousLength) {
      terminal.reset();
      lastLogLengthRef.current = 0;
      pendingCarriageReturnRef.current = false;
      if (currentWorkerLog.length > 0) {
        writeToTerminal(currentWorkerLog);
        lastLogLengthRef.current = currentWorkerLog.length;
      }
      return;
    }

    const delta = currentWorkerLog.slice(previousLength);
    if (!delta) return;
    writeToTerminal(delta);
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

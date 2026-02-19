import { Icon } from "@iconify/react";
import { FadeContent } from "../components/ReactBits";
import { WORKER_KINDS } from "../lib/constants";
import type { ThemeMode } from "../lib/constants";
import type { McpServerConfig, McpServerStatus, WorkerConfig, WorkerKind } from "../domain";

type SettingsViewProps = {
  mcpConfig: McpServerConfig;
  mcpStatus: McpServerStatus;
  workerConfigs: Record<WorkerKind, WorkerConfig>;
  mcpProjectQuery: string;
  mcpKeywordQuery: string;
  mcpQueryResult: string;
  theme: ThemeMode;
  onMcpConfigChange: (updater: (prev: McpServerConfig) => McpServerConfig) => void;
  onMcpProjectQueryChange: (value: string) => void;
  onMcpKeywordQueryChange: (value: string) => void;
  onRunMcpTodoQuery: () => void;
  onRunMcpRecentQuery: () => void;
  onApplyRecommendedSetup: () => void;
  onWorkerConfigChange: (
    kind: WorkerKind,
    field: "executable" | "runArgs" | "consoleArgs" | "probeArgs",
    value: string
  ) => void;
  onWorkerDangerModeChange: (kind: WorkerKind, value: boolean) => void;
  onProbeWorker: (kind: WorkerKind) => void;
  onStartMcpServer: () => void;
  onStopMcpServer: () => void;
  onRefreshMcpStatus: () => void;
  onOpenConsole: () => void;
  onThemeChange: (mode: ThemeMode) => void;
};

export function SettingsView({
  mcpConfig,
  mcpStatus,
  workerConfigs,
  mcpProjectQuery,
  mcpKeywordQuery,
  mcpQueryResult,
  theme,
  onMcpConfigChange,
  onMcpProjectQueryChange,
  onMcpKeywordQueryChange,
  onRunMcpTodoQuery,
  onRunMcpRecentQuery,
  onApplyRecommendedSetup,
  onWorkerConfigChange,
  onWorkerDangerModeChange,
  onProbeWorker,
  onStartMcpServer,
  onStopMcpServer,
  onRefreshMcpStatus,
  onOpenConsole,
  onThemeChange
}: SettingsViewProps) {
  return (
    <FadeContent duration={300}>
      <section>
        <h2 className="text-xl font-semibold m-0">设置</h2>
        <div className="ui-card p-4 mt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 m-0 font-semibold">
              <Icon icon="mingcute:plug-2-line" />
              MCP Server
            </h3>
            <span className={`ui-badge ${mcpStatus.running ? "ui-badge--success" : "ui-badge--error"}`}>
              <span className={`status-dot ${mcpStatus.running ? "status-done" : "status-blocked"}`} />
              {mcpStatus.running ? "运行中" : "未运行"}
            </span>
          </div>
          <div className="grid gap-2 mt-3">
            {mcpConfig.executable.trim() ? null : (
              <p className="text-muted text-sm m-0">
                当前使用内置 Maple MCP，支持最近上下文查询和项目 TODO 查询。
              </p>
            )}
            <input
              className="ui-input ui-input--sm w-full"
              value={mcpConfig.executable}
              onChange={(event) => onMcpConfigChange((prev) => ({ ...prev, executable: event.target.value }))}
              placeholder="留空使用内置 Maple MCP（推荐）"
            />
            <input
              className="ui-input ui-input--sm w-full"
              value={mcpConfig.args}
              onChange={(event) => onMcpConfigChange((prev) => ({ ...prev, args: event.target.value }))}
              placeholder="外部 MCP 参数（可选）"
            />
            <input
              className="ui-input ui-input--sm w-full"
              value={mcpConfig.cwd}
              onChange={(event) => onMcpConfigChange((prev) => ({ ...prev, cwd: event.target.value }))}
              placeholder="工作目录（可选）"
            />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={mcpConfig.autoStart}
                onChange={(event) => onMcpConfigChange((prev) => ({ ...prev, autoStart: event.target.checked }))}
              />
              启动 Maple 时自动拉起 MCP Server
            </label>
          </div>
          <div className="flex gap-2 flex-wrap mt-3">
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--accent gap-1"
              onClick={onApplyRecommendedSetup}
            >
              <Icon icon="mingcute:flash-line" />
              一键装好
            </button>
            <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={onStartMcpServer}>
              <Icon icon="mingcute:play-circle-line" />
              启动
            </button>
            <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={onStopMcpServer}>
              <Icon icon="mingcute:stop-circle-line" />
              停止
            </button>
            <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={onRefreshMcpStatus}>
              <Icon icon="mingcute:refresh-2-line" />
              刷新状态
            </button>
          </div>
          {mcpStatus.running ? (
            <p className="text-muted text-sm mt-2">
              PID {mcpStatus.pid ?? "?"}{mcpStatus.command ? ` | ${mcpStatus.command}` : ""}
            </p>
          ) : (
            <p className="text-sm mt-2" style={{ color: "var(--color-error, #d47049)" }}>
              Worker 验证和任务执行需要 MCP Server 处于运行状态。
            </p>
          )}
        </div>

        <div className="ui-card p-4 mt-3">
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:command-line" />
            Maple MCP（内置）
          </h3>
          <p className="text-muted text-sm mt-2 mb-0">
            已支持：`query_recent_context(limit=10)`、`query_project_todos(project)`
          </p>
          <div className="grid gap-2 mt-3">
            <div className="flex gap-2">
              <input
                className="ui-input ui-input--sm w-full"
                value={mcpProjectQuery}
                onChange={(event) => onMcpProjectQueryChange(event.target.value)}
                placeholder="输入项目名，例如 maple"
              />
              <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={onRunMcpTodoQuery}>
                <Icon icon="mingcute:search-line" />
                查 TODO
              </button>
            </div>
            <div className="flex gap-2">
              <input
                className="ui-input ui-input--sm w-full"
                value={mcpKeywordQuery}
                onChange={(event) => onMcpKeywordQueryChange(event.target.value)}
                placeholder="输入关键词（可空），返回最近 10 条上下文"
              />
              <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={onRunMcpRecentQuery}>
                <Icon icon="mingcute:time-line" />
                查上下文
              </button>
            </div>
            <textarea className="ui-textarea w-full" rows={8} readOnly value={mcpQueryResult || "暂无查询结果"} />
          </div>
        </div>

        <div className="ui-card p-4 mt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 m-0 font-semibold">
              <Icon icon="mingcute:ai-line" />
              Worker 接入
            </h3>
            <div className="flex items-center gap-2">
              {!mcpStatus.running ? (
                <span className="ui-badge ui-badge--warning">
                  <Icon icon="mingcute:alert-line" className="text-xs" />
                  需要 MCP
                </span>
              ) : null}
              <button
                type="button"
                className="ui-btn ui-btn--sm ui-btn--ghost gap-1"
                onClick={onOpenConsole}
              >
                <Icon icon="mingcute:terminal-box-line" />
                控制台
              </button>
            </div>
          </div>
          <p className="text-muted text-xs mt-2 mb-0">
            说明：验证仅检查 CLI 是否可执行，不代表该 Worker 已成功挂载 MCP。
          </p>
          <div className="overflow-x-auto mt-3">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>CLI 配置</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {WORKER_KINDS.map(({ kind, label }) => {
                  const config = workerConfigs[kind];
                  return (
                    <tr key={kind}>
                      <td className="font-medium">{label}</td>
                      <td>
                        <div className="grid gap-1.5">
                          <input
                            className="ui-input ui-input--xs w-full"
                            value={config.executable}
                            onChange={(event) => onWorkerConfigChange(kind, "executable", event.target.value)}
                            placeholder="命令（例如：codex / claude）"
                          />
                          <input
                            className="ui-input ui-input--xs w-full"
                            value={config.runArgs}
                            onChange={(event) => onWorkerConfigChange(kind, "runArgs", event.target.value)}
                            placeholder="任务执行参数（例如：exec 或 -p）"
                          />
                          <input
                            className="ui-input ui-input--xs w-full"
                            value={config.consoleArgs}
                            onChange={(event) => onWorkerConfigChange(kind, "consoleArgs", event.target.value)}
                            placeholder="控制台参数（默认留空进入交互）"
                          />
                          <input
                            className="ui-input ui-input--xs w-full"
                            value={config.probeArgs}
                            onChange={(event) => onWorkerConfigChange(kind, "probeArgs", event.target.value)}
                            placeholder="探测参数（例如：--version）"
                          />
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                              type="checkbox"
                              className="ui-checkbox"
                              checked={config.dangerMode}
                              onChange={(event) => onWorkerDangerModeChange(kind, event.target.checked)}
                            />
                            启用危险模式（跳过审批）
                          </label>
                        </div>
                      </td>
                      <td>
                        <button type="button" className="ui-btn ui-btn--xs ui-btn--outline gap-1" onClick={() => onProbeWorker(kind)}>
                          <Icon icon="mingcute:search-line" />
                          验证 CLI
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="ui-card p-4 mt-3">
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:palette-line" />
            外观
          </h3>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm">主题模式</span>
            <div className="flex gap-1">
              {([
                { mode: "system" as ThemeMode, label: "跟随系统", icon: "mingcute:computer-line" },
                { mode: "light" as ThemeMode, label: "浅色", icon: "mingcute:sun-line" },
                { mode: "dark" as ThemeMode, label: "深色", icon: "mingcute:moon-line" },
              ] as const).map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  className={`ui-btn ui-btn--sm gap-1 ${theme === opt.mode ? "ui-btn--outline" : "ui-btn--ghost"}`}
                  onClick={() => onThemeChange(opt.mode)}
                >
                  <Icon icon={opt.icon} className="text-sm" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </FadeContent>
  );
}

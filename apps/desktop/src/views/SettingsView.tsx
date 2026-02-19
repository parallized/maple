import { Icon } from "@iconify/react";
import { FadeContent } from "../components/ReactBits";
import { WORKER_KINDS } from "../lib/constants";
import type { ThemeMode } from "../lib/constants";
import type { McpServerConfig, McpServerStatus, WorkerConfig, WorkerKind } from "../domain";

type SettingsViewProps = {
  mcpConfig: McpServerConfig;
  mcpStatus: McpServerStatus;
  workerConfigs: Record<WorkerKind, WorkerConfig>;
  theme: ThemeMode;
  onMcpConfigChange: (updater: (prev: McpServerConfig) => McpServerConfig) => void;
  onWorkerConfigChange: (kind: WorkerKind, field: keyof WorkerConfig, value: string) => void;
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
  theme,
  onMcpConfigChange,
  onWorkerConfigChange,
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
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:plug-2-line" />
            MCP Server
          </h3>
          <div className="grid gap-2 mt-3">
            <input
              className="ui-input ui-input--sm w-full"
              value={mcpConfig.executable}
              onChange={(event) => onMcpConfigChange((prev) => ({ ...prev, executable: event.target.value }))}
              placeholder="启动命令（例如：npx）"
            />
            <input
              className="ui-input ui-input--sm w-full"
              value={mcpConfig.args}
              onChange={(event) => onMcpConfigChange((prev) => ({ ...prev, args: event.target.value }))}
              placeholder="启动参数（例如：-y @modelcontextprotocol/server-filesystem .）"
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
          <p className="text-muted text-sm mt-2">
            当前状态：{mcpStatus.running ? `运行中（PID ${mcpStatus.pid ?? "?"}）` : "未运行"}
            {mcpStatus.command ? ` | ${mcpStatus.command}` : ""}
          </p>
        </div>

        <div className="ui-card p-4 mt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 m-0 font-semibold">
              <Icon icon="mingcute:ai-line" />
              Worker 接入
            </h3>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost gap-1"
              onClick={onOpenConsole}
            >
              <Icon icon="mingcute:terminal-box-line" />
              控制台
            </button>
          </div>
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
                            placeholder="执行参数（例如：exec 或 -p）"
                          />
                          <input
                            className="ui-input ui-input--xs w-full"
                            value={config.probeArgs}
                            onChange={(event) => onWorkerConfigChange(kind, "probeArgs", event.target.value)}
                            placeholder="探测参数（例如：--version）"
                          />
                        </div>
                      </td>
                      <td>
                        <button type="button" className="ui-btn ui-btn--xs ui-btn--outline gap-1" onClick={() => onProbeWorker(kind)}>
                          <Icon icon="mingcute:search-line" />
                          验证
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

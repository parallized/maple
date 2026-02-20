import { Icon } from "@iconify/react";
import { FadeContent } from "../components/ReactBits";
import { WorkerLogo } from "../components/WorkerLogo";
import { WORKER_KINDS } from "../lib/constants";
import type { ThemeMode } from "../lib/constants";
import type { DetailMode, McpServerStatus, WorkerKind } from "../domain";

type SettingsViewProps = {
  mcpStatus: McpServerStatus;
  mcpStartupError: string;
  detailMode: DetailMode;
  theme: ThemeMode;
  onProbeWorker: (kind: WorkerKind) => void;
  onRestartMcpServer: () => void;
  onThemeChange: (mode: ThemeMode) => void;
  onDetailModeChange: (mode: DetailMode) => void;
};

export function SettingsView({
  mcpStatus,
  mcpStartupError,
  detailMode,
  theme,
  onProbeWorker,
  onRestartMcpServer,
  onThemeChange,
  onDetailModeChange
}: SettingsViewProps) {
  return (
    <FadeContent duration={300}>
      <section>
        <h2 className="text-xl font-semibold m-0">设置</h2>

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
          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm">任务详情</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`ui-btn ui-btn--sm gap-1 ${detailMode === "sidebar" ? "ui-btn--outline" : "ui-btn--ghost"}`}
                onClick={() => onDetailModeChange("sidebar")}
              >
                <Icon icon="mingcute:layout-right-line" className="text-sm" />
                右侧边栏
              </button>
              <button
                type="button"
                className={`ui-btn ui-btn--sm gap-1 ${detailMode === "modal" ? "ui-btn--outline" : "ui-btn--ghost"}`}
                onClick={() => onDetailModeChange("modal")}
              >
                <Icon icon="mingcute:layout-grid-line" className="text-sm" />
                弹出式
              </button>
            </div>
          </div>
        </div>

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
          <div className="flex gap-2 mt-3">
            <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={onRestartMcpServer}>
              <Icon icon="mingcute:refresh-2-line" />
              重启
            </button>
          </div>
          {mcpStartupError ? (
            <p className="text-sm mt-2" style={{ color: "var(--color-error, #d47049)" }}>
              {mcpStartupError}
            </p>
          ) : null}
        </div>

        <div className="ui-card p-4 mt-3">
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:ai-line" />
            Worker 接入
          </h3>
          <div className="overflow-x-auto mt-3">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {WORKER_KINDS.map(({ kind, label }) => (
                  <tr key={kind}>
                    <td className="font-medium">
                      <div className="flex items-center gap-2">
                        <WorkerLogo kind={kind} size={16} />
                        <span>{label}</span>
                      </div>
                    </td>
                    <td>
                      <button type="button" className="ui-btn ui-btn--xs ui-btn--outline gap-1" onClick={() => onProbeWorker(kind)}>
                        <Icon icon="mingcute:search-line" />
                        验证
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </FadeContent>
  );
}

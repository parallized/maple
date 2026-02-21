import { Icon } from "@iconify/react";
import { FadeContent } from "../components/ReactBits";
import { WorkerLogo } from "../components/WorkerLogo";
import { WORKER_KINDS } from "../lib/constants";
import type { AiLanguage, ThemeMode, UiLanguage } from "../lib/constants";
import type { DetailMode, McpServerStatus, WorkerKind } from "../domain";

type SettingsViewProps = {
  mcpStatus: McpServerStatus;
  mcpStartupError: string;
  detailMode: DetailMode;
  theme: ThemeMode;
  uiLanguage: UiLanguage;
  aiLanguage: AiLanguage;
  onProbeWorker: (kind: WorkerKind) => void;
  onRestartMcpServer: () => void;
  onThemeChange: (mode: ThemeMode) => void;
  onUiLanguageChange: (language: UiLanguage) => void;
  onAiLanguageChange: (language: AiLanguage) => void;
  onDetailModeChange: (mode: DetailMode) => void;
};

export function SettingsView({
  mcpStatus,
  mcpStartupError,
  detailMode,
  theme,
  uiLanguage,
  aiLanguage,
  onProbeWorker,
  onRestartMcpServer,
  onThemeChange,
  onUiLanguageChange,
  onAiLanguageChange,
  onDetailModeChange
}: SettingsViewProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);

  return (
    <FadeContent duration={300}>
      <section>
        <h2 className="text-xl font-semibold m-0">{t("设置", "Settings")}</h2>

        <div className="ui-card p-4 mt-3">
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:palette-line" />
            {t("外观", "Appearance")}
          </h3>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm">{t("主题模式", "Theme")}</span>
            <div className="flex gap-1">
              {([
                { mode: "system" as ThemeMode, label: t("跟随系统", "System"), icon: "mingcute:computer-line" },
                { mode: "light" as ThemeMode, label: t("浅色", "Light"), icon: "mingcute:sun-line" },
                { mode: "dark" as ThemeMode, label: t("深色", "Dark"), icon: "mingcute:moon-line" },
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
            <span className="text-sm">{t("任务详情", "Task Detail")}</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`ui-btn ui-btn--sm gap-1 ${detailMode === "sidebar" ? "ui-btn--outline" : "ui-btn--ghost"}`}
                onClick={() => onDetailModeChange("sidebar")}
              >
                <Icon icon="mingcute:layout-right-line" className="text-sm" />
                {t("右侧边栏", "Sidebar")}
              </button>
              <button
                type="button"
                className={`ui-btn ui-btn--sm gap-1 ${detailMode === "modal" ? "ui-btn--outline" : "ui-btn--ghost"}`}
                onClick={() => onDetailModeChange("modal")}
              >
                <Icon icon="mingcute:layout-grid-line" className="text-sm" />
                {t("弹出式", "Modal")}
              </button>
            </div>
          </div>
        </div>

        <div className="ui-card p-4 mt-3">
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:translate-line" />
            {t("语言", "Language")}
          </h3>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm">{t("界面语言", "UI language")}</span>
            <div className="flex gap-1">
              {([
                { value: "zh" as UiLanguage, label: t("中文", "Chinese") },
                { value: "en" as UiLanguage, label: "English" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`ui-btn ui-btn--sm ${uiLanguage === opt.value ? "ui-btn--outline" : "ui-btn--ghost"}`}
                  onClick={() => onUiLanguageChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <span className="text-sm">{t("AI 语言", "AI language")}</span>
            <div className="flex gap-1">
              {([
                { value: "follow_ui" as AiLanguage, label: t("跟随界面语言", "Follow UI") },
                { value: "zh" as AiLanguage, label: t("中文", "Chinese") },
                { value: "en" as AiLanguage, label: "English" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`ui-btn ui-btn--sm ${aiLanguage === opt.value ? "ui-btn--outline" : "ui-btn--ghost"}`}
                  onClick={() => onAiLanguageChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted mt-2 m-0">
            {t("AI 语言用于引导 Worker 输出报告的结论与标签。", "AI language guides Worker output (conclusion and tags).")}
          </p>
        </div>

        <div className="ui-card p-4 mt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 m-0 font-semibold">
              <Icon icon="mingcute:plug-2-line" />
              MCP Server
            </h3>
            <span className={`ui-badge ${mcpStatus.running ? "ui-badge--success" : "ui-badge--error"}`}>
              {mcpStatus.running ? t("运行中", "Running") : t("未运行", "Stopped")}
            </span>
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" className="ui-btn ui-btn--sm ui-btn--outline gap-1" onClick={onRestartMcpServer}>
              <Icon icon="mingcute:refresh-2-line" />
              {t("重启", "Restart")}
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
            {t("Worker 接入", "Workers")}
          </h3>
          <div className="overflow-x-auto mt-3">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>{t("操作", "Action")}</th>
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
                        {t("验证", "Verify")}
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

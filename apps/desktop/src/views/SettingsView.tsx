import { Icon } from "@iconify/react";
import { FadeContent } from "../components/ReactBits";
import { WorkerConfigCard, type WorkerProbe } from "../components/WorkerConfigCard";
import type { AiLanguage, ExternalEditorApp, ThemeMode, UiLanguage } from "../lib/constants";
import type { DetailMode, McpServerStatus, WorkerKind } from "../domain";
import type { InstallTargetId } from "../lib/install-targets";

type SettingsViewProps = {
  mcpStatus: McpServerStatus;
  mcpStartupError: string;
  detailMode: DetailMode;
  theme: ThemeMode;
  uiLanguage: UiLanguage;
  aiLanguage: AiLanguage;
  externalEditorApp: ExternalEditorApp;
  workerAvailability: Array<{
    kind: WorkerKind;
    label: string;
    executable: string;
    available: boolean;
  }>;
  installProbes: Partial<Record<InstallTargetId, WorkerProbe>>;
  onRestartMcpServer: () => void;
  onThemeChange: (mode: ThemeMode) => void;
  onUiLanguageChange: (language: UiLanguage) => void;
  onAiLanguageChange: (language: AiLanguage) => void;
  onExternalEditorAppChange: (app: ExternalEditorApp) => void;
  onDetailModeChange: (mode: DetailMode) => void;
  onRefreshProbes: () => void;
};

export function SettingsView({
  mcpStatus,
  mcpStartupError,
  detailMode,
  theme,
  uiLanguage,
  aiLanguage,
  externalEditorApp,
  workerAvailability,
  installProbes,
  onRestartMcpServer,
  onThemeChange,
  onUiLanguageChange,
  onAiLanguageChange,
  onExternalEditorAppChange,
  onDetailModeChange,
  onRefreshProbes
}: SettingsViewProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);

  const installedWorkers = workerAvailability.filter((w) => w.available);
  const uninstalledWorkers = workerAvailability.filter((w) => !w.available);

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
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:code-line" />
            {t("打开方式", "Open with")}
          </h3>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
              <span className="text-sm">{t("在编辑器打开", "Open in editor")}</span>
              <div className="flex gap-1 flex-wrap">
                {([
                { value: "vscode" as ExternalEditorApp, label: "VS Code", icon: "mingcute:vscode-line" },
                { value: "cursor" as ExternalEditorApp, label: "Cursor", icon: "mingcute:cursor-3-line" },
                { value: "windsurf" as ExternalEditorApp, label: "Windsurf", icon: "mingcute:wind-line" },
                { value: "visual_studio" as ExternalEditorApp, label: "Visual Studio", icon: "mingcute:windows-line" },
                { value: "github_desktop" as ExternalEditorApp, label: "GitHub Desktop", icon: "mingcute:github-line" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`ui-btn ui-btn--sm gap-1 ${externalEditorApp === opt.value ? "ui-btn--outline" : "ui-btn--ghost"}`}
                    onClick={() => onExternalEditorAppChange(opt.value)}
                  >
                    <Icon icon={opt.icon} className="text-sm" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          <p className="text-xs text-muted mt-2 m-0">
            {t("侧边栏中的「在编辑器打开」将使用此选项。", "The sidebar “Open in editor” button uses this setting.")}
          </p>
        </div>

        <div className="ui-card p-4 mt-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 m-0 font-semibold">
              <Icon icon="mingcute:plugin-2-line" />
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
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 m-0 font-semibold">
              <Icon icon="mingcute:ai-line" />
              {t("Worker 接入", "Workers")}
            </h3>

            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn"
              onClick={onRefreshProbes}
              aria-label={t("刷新检测", "Refresh detection")}
              title={t("刷新检测", "Refresh detection")}
            >
              <Icon icon="mingcute:refresh-2-line" />
            </button>
          </div>

          {/* Installed workers */}
          <div className="mt-3 flex flex-col gap-3">
            {installedWorkers.map((worker) => {
              const nativeProbe = installProbes[worker.kind as InstallTargetId];
              const wslProbe = installProbes[`wsl:${worker.kind}` as InstallTargetId];
              return (
                <WorkerConfigCard
                  key={worker.kind}
                  kind={worker.kind}
                  label={worker.label}
                  executable={worker.executable}
                  available={worker.available}
                  nativeProbe={nativeProbe}
                  wslProbe={wslProbe}
                  uiLanguage={uiLanguage}
                  variant="settings"
                />
              );
            })}
          </div>

          {/* Divider + Uninstalled workers */}
          {uninstalledWorkers.length > 0 ? (
            <>
              <div className="flex items-center gap-3 mt-4 mb-3">
                <div className="flex-1 h-px bg-[color-mix(in_srgb,var(--color-base-content)_8%,transparent)]" />
                <span className="text-[11px] text-muted font-sans opacity-60">
                  {t("未安装", "Not Installed")}
                </span>
                <div className="flex-1 h-px bg-[color-mix(in_srgb,var(--color-base-content)_8%,transparent)]" />
              </div>
              <div className="flex flex-col gap-3">
                {uninstalledWorkers.map((worker) => {
                  const nativeProbe = installProbes[worker.kind as InstallTargetId];
                  const wslProbe = installProbes[`wsl:${worker.kind}` as InstallTargetId];
                  return (
                    <WorkerConfigCard
                      key={worker.kind}
                      kind={worker.kind}
                      label={worker.label}
                      executable={worker.executable}
                      available={worker.available}
                      nativeProbe={nativeProbe}
                      wslProbe={wslProbe}
                      uiLanguage={uiLanguage}
                      variant="settings"
                    />
                  );
                })}
              </div>
            </>
          ) : null}

          <p className="text-xs text-muted mt-3 m-0">
            {t(
              "Maple 会自动检测本机与 WSL 的 Worker 环境。若刚完成安装，可点击右上角刷新。",
              "Maple detects Worker availability in Local and WSL automatically. Click refresh after installing."
            )}
          </p>
        </div>
      </section>
    </FadeContent>
  );
}

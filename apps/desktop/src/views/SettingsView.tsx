import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { FadeContent } from "../components/ReactBits";
import { WorkerConfigCard, type WorkerProbe } from "../components/WorkerConfigCard";
import type { CodexUsageConfig } from "../lib/codex-usage";
import { extractCodexUsageQuota, formatCodexUsageAmount } from "../lib/codex-usage";
import type { AiLanguage, ExternalEditorApp, ThemeMode, UiLanguage } from "../lib/constants";
import type { DetailMode, McpServerStatus, WorkerKind } from "../domain";
import { hasTauriRuntime } from "../lib/utils";
import type { InstallTargetId } from "../lib/install-targets";

type SettingsViewProps = {
  mcpStatus: McpServerStatus;
  mcpStartupError: string;
  detailMode: DetailMode;
  theme: ThemeMode;
  uiLanguage: UiLanguage;
  aiLanguage: AiLanguage;
  externalEditorApp: ExternalEditorApp;
  constitution: string;
  codexUsageConfig: CodexUsageConfig;
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
  onSaveConstitution: (next: string) => Promise<void> | void;
  onSaveCodexUsageConfig: (next: CodexUsageConfig) => Promise<void> | void;
  onDetailModeChange: (mode: DetailMode) => void;
  workerRetryIntervalSeconds: number;
  workerRetryMaxAttempts: number;
  onWorkerRetryIntervalChange: (seconds: number) => void;
  onWorkerRetryMaxAttemptsChange: (count: number) => void;
  onRefreshProbes: () => void;
  onReinstallSkills: () => void;
};

export function SettingsView({
  mcpStatus,
  mcpStartupError,
  detailMode,
  theme,
  uiLanguage,
  aiLanguage,
  externalEditorApp,
  constitution,
  codexUsageConfig,
  workerAvailability,
  installProbes,
  onRestartMcpServer,
  onThemeChange,
  onUiLanguageChange,
  onAiLanguageChange,
  onExternalEditorAppChange,
  onSaveConstitution,
  onSaveCodexUsageConfig,
  onDetailModeChange,
  workerRetryIntervalSeconds,
  workerRetryMaxAttempts,
  onWorkerRetryIntervalChange,
  onWorkerRetryMaxAttemptsChange,
  onRefreshProbes,
  onReinstallSkills
}: SettingsViewProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const isTauri = hasTauriRuntime();

  type InstallMeta = { skillsVersion: number | null; installedAt: string | null; latestSkillsVersion: number };
  const [installMeta, setInstallMeta] = useState<InstallMeta | null>(null);
  const [constitutionDraft, setConstitutionDraft] = useState<string>(() => constitution);
  const [constitutionSaving, setConstitutionSaving] = useState(false);
  const [codexUsageDraft, setCodexUsageDraft] = useState<CodexUsageConfig>(() => codexUsageConfig);
  const [codexUsageSaving, setCodexUsageSaving] = useState(false);
  const [codexUsageQuerying, setCodexUsageQuerying] = useState(false);
  const [codexUsageQueryError, setCodexUsageQueryError] = useState("");
  const [codexUsageFetchedAt, setCodexUsageFetchedAt] = useState<string | null>(null);
  const [codexUsageHttpStatus, setCodexUsageHttpStatus] = useState<number | null>(null);
  const [codexUsageQuota, setCodexUsageQuota] = useState<ReturnType<typeof extractCodexUsageQuota> | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    invoke<InstallMeta>("get_install_meta").then(setInstallMeta).catch(() => {});
  }, [isTauri]);

  useEffect(() => {
    setConstitutionDraft(constitution);
  }, [constitution]);

  useEffect(() => {
    setCodexUsageDraft(codexUsageConfig);
  }, [codexUsageConfig]);

  const installedWorkers = workerAvailability.filter((w) => w.available);
  const uninstalledWorkers = workerAvailability.filter((w) => !w.available);
  const constitutionDirty = constitutionDraft !== constitution;
  const codexUsageDirty =
    codexUsageDraft.baseUrl.trim() !== codexUsageConfig.baseUrl.trim()
    || codexUsageDraft.apiKey.trim() !== codexUsageConfig.apiKey.trim();

  async function handleSaveConstitution() {
    if (!constitutionDirty || constitutionSaving) return;
    try {
      setConstitutionSaving(true);
      await Promise.resolve(onSaveConstitution(constitutionDraft));
    } finally {
      setConstitutionSaving(false);
    }
  }

  async function handleSaveCodexUsage() {
    if (!codexUsageDirty || codexUsageSaving) return;
    try {
      setCodexUsageSaving(true);
      await Promise.resolve(onSaveCodexUsageConfig({
        baseUrl: codexUsageDraft.baseUrl.trim(),
        apiKey: codexUsageDraft.apiKey.trim(),
      }));
    } finally {
      setCodexUsageSaving(false);
    }
  }

  type CodexUsageHttpResult = {
    ok: boolean;
    status: number;
    body: unknown | null;
    text: string | null;
  };

  function formatCodexUsageError(error: unknown): string {
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
    }
    return String(error);
  }

  async function handleQueryCodexUsage() {
    if (!isTauri || codexUsageQuerying) return;

    const baseUrl = codexUsageDraft.baseUrl.trim();
    const apiKey = codexUsageDraft.apiKey.trim();
    if (!baseUrl || !apiKey) {
      setCodexUsageQueryError(t("è¯·å…ˆå¡«å†™ Base URL å’Œ API Keyã€‚", "Please fill Base URL and API key first."));
      return;
    }

    setCodexUsageQuerying(true);
    setCodexUsageQueryError("");

    try {
      const response = await invoke<CodexUsageHttpResult>("query_codex_usage", {
        baseUrl,
        apiKey,
      });
      setCodexUsageHttpStatus(Number.isFinite(response?.status) ? response.status : null);

      if (!response || typeof response !== "object") {
        setCodexUsageQuota(null);
        setCodexUsageQueryError(t("è¿”å›žæ ¼å¼ä¸æ­£ç¡®ã€‚", "Invalid response."));
        return;
      }

      if (!response.body) {
        setCodexUsageQuota(null);
        setCodexUsageQueryError(
          response.text?.trim()
            ? t(`æœåŠ¡è¿”å›žéž JSONï¼š${response.text.trim()}`, `Non-JSON response: ${response.text.trim()}`)
            : t("æœåŠ¡è¿”å›žä¸ºç©ºã€‚", "Empty response.")
        );
        return;
      }

      const quota = extractCodexUsageQuota(response.body);
      setCodexUsageQuota(quota);
      setCodexUsageFetchedAt(new Date().toISOString());
    } catch (error) {
      setCodexUsageQuota(null);
      setCodexUsageQueryError(formatCodexUsageError(error));
    } finally {
      setCodexUsageQuerying(false);
    }
  }

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
            <Icon icon="mingcute:book-2-line" />
            {t("宪法", "Constitution")}
          </h3>
          <p className="text-xs text-muted mt-2 m-0">
            {t(
              "为 Worker 提供全局执行规则。保存后，Worker 会在开始执行前读取 ~/.maple/constitution.md。",
              "Global rules for Workers. After saving, Workers read ~/.maple/constitution.md before execution."
            )}
          </p>

          <textarea
            className="ui-textarea mt-3"
            rows={7}
            value={constitutionDraft}
            placeholder={t(
              "例如：优先一次性命令；不要启动需要手动停止的进程；提交前必须通过类型检查与构建。",
              "Example: prefer one-shot commands; avoid long-running processes; run typecheck/build before marking done."
            )}
            onChange={(event) => setConstitutionDraft(event.currentTarget.value)}
          />

          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--outline gap-1"
              disabled={!constitutionDirty || constitutionSaving}
              onClick={() => void handleSaveConstitution()}
            >
              <Icon icon="mingcute:save-line" className="text-sm" />
              {constitutionSaving ? t("保存中…", "Saving…") : t("保存", "Save")}
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost"
              disabled={constitutionSaving || constitutionDraft.length === 0}
              onClick={() => setConstitutionDraft("")}
            >
              {t("清空", "Clear")}
            </button>
            <span className="text-xs text-muted ml-auto tabular-nums opacity-70">
              {constitutionDraft.length.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="ui-card p-4 mt-3">
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:time-line" />
            {t("执行重试", "Retry Policy")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("重试间隔（秒）", "Retry interval (s)")}</span>
              <input
                type="number"
                min={1}
                max={600}
                step={1}
                value={workerRetryIntervalSeconds}
                onChange={(event) => onWorkerRetryIntervalChange(Number(event.currentTarget.value))}
                className="ui-input w-[120px] text-right"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("最多重试次数", "Max retries")}</span>
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={workerRetryMaxAttempts}
                onChange={(event) => onWorkerRetryMaxAttemptsChange(Number(event.currentTarget.value))}
                className="ui-input w-[120px] text-right"
              />
            </label>
          </div>
          <p className="text-xs text-muted mt-2 m-0">
            {t(
              "当 Worker 结束后仍存在「进行中」任务时，Maple 会按此策略自动重试（默认 10 秒一次，最多 5 次）。",
              "When a worker exits but tasks are still in progress, Maple retries automatically with this policy."
            )}
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
          {installMeta ? (
            <div className="flex items-center gap-3 mt-3">
              <span className="text-xs text-muted">
                MCP & Skills {installMeta.skillsVersion != null ? `v${installMeta.skillsVersion}` : t("未安装", "Not installed")}
              </span>
              {installMeta.skillsVersion != null && installMeta.skillsVersion < installMeta.latestSkillsVersion ? (
                <button
                  type="button"
                  className="ui-btn ui-btn--xs ui-btn--outline gap-1 text-(--color-primary)"
                  onClick={() => { onReinstallSkills(); invoke<InstallMeta>("get_install_meta").then(setInstallMeta).catch(() => {}); }}
                >
                  <Icon icon="mingcute:upload-2-line" className="text-xs" />
                  {t("更新到", "Update to")} v{installMeta.latestSkillsVersion}
                </button>
              ) : installMeta.skillsVersion == null ? (
                <button
                  type="button"
                  className="ui-btn ui-btn--xs ui-btn--outline gap-1 text-(--color-primary)"
                  onClick={() => { onReinstallSkills(); invoke<InstallMeta>("get_install_meta").then(setInstallMeta).catch(() => {}); }}
                >
                  <Icon icon="mingcute:download-2-line" className="text-xs" />
                  {t("安装", "Install")}
                </button>
              ) : (
                <span className="ui-badge ui-badge--success text-[10px]">{t("最新", "Latest")}</span>
              )}
            </div>
          ) : null}
          {mcpStartupError ? (
            <p className="text-sm mt-2" style={{ color: "var(--color-error, #d47049)" }}>
              {mcpStartupError}
            </p>
          ) : null}
        </div>

        <div className="ui-card p-4 mt-3">
          <h3 className="flex items-center gap-1.5 m-0 font-semibold">
            <Icon icon="mingcute:wallet-3-line" />
            {t("余额查询", "Balance")}
          </h3>
          <p className="text-xs text-muted mt-2 m-0">
            {t(
              "可选：用于查询 Codex 账户的余额/额度（GET /codex/v1/usage）。不会影响 Worker 执行，只用于展示。",
              "Optional: query Codex balance/quota (GET /codex/v1/usage). This only affects display, not Worker execution."
            )}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm">{t("Base URL", "Base URL")}</span>
              <input
                type="text"
                className="ui-input font-mono"
                value={codexUsageDraft.baseUrl}
                placeholder="http://localhost:8080"
                onChange={(event) => setCodexUsageDraft((prev) => ({ ...prev, baseUrl: event.currentTarget.value }))}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm">{t("API Key", "API Key")}</span>
              <input
                type="password"
                className="ui-input font-mono"
                value={codexUsageDraft.apiKey}
                placeholder="sk-..."
                onChange={(event) => setCodexUsageDraft((prev) => ({ ...prev, apiKey: event.currentTarget.value }))}
              />
            </label>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--outline gap-1"
              disabled={!codexUsageDirty || codexUsageSaving}
              onClick={() => void handleSaveCodexUsage()}
            >
              <Icon icon="mingcute:save-line" className="text-sm" />
              {codexUsageSaving ? t("保存中…", "Saving…") : t("保存", "Save")}
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost"
              disabled={codexUsageSaving || (codexUsageDraft.baseUrl.length === 0 && codexUsageDraft.apiKey.length === 0)}
              onClick={() => setCodexUsageDraft({ baseUrl: "", apiKey: "" })}
            >
              {t("清除", "Clear")}
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--accent gap-1"
              disabled={!isTauri || codexUsageQuerying || !codexUsageDraft.baseUrl.trim() || !codexUsageDraft.apiKey.trim()}
              onClick={() => void handleQueryCodexUsage()}
              title={!isTauri ? t("仅桌面端可用", "Desktop only") : undefined}
            >
              <Icon
                icon={codexUsageQuerying ? "mingcute:loading-3-line" : "mingcute:search-2-line"}
                className={`text-[16px] ${codexUsageQuerying ? "animate-spin opacity-80" : ""}`.trim()}
              />
              {codexUsageQuerying ? t("查询中…", "Querying…") : t("查询余额", "Query")}
            </button>

            <span className="text-xs text-muted ml-auto tabular-nums opacity-70">
              {codexUsageHttpStatus != null ? `HTTP ${codexUsageHttpStatus}` : ""}
            </span>
          </div>

          {codexUsageQueryError ? (
            <div className="mt-2 rounded-[10px] border border-[color-mix(in_srgb,var(--color-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-error)_7%,transparent)] px-3 py-2">
              <div className="flex items-center gap-2 text-[12px] font-sans text-(--color-base-content)">
                <Icon icon="mingcute:warning-line" className="text-[16px]" />
                <span>{t("查询失败", "Query failed")}</span>
              </div>
              <div className="mt-1 text-[11px] font-mono text-(--color-base-content) opacity-80 whitespace-pre-wrap break-words">
                {codexUsageQueryError}
              </div>
            </div>
          ) : null}

          {codexUsageQuota ? (
            <div className="mt-3 rounded-[12px] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] bg-(--color-base-100) px-3 py-2.5">
              {codexUsageQuota.isValid ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] font-sans font-semibold text-(--color-base-content)">
                      {codexUsageQuota.planName}
                    </div>
                    <span className="ui-badge ui-badge--success text-[10px]">
                      {t("可用", "Available")}
                    </span>
                  </div>
                  <div className="mt-1 text-[14px] font-sans font-semibold text-(--color-base-content) tabular-nums">
                    {t("剩余", "Remaining")}:{" "}
                    {codexUsageQuota.remaining == null
                      ? t("—", "—")
                      : formatCodexUsageAmount(codexUsageQuota.remaining, codexUsageQuota.unit)}
                  </div>
                  <div className="mt-1 text-[11px] text-muted font-sans opacity-80 whitespace-pre-wrap break-words">
                    {codexUsageQuota.extra}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] font-sans font-semibold text-(--color-base-content)">
                      {t("暂无可用额度", "No available quota")}
                    </div>
                    <span className="ui-badge ui-badge--warning text-[10px]">
                      {codexUsageQuota.invalidCode}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted font-sans opacity-80 whitespace-pre-wrap break-words">
                    {codexUsageQuota.invalidMessage}
                  </div>
                </>
              )}

              {codexUsageFetchedAt ? (
                <div className="mt-2 text-[10px] text-muted font-sans opacity-60">
                  {t("更新时间", "Updated")}: {new Date(codexUsageFetchedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
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
                  onRefreshProbes={onRefreshProbes}
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
                      onRefreshProbes={onRefreshProbes}
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

import { Icon } from "@iconify/react";
import { useEffect, useState, type ReactNode } from "react";
import { FadeContent } from "../components/ReactBits";
import { WorkerConfigCard, type WorkerProbe } from "../components/WorkerConfigCard";
import { WorkerLogo } from "../components/WorkerLogo";
import { EXTERNAL_EDITOR_OPTIONS, WORKER_KINDS, type AiLanguage, type ExternalEditorApp, type ThemeMode, type UiFont, type UiLanguage } from "../lib/constants";
import type { AcceptanceSettings, DetailMode, ScreenshotCompressionPreset, WorkerKind } from "../domain";
import type { InstallTargetId } from "../lib/install-targets";
import { usePlatform } from "../platform/context";

/** 平台层注入的额外设置页签(如 Web 端的账户/工作区/安全),内容自行渲染,样式与内置页签保持一致。 */
export type SettingsExtraTab = {
  id: string;
  label: string;
  icon: string;
  content: ReactNode;
};

type SettingsViewProps = {
  detailMode: DetailMode;
  theme: ThemeMode;
  uiFont: UiFont;
  uiLanguage: UiLanguage;
  aiLanguage: AiLanguage;
  externalEditorApp: ExternalEditorApp;
  baseWorker: WorkerKind;
  constitution: string;
  workerAvailability: Array<{
    kind: WorkerKind;
    label: string;
    executable: string;
    available: boolean;
  }>;
  installProbes: Partial<Record<InstallTargetId, WorkerProbe>>;
  onThemeChange: (mode: ThemeMode) => void;
  onUiFontChange: (font: UiFont) => void;
  onUiLanguageChange: (language: UiLanguage) => void;
  onAiLanguageChange: (language: AiLanguage) => void;
  onBaseWorkerChange: (kind: WorkerKind) => void;
  onExternalEditorAppChange: (app: ExternalEditorApp) => void;
  onSaveConstitution: (next: string) => Promise<void> | void;
  onDetailModeChange: (mode: DetailMode) => void;
  workerRetryIntervalSeconds: number;
  workerRetryMaxAttempts: number;
  onWorkerRetryIntervalChange: (seconds: number) => void;
  onWorkerRetryMaxAttemptsChange: (count: number) => void;
  onRefreshProbes: () => void;
  extraTabs?: SettingsExtraTab[];
};

export function SettingsView({
  detailMode,
  theme,
  uiFont,
  uiLanguage,
  aiLanguage,
  externalEditorApp,
  constitution,
  workerAvailability,
  installProbes,
  onThemeChange,
  onUiFontChange,
  onUiLanguageChange,
  onAiLanguageChange,
  onExternalEditorAppChange,
  baseWorker,
  onBaseWorkerChange,
  onSaveConstitution,
  onDetailModeChange,
  workerRetryIntervalSeconds,
  workerRetryMaxAttempts,
  onWorkerRetryIntervalChange,
  onWorkerRetryMaxAttemptsChange,
  onRefreshProbes,
  extraTabs
}: SettingsViewProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const platform = usePlatform();
  const { capabilities } = platform;

  const [activeTab, setActiveTab] = useState<string>("general");
  const [constitutionDraft, setConstitutionDraft] = useState<string>(() => constitution);
  const [constitutionSaving, setConstitutionSaving] = useState(false);

  // ── 验收设置（Server-backed 平台才支持，读取/写回走 platform 可选方法）──
  const canEditAcceptance = typeof platform.loadAcceptanceSettings === "function" && typeof platform.saveAcceptanceSettings === "function";
  const [acceptance, setAcceptance] = useState<AcceptanceSettings | null>(null);
  const [acceptanceLoading, setAcceptanceLoading] = useState(false);
  const [acceptanceSaving, setAcceptanceSaving] = useState(false);
  const [acceptanceError, setAcceptanceError] = useState("");

  useEffect(() => {
    if (activeTab !== "acceptance" || !canEditAcceptance || acceptance) return;
    let cancelled = false;
    setAcceptanceLoading(true);
    setAcceptanceError("");
    platform.loadAcceptanceSettings!()
      .then((value) => {
        if (cancelled) return;
        setAcceptance(value ?? { backgroundPlaywrightScreenshot: false });
      })
      .catch((error) => {
        if (cancelled) return;
        setAcceptanceError(t("验收设置加载失败，请稍后重试。", "Failed to load acceptance settings."));
        console.error("Failed to load acceptance settings:", error);
      })
      .finally(() => {
        if (!cancelled) setAcceptanceLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canEditAcceptance, acceptance]);

  async function handleToggleAcceptance() {
    if (!acceptance || acceptanceSaving || !canEditAcceptance) return;
    const next: AcceptanceSettings = {
      ...acceptance,
      backgroundPlaywrightScreenshot: !acceptance.backgroundPlaywrightScreenshot
    };
    setAcceptance(next);
    setAcceptanceSaving(true);
    setAcceptanceError("");
    try {
      await platform.saveAcceptanceSettings!(next);
    } catch (error) {
      setAcceptance(acceptance);
      setAcceptanceError(t("保存失败，开关已回退。", "Save failed, reverted."));
      console.error("Failed to save acceptance settings:", error);
    } finally {
      setAcceptanceSaving(false);
    }
  }

  async function handleCompressionPresetChange(preset: ScreenshotCompressionPreset) {
    if (!acceptance || acceptanceSaving || !canEditAcceptance) return;
    if ((acceptance.screenshotCompressionPreset ?? "balanced") === preset) return;
    const next: AcceptanceSettings = { ...acceptance, screenshotCompressionPreset: preset };
    setAcceptance(next);
    setAcceptanceSaving(true);
    setAcceptanceError("");
    try {
      await platform.saveAcceptanceSettings!(next);
    } catch (error) {
      setAcceptance(acceptance);
      setAcceptanceError(t("保存失败，档位已回退。", "Save failed, reverted."));
      console.error("Failed to save acceptance settings:", error);
    } finally {
      setAcceptanceSaving(false);
    }
  }

  useEffect(() => {
    setConstitutionDraft(constitution);
  }, [constitution]);

  const installedWorkers = workerAvailability.filter((w) => w.available);
  const uninstalledWorkers = workerAvailability.filter((w) => !w.available);
  const constitutionDirty = constitutionDraft !== constitution;

  async function handleSaveConstitution() {
    if (!constitutionDirty || constitutionSaving) return;
    try {
      setConstitutionSaving(true);
      await Promise.resolve(onSaveConstitution(constitutionDraft));
    } finally {
      setConstitutionSaving(false);
    }
  }

  const tabs = [
    { id: "general", label: t("常规", "General"), icon: "mingcute:settings-3-line" },
    ...(capabilities.canInstall
      ? [{ id: "workers", label: t("Worker", "Worker"), icon: "mingcute:plugin-2-line" }]
      : []),
    { id: "constitution", label: t("宪法", "Constitution"), icon: "mingcute:book-2-line" },
    { id: "retry", label: t("重试策略", "Retry Policy"), icon: "mingcute:refresh-2-line" },
    ...(canEditAcceptance
      ? [{ id: "acceptance", label: t("验收", "Acceptance"), icon: "mingcute:camera-line" }]
      : []),
    ...(capabilities.canOpenPath
      ? [{ id: "open-with", label: t("打开方式", "Open with"), icon: "mingcute:external-link-line" }]
      : []),
  ] as const;
  const allTabs: Array<{ id: string; label: string; icon: string }> = [
    ...tabs,
    ...(extraTabs ?? []).map((tab) => ({ id: tab.id, label: tab.label, icon: tab.icon }))
  ];

  return (
    <FadeContent duration={300} className="h-full">
      <section className="h-full max-w-full flex flex-col">
        <div className="flex flex-1 min-h-0 gap-[0.9rem]">
          {/* Sidebar Navigation */}
          <aside className="board-sidebar">
            <div className="flex items-center gap-2 min-w-0 px-1 mb-4">
              <span className="text-[1.35rem] font-medium truncate tracking-tight text-(--color-base-content)">
                {t("设置", "Settings")}
              </span>
            </div>

            <nav className="flex flex-col gap-0.5 select-none">
              {allTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`flex items-center gap-3 px-3 py-2 rounded-[9px] text-[14px] transition-all text-left ${
                    activeTab === tab.id
                      ? "text-(--color-base-content) font-semibold bg-(--color-base-100) shadow-sm ring-1 ring-base-300/20"
                      : "text-(--color-secondary) hover:text-(--color-base-content) hover:bg-(--color-base-300)/20"
                  }`}
                  onClick={() => setActiveTab(tab.id as any)}
                >
                  <Icon
                    icon={tab.icon}
                    className={`text-lg transition-all ${activeTab === tab.id ? "" : "opacity-50"}`}
                  />
                  <span className="flex-1">{tab.label}</span>
                </button>
              ))}
            </nav>
          </aside>

          {/* Tab Content */}
          <div className="board-main overflow-y-auto custom-scrollbar">
            <FadeContent duration={200} key={activeTab}>
              <div className="flex flex-col gap-12 max-w-2xl py-4">
                {activeTab === "general" && (
                  <>
                    <section>
                      <h3 className="text-[10px] font-bold text-muted/40 uppercase tracking-[0.2em] mb-8 px-1 flex items-center gap-2">
                        <Icon icon="mingcute:palette-line" className="text-sm" />
                        {t("外观定制", "Appearance")}
                      </h3>
                      
                      <div className="flex flex-col gap-10 px-1">
                        <div className="flex items-center justify-between group">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[14px] font-bold text-base-content/90">{t("界面主题", "Theme Mode")}</span>
                            <span className="text-[12px] text-muted/50 leading-relaxed max-w-[300px]">
                              {t("选择适合您的视觉风格，支持跟随系统自动切换。", "Choose your preferred visual style.")}
                            </span>
                          </div>
                          <div className="flex bg-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-1 rounded-2xl">
                            {([
                              { mode: "system" as ThemeMode, label: t("自动", "Auto"), icon: "mingcute:computer-line" },
                              { mode: "light" as ThemeMode, label: t("浅色", "Light"), icon: "mingcute:sun-line" },
                              { mode: "dark" as ThemeMode, label: t("深色", "Dark"), icon: "mingcute:moon-line" },
                            ] as const).map((opt) => (
                              <button
                                key={opt.mode}
                                type="button"
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-all ${
                                  theme === opt.mode
                                    ? "bg-base-100 text-base-content shadow-sm"
                                    : "text-muted/60 hover:text-base-content"
                                }`}
                                onClick={() => onThemeChange(opt.mode)}
                              >
                                <Icon icon={opt.icon} className="text-base" />
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between group">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[14px] font-bold text-base-content/90">{t("全局字体", "Interface Font")}</span>
                            <span className="text-[12px] text-muted/50 leading-relaxed max-w-[300px]">
                              {t("切换整个看板的界面字体，首次选择寒蝉全圆体时会加载字体文件。", "Switch the interface font of the whole board.")}
                            </span>
                          </div>
                          <div className="flex bg-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-1 rounded-2xl">
                            {([
                              { font: "default" as UiFont, label: t("默认", "Default"), icon: "mingcute:text-line" },
                              { font: "chill-round" as UiFont, label: t("寒蝉全圆体", "ChillRound"), icon: "mingcute:font-line" },
                            ] as const).map((opt) => (
                              <button
                                key={opt.font}
                                type="button"
                                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-all ${
                                  uiFont === opt.font
                                    ? "bg-base-100 text-base-content shadow-sm"
                                    : "text-muted/60 hover:text-base-content"
                                }`}
                                onClick={() => onUiFontChange(opt.font)}
                              >
                                <Icon icon={opt.icon} className="text-base" />
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between group">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[14px] font-bold text-base-content/90">{t("任务展示方式", "Task Details")}</span>
                            <span className="text-[12px] text-muted/50 leading-relaxed max-w-[300px]">
                              {t("控制点击任务后的内容呈现。侧边栏更利于多任务并行。", "Control how task content is displayed.")}
                            </span>
                          </div>
                          <div className="flex bg-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-1 rounded-2xl">
                            <button
                              type="button"
                              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[12px] font-bold transition-all ${
                                detailMode === "sidebar"
                                  ? "bg-base-100 text-base-content shadow-sm"
                                  : "text-muted/60 hover:text-base-content"
                              }`}
                              onClick={() => onDetailModeChange("sidebar")}
                            >
                              <Icon icon="mingcute:layout-right-line" className="text-base" />
                              {t("侧边栏", "Sidebar")}
                            </button>
                            <button
                              type="button"
                              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[12px] font-bold transition-all ${
                                detailMode === "modal"
                                  ? "bg-base-100 text-base-content shadow-sm"
                                  : "text-muted/60 hover:text-base-content"
                              }`}
                              onClick={() => onDetailModeChange("modal")}
                            >
                              <Icon icon="mingcute:layout-grid-line" className="text-base" />
                              {t("弹窗", "Modal")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-[10px] font-bold text-muted/40 uppercase tracking-[0.2em] mb-8 px-1 flex items-center gap-2">
                        <Icon icon="mingcute:ai-line" className="text-sm" />
                        {t("基模", "Base Model")}
                      </h3>
                      <div className="flex flex-col gap-4 px-1">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[14px] font-bold text-base-content/90">{t("关键统领模型", "Key Orchestrator")}</span>
                          <span className="text-[12px] text-muted/50 leading-relaxed max-w-[420px]">
                            {t("基模是关键统领模型，新建任务默认交由基模执行，可在任务列表中随时调整。", "The base model orchestrates all work. New tasks are assigned to it by default.")}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {WORKER_KINDS.map((worker) => (
                            <button
                              key={worker.kind}
                              type="button"
                              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-[12px] font-bold transition-all ${
                                baseWorker === worker.kind
                                  ? "bg-primary/5 border-primary/30 text-primary shadow-sm ring-1 ring-primary/10"
                                  : "bg-base-300/10 border-transparent text-muted hover:bg-base-300/20 hover:text-base-content"
                              }`}
                              onClick={() => onBaseWorkerChange(worker.kind)}
                            >
                              <WorkerLogo kind={worker.kind} size={16} />
                              {worker.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="text-[10px] font-bold text-muted/40 uppercase tracking-[0.2em] mb-8 px-1 flex items-center gap-2">
                        <Icon icon="mingcute:translate-line" className="text-sm" />
                        {t("语言与地区", "Language")}
                      </h3>
                      
                      <div className="flex flex-col gap-10 px-1">
                        <div className="flex items-center justify-between group">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[14px] font-bold text-base-content/90">{t("界面显示语言", "UI Language")}</span>
                            <span className="text-[12px] text-muted/50 leading-relaxed">
                              {t("更改 Maple 本体的首选显示语言。", "Change display language of Maple.")}
                            </span>
                          </div>
                          <div className="flex bg-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-1 rounded-2xl">
                            {([
                              { value: "zh" as UiLanguage, label: "中文" },
                              { value: "en" as UiLanguage, label: "English" },
                            ] as const).map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                className={`px-6 py-2 rounded-xl text-[12px] font-bold transition-all ${
                                  uiLanguage === opt.value
                                    ? "bg-base-100 text-base-content shadow-sm"
                                    : "text-muted/60 hover:text-base-content"
                                }`}
                                onClick={() => onUiLanguageChange(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between group">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[14px] font-bold text-base-content/90">{t("AI 输出偏好", "AI Preference")}</span>
                            <span className="text-[12px] text-muted/50 leading-relaxed max-w-[300px]">
                              {t("控制 AI 输出任务报告和执行总结时的首选语言。", "Preferred language for AI-generated reports.")}
                            </span>
                          </div>
                          <div className="flex bg-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-1 rounded-2xl">
                            {([
                              { value: "follow_ui" as AiLanguage, label: t("跟随界面", "Auto") },
                              { value: "zh" as AiLanguage, label: "中文" },
                              { value: "en" as AiLanguage, label: "English" },
                            ] as const).map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                className={`px-5 py-2 rounded-xl text-[12px] font-bold transition-all ${
                                  aiLanguage === opt.value
                                    ? "bg-base-100 text-base-content shadow-sm"
                                    : "text-muted/60 hover:text-base-content"
                                }`}
                                onClick={() => onAiLanguageChange(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>
                  </>
                )}

                {activeTab === "workers" && (
                  <>
                    <section>
                      <div className="flex items-center justify-between mb-6 px-1">
                        <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
                          <Icon icon="mingcute:ai-line" className="text-sm" />
                          {t("AI Worker 接入", "Workers")}
                        </h3>
                        <button
                          type="button"
                          className="text-muted/60 hover:text-primary transition-all flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                          onClick={onRefreshProbes}
                        >
                          <Icon icon="mingcute:refresh-2-line" className="text-xs" />
                          {t("重新扫描", "Rescan")}
                        </button>
                      </div>

                      <div className="flex flex-col gap-2 px-1">
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

                        {uninstalledWorkers.length > 0 && (
                          <>
                            <div className="flex items-center gap-4 my-4">
                              <span className="text-[10px] text-muted/40 font-bold uppercase tracking-[0.2em] whitespace-nowrap">{t("可接入", "Available")}</span>
                              <div className="h-px w-full bg-base-300/10" />
                            </div>
                            <div className="opacity-60 grayscale hover:grayscale-0 hover:opacity-100 transition-all flex flex-col gap-2">
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
                        )}
                      </div>
                    </section>
                  </>
                )}

                {activeTab === "constitution" && (
                  <section>
                    <div className="flex flex-col gap-1 mb-6 px-1">
                      <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
                        <Icon icon="mingcute:book-2-line" className="text-sm" />
                        {t("指令宪法", "Constitution")}
                      </h3>
                      <p className="text-xs text-muted/60 leading-relaxed mt-1">
                        {t(
                          "在此定义全局指令约束。所有 Worker 在执行前都会阅读并严格遵守这些规则。",
                          "Define global constraints here. All workers will follow these rules strictly."
                        )}
                      </p>
                    </div>
                    
                    <div className="flex flex-col gap-4 px-1">
                      <div className="relative group">
                        <textarea
                          className="ui-textarea min-h-[420px] bg-base-300/10 border-base-300/20 focus:bg-base-100/50 transition-all font-mono text-[14px] leading-relaxed p-6 rounded-2xl custom-scrollbar resize-none"
                          value={constitutionDraft}
                          placeholder={t(
                            "例如：\n- 优先使用单次执行命令，避免交互式操作\n- 提交代码前必须执行 bun run build\n- 严格遵守现有的项目代码结构和命名规范",
                            "Example:\n- Prefer one-shot commands\n- Run bun run build before marking done\n- Follow existing project style and structure"
                          )}
                          onChange={(event) => setConstitutionDraft(event.currentTarget.value)}
                        />
                        <div className="absolute top-4 right-4 flex items-center gap-2">
                          <div className="bg-base-100/80 backdrop-blur px-2 py-1 rounded-md border border-base-300/10 text-[10px] font-mono text-muted tabular-nums shadow-sm">
                            {constitutionDraft.length.toLocaleString()} <span className="opacity-40">CHARS</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-xl text-sm font-bold transition-all ${
                            constitutionDirty 
                              ? "bg-primary text-white shadow-lg shadow-primary/20 active:scale-[0.98]" 
                              : "bg-base-300/20 text-muted cursor-not-allowed"
                          }`}
                          disabled={!constitutionDirty || constitutionSaving}
                          onClick={() => void handleSaveConstitution()}
                        >
                          <Icon icon={constitutionSaving ? "mingcute:loading-3-line" : "mingcute:save-line"} className={constitutionSaving ? "animate-spin" : "text-lg"} />
                          {constitutionSaving ? t("正在保存...", "Saving...") : t("保存全局宪法", "Save Constitution")}
                        </button>
                        <button
                          type="button"
                          className="w-11 h-11 flex items-center justify-center rounded-xl bg-base-300/10 text-muted hover:text-error hover:bg-error/10 transition-all"
                          disabled={constitutionSaving || constitutionDraft.length === 0}
                          onClick={() => setConstitutionDraft("")}
                          title={t("清空内容", "Clear content")}
                        >
                          <Icon icon="mingcute:delete-2-line" className="text-lg" />
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === "retry" && (
                  <section>
                    <div className="flex flex-col gap-1 mb-8 px-1">
                      <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
                        <Icon icon="mingcute:refresh-2-line" className="text-sm" />
                        {t("自动重试策略", "Retry Policy")}
                      </h3>
                      <p className="text-xs text-muted/60 leading-relaxed mt-1">
                        {t(
                          "当 Worker 任务结束后仍存在「进行中」项时，Maple 将按此策略尝试自动恢复。",
                          "Maple restarts workers based on this policy if tasks remain in progress."
                        )}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-10 px-1">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-semibold">{t("重试间隔", "Retry Interval")}</span>
                          <span className="text-[12px] text-muted leading-relaxed">{t("单次尝试失败后的等待时间。", "Wait time between attempts.")}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min={1}
                            max={600}
                            value={workerRetryIntervalSeconds}
                            onChange={(event) => onWorkerRetryIntervalChange(Number(event.currentTarget.value))}
                            className="flex-1 ui-input h-10 bg-base-300/10 border-base-300/10 font-mono text-center"
                          />
                          <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{t("秒", "Sec")}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-semibold">{t("最大重试次数", "Max Retries")}</span>
                          <span className="text-[12px] text-muted leading-relaxed">{t("自动放弃前的尝试上限。", "Max total attempts.")}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={workerRetryMaxAttempts}
                            onChange={(event) => onWorkerRetryMaxAttemptsChange(Number(event.currentTarget.value))}
                            className="flex-1 ui-input h-10 bg-base-300/10 border-base-300/10 font-mono text-center"
                          />
                          <span className="text-[10px] font-bold text-muted uppercase tracking-wider">{t("次", "Times")}</span>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === "acceptance" && (
                  <section>
                    <div className="flex flex-col gap-1 mb-8 px-1">
                      <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
                        <Icon icon="mingcute:camera-line" className="text-sm" />
                        {t("验收", "Acceptance")}
                      </h3>
                      <p className="text-xs text-muted/60 leading-relaxed mt-1">
                        {t(
                          "任务验收相关的行为开关，保存在 Server 端，对所有看板与执行端生效。",
                          "Acceptance behavior switches, stored on the server and applied globally."
                        )}
                      </p>
                    </div>

                    <div className="flex items-center justify-between group px-1">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[14px] font-bold text-base-content/90">
                          {t("后台 Playwright 截图验收", "Background Playwright Screenshots")}
                        </span>
                        <span className="text-[12px] text-muted/50 leading-relaxed max-w-[360px]">
                          {t(
                            "开启后，执行端在完成任务时自动用 Playwright 后台截图，作为验收依据附入执行报告。",
                            "Workers capture background Playwright screenshots on completion, attached to the run report as acceptance evidence."
                          )}
                        </span>
                        {acceptanceError ? (
                          <span className="text-[12px] text-(--color-error)">{acceptanceError}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={acceptance?.backgroundPlaywrightScreenshot ?? false}
                        aria-label={t("后台 Playwright 截图验收", "Background Playwright Screenshots")}
                        disabled={!acceptance || acceptanceLoading || acceptanceSaving}
                        onClick={handleToggleAcceptance}
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
                          acceptance?.backgroundPlaywrightScreenshot
                            ? "bg-(--color-primary)"
                            : "bg-[color-mix(in_srgb,var(--color-base-content)_15%,transparent)]"
                        }`}
                      >
                        <span
                          className={`absolute top-[3px] size-[18px] rounded-full bg-white shadow-sm transition-all ${
                            acceptance?.backgroundPlaywrightScreenshot ? "left-[23px]" : "left-[3px]"
                          }`}
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between group px-1 mt-6">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[14px] font-bold text-base-content/90">
                          {t("截图质量", "Screenshot Quality")}
                        </span>
                        <span className="text-[12px] text-muted/50 leading-relaxed max-w-[360px]">
                          {t(
                            "质量越高截图越清晰，但文件更大、上传更慢；紧凑档适合只需快速确认结果的场景。",
                            "Higher quality means sharper screenshots but larger uploads; compact is best for quick checks."
                          )}
                        </span>
                      </div>
                      <div className="flex bg-[color-mix(in_srgb,var(--color-base-content)_6%,transparent)] p-1 rounded-2xl shrink-0">
                        {([
                          { id: "high", label: t("高画质", "High"), icon: "mingcute:sparkles-line" },
                          { id: "balanced", label: t("均衡", "Balanced"), icon: "mingcute:balance-line" },
                          { id: "compact", label: t("紧凑", "Compact"), icon: "mingcute:file-zip-line" }
                        ] as const).map((option) => {
                          const current = acceptance?.screenshotCompressionPreset ?? "balanced";
                          const active = current === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={!acceptance || acceptanceLoading || acceptanceSaving}
                              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40 ${
                                active
                                  ? "bg-base-100 text-base-content shadow-sm"
                                  : "text-muted/60 hover:text-base-content"
                              }`}
                              onClick={() => void handleCompressionPresetChange(option.id)}
                            >
                              <Icon icon={option.icon} className="text-base" />
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === "open-with" && (
                  <section>
                    <div className="flex flex-col gap-1 mb-8 px-1">
                      <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
                        <Icon icon="mingcute:external-link-line" className="text-sm" />
                        {t("代码编辑器接入", "Code Editor")}
                      </h3>
                      <p className="text-xs text-muted/60 leading-relaxed mt-1">
                        {t(
                          "配置您偏好的外部编辑器。点击任务详情中的路径将直接跳转。",
                          "Configure your preferred code editor for quick file navigation."
                        )}
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 px-1">
                      {EXTERNAL_EDITOR_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left ${
                            externalEditorApp === opt.value
                              ? "bg-primary/5 border-primary/30 text-primary shadow-sm ring-1 ring-primary/10"
                              : "bg-base-300/10 border-transparent text-muted hover:bg-base-300/20 hover:text-base-content"
                          }`}
                          onClick={() => onExternalEditorAppChange(opt.value)}
                        >
                          <div className={`p-2.5 rounded-xl transition-colors ${externalEditorApp === opt.value ? "bg-primary text-white" : "bg-base-300/40 opacity-60"}`}>
                            <Icon icon={opt.icon} className="text-xl" />
                          </div>
                          <div className="flex flex-col flex-1">
                            <span className="text-[14px] font-bold">{opt.label}</span>
                            <span className="text-[10px] opacity-60 uppercase tracking-tighter">Application</span>
                          </div>
                          {externalEditorApp === opt.value && (
                            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-white">
                              <Icon icon="mingcute:check-2-line" className="text-xs" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {(extraTabs ?? []).map((tab) =>
                  activeTab === tab.id ? <section key={tab.id}>{tab.content}</section> : null
                )}
              </div>
            </FadeContent>
          </div>
        </div>
      </section>
    </FadeContent>
  );

}


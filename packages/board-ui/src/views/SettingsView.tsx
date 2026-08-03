import { Icon } from "@iconify/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FadeContent } from "../components/ReactBits";
import { DeepSeekConnectionDialog } from "../components/DeepSeekConnectionDialog";
import { WorkerConfigCard, type WorkerProbe } from "../components/WorkerConfigCard";
import { WorkerLogo } from "../components/WorkerLogo";
import { EXTERNAL_EDITOR_OPTIONS, WORKER_KINDS, type AiLanguage, type ExternalEditorApp, type ThemeMode, type UiFont, type UiLanguage } from "../lib/constants";
import type { AcceptanceSettings, DeepSeekConnectionStatus, DetailMode, ScreenshotCompressionPreset, WorkerKind } from "../domain";
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
  /** Leader PM 使用的 Coding Agent。 */
  leaderWorker: WorkerKind;
  constitution: string;
  leaderConstitution: string;
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
  onLeaderWorkerChange: (kind: WorkerKind) => void;
  onExternalEditorAppChange: (app: ExternalEditorApp) => void;
  onSaveConstitution: (worker: string, leader: string) => Promise<void> | void;
  onDetailModeChange: (mode: DetailMode) => void;
  workerRetryIntervalSeconds: number;
  workerRetryMaxAttempts: number;
  workerConcurrency: number;
  onWorkerRetryIntervalChange: (seconds: number) => void;
  onWorkerRetryMaxAttemptsChange: (count: number) => void;
  onWorkerConcurrencyChange: (count: number) => void;
  /** 完成提醒音频的可播放 URL（未上传为 null）。 */
  reminderAudioUrl: string | null;
  /** 完成提醒音频文件名（未上传为 null）。 */
  reminderAudioName: string | null;
  /** 任务完成时通过 CLI 播放提醒音频。 */
  reminderPlayCli: boolean;
  /** 任务完成时在 Maple 应用内播放提醒音频。 */
  reminderPlayMaple: boolean;
  onUploadReminderAudio: (file: File) => void;
  onRemoveReminderAudio: () => void;
  onReminderPlayCliChange: (enabled: boolean) => void;
  onReminderPlayMapleChange: (enabled: boolean) => void;
  /** 调试列开关：表格标签列右侧展示缓存率 / 总价 / SID。 */
  debugColumnEnabled: boolean;
  onDebugColumnChange: (enabled: boolean) => void;
  onRefreshProbes: () => void;
  extraTabs?: SettingsExtraTab[];
  /** 外部请求切换到指定页签(如点看板 Leader 状态条跳「模型和工具」);nonce 变化即生效。 */
  tabRequest?: { tab: string; nonce: number } | null;
};

export function SettingsView({
  detailMode,
  theme,
  uiFont,
  uiLanguage,
  aiLanguage,
  externalEditorApp,
  constitution,
  leaderConstitution,
  workerAvailability,
  installProbes,
  onThemeChange,
  onUiFontChange,
  onUiLanguageChange,
  onAiLanguageChange,
  onExternalEditorAppChange,
  baseWorker,
  leaderWorker,
  onBaseWorkerChange,
  onLeaderWorkerChange,
  onSaveConstitution,
  onDetailModeChange,
  workerRetryIntervalSeconds,
  workerRetryMaxAttempts,
  workerConcurrency,
  onWorkerRetryIntervalChange,
  onWorkerRetryMaxAttemptsChange,
  onWorkerConcurrencyChange,
  reminderAudioUrl,
  reminderAudioName,
  reminderPlayCli,
  reminderPlayMaple,
  onUploadReminderAudio,
  onRemoveReminderAudio,
  onReminderPlayCliChange,
  onReminderPlayMapleChange,
  debugColumnEnabled,
  onDebugColumnChange,
  onRefreshProbes,
  extraTabs,
  tabRequest
}: SettingsViewProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const platform = usePlatform();
  const { capabilities } = platform;

  const [activeTab, setActiveTab] = useState<string>("general");

  // 外部页签请求:nonce 每次变化都切过去(同一页签也可重复触发)。
  useEffect(() => {
    if (tabRequest) setActiveTab(tabRequest.tab);
  }, [tabRequest?.nonce]);
  const [constitutionDraft, setConstitutionDraft] = useState<string>(() => constitution);
  const [leaderConstitutionDraft, setLeaderConstitutionDraft] = useState<string>(() => leaderConstitution);
  const [constitutionSaveState, setConstitutionSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const onSaveConstitutionRef = useRef(onSaveConstitution);
  onSaveConstitutionRef.current = onSaveConstitution;
  const constitutionDraftRef = useRef(constitutionDraft);
  constitutionDraftRef.current = constitutionDraft;
  const leaderConstitutionDraftRef = useRef(leaderConstitutionDraft);
  leaderConstitutionDraftRef.current = leaderConstitutionDraft;
  const lastSavedDraftRef = useRef({ worker: constitution, leader: leaderConstitution });

  const canManageDeepSeek = typeof platform.loadDeepSeekConnection === "function"
    && typeof platform.connectDeepSeek === "function"
    && typeof platform.disconnectDeepSeek === "function";
  const [deepSeekStatus, setDeepSeekStatus] = useState<DeepSeekConnectionStatus | null>(null);
  const [deepSeekStatusLoading, setDeepSeekStatusLoading] = useState(false);
  const [deepSeekStatusError, setDeepSeekStatusError] = useState("");
  const [deepSeekDialogOpen, setDeepSeekDialogOpen] = useState(false);

  async function reloadDeepSeekStatus(): Promise<void> {
    if (!canManageDeepSeek || deepSeekStatusLoading) return;
    setDeepSeekStatusLoading(true);
    setDeepSeekStatusError("");
    try {
      setDeepSeekStatus(await platform.loadDeepSeekConnection!());
    } catch (error) {
      setDeepSeekStatusError(error instanceof Error
        ? error.message
        : t("无法读取 DeepSeek 连接状态。", "Could not load the DeepSeek connection."));
    } finally {
      setDeepSeekStatusLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "models" || !canManageDeepSeek || deepSeekStatus || deepSeekStatusLoading || deepSeekStatusError) return;
    void reloadDeepSeekStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, canManageDeepSeek, deepSeekStatus, deepSeekStatusLoading, deepSeekStatusError]);

  async function handleConnectDeepSeek(apiKey: string): Promise<void> {
    const next = await platform.connectDeepSeek!(apiKey);
    setDeepSeekStatus(next);
    setDeepSeekStatusError("");
    setDeepSeekDialogOpen(false);
  }

  async function handleDisconnectDeepSeek(): Promise<void> {
    const next = await platform.disconnectDeepSeek!();
    setDeepSeekStatus(next);
    setDeepSeekStatusError("");
    if (baseWorker === "deepseek") onBaseWorkerChange("codex");
    if (leaderWorker === "deepseek") onLeaderWorkerChange("codex");
  }

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
  useEffect(() => {
    setLeaderConstitutionDraft(leaderConstitution);
  }, [leaderConstitution]);

  const visibleWorkerAvailability = workerAvailability.filter(
    (worker) => worker.kind !== "deepseek" || deepSeekStatus?.configured
  );
  const installedWorkers = visibleWorkerAvailability.filter((w) => w.available);
  const uninstalledWorkers = visibleWorkerAvailability.filter((w) => !w.available);
  const deepSeekSelectable = deepSeekStatus?.configured === true
    || baseWorker === "deepseek"
    || leaderWorker === "deepseek";
  const selectableModelWorkers = WORKER_KINDS.filter(
    (worker) => worker.kind !== "deepseek" || deepSeekSelectable
  );
  // 全局宪法自动保存：输入停顿 800ms 后落盘，不再需要手动按钮。
  const constitutionInitialized = useRef(false);
  useEffect(() => {
    if (!constitutionInitialized.current) {
      constitutionInitialized.current = true;
      return;
    }
    const timer = setTimeout(() => {
      setConstitutionSaveState("saving");
      Promise.resolve(onSaveConstitutionRef.current(constitutionDraft, leaderConstitutionDraft))
        .then(() => {
          lastSavedDraftRef.current = { worker: constitutionDraft, leader: leaderConstitutionDraft };
          setConstitutionSaveState("saved");
        })
        .catch(() => setConstitutionSaveState("error"));
    }, 800);
    return () => clearTimeout(timer);
  }, [constitutionDraft, leaderConstitutionDraft]);

  // 切走页签时若有未落盘的改动（仍在防抖等待中），立即补一次保存，避免丢失。
  useEffect(() => {
    return () => {
      const lastSaved = lastSavedDraftRef.current;
      if (
        constitutionDraftRef.current !== lastSaved.worker
        || leaderConstitutionDraftRef.current !== lastSaved.leader
      ) {
        void Promise.resolve(
          onSaveConstitutionRef.current(
            constitutionDraftRef.current,
            leaderConstitutionDraftRef.current
          )
        ).catch(() => {});
      }
    };
  }, []);

  const tabs = [
    { id: "general", label: t("常规", "General"), icon: "mingcute:settings-3-line" },
    { id: "models", label: t("模型和工具", "Models & Workflow"), icon: "mingcute:ai-line" },
    ...(capabilities.canInstall
      ? [{ id: "workers", label: t("Worker", "Worker"), icon: "mingcute:plugin-2-line" }]
      : []),
    { id: "constitution", label: t("宪法", "Constitution"), icon: "mingcute:book-2-line" },
    { id: "retry", label: t("执行策略", "Execution"), icon: "mingcute:refresh-2-line" },
    { id: "reminder", label: t("提醒", "Reminder"), icon: "mingcute:notification-line" },
    { id: "debug", label: t("调试", "Debug"), icon: "mingcute:bug-line" },
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
        <div className="settings-layout flex flex-1 min-h-0 gap-[0.9rem]">
          {/* Sidebar Navigation */}
          <aside className="board-sidebar">
            <div className="settings-nav-title flex items-center gap-2 min-w-0 px-1 mb-4">
              <span className="text-[1.35rem] font-medium truncate tracking-tight text-(--color-base-content)">
                {t("设置", "Settings")}
              </span>
            </div>

            <nav className="settings-tabs flex flex-col gap-0.5 select-none">
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
                        <div className="flex flex-wrap items-center justify-between gap-3 group">
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

                        <div className="flex flex-wrap items-center justify-between gap-3 group">
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

                        <div className="flex flex-wrap items-center justify-between gap-3 group">
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
                        <Icon icon="mingcute:translate-line" className="text-sm" />
                        {t("语言与地区", "Language")}
                      </h3>
                      
                      <div className="flex flex-col gap-10 px-1">
                        <div className="flex flex-wrap items-center justify-between gap-3 group">
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

                        <div className="flex flex-wrap items-center justify-between gap-3 group">
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

                {activeTab === "models" && (
                  <>
                    {canManageDeepSeek ? (
                      <section>
                        <h3 className="mb-5 flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-muted/40">
                          <Icon icon="mingcute:link-2-line" className="text-sm" />
                          {t("模型提供方", "Model providers")}
                        </h3>
                        <button
                          type="button"
                          className="group inline-flex items-center gap-3 rounded-2xl bg-base-100 px-4 py-3 text-left shadow-[0_1px_3px_color-mix(in_srgb,var(--color-primary)_12%,transparent),0_1px_2px_color-mix(in_srgb,var(--color-base-content)_8%,transparent)] transition-shadow hover:shadow-[0_2px_8px_color-mix(in_srgb,var(--color-primary)_18%,transparent),0_1px_2px_color-mix(in_srgb,var(--color-base-content)_8%,transparent)]"
                          onClick={() => setDeepSeekDialogOpen(true)}
                        >
                          <WorkerLogo kind="deepseek" size={18} className="flex-none" />
                          <span className="flex max-w-[190px] flex-col gap-0.5">
                            <span className="text-[13px] font-semibold text-base-content/90">DeepSeek Flash</span>
                            <span
                              className="truncate text-[11px] text-muted/50"
                              title={t("使用 Codex CLI，和现有 GPT / Codex 不冲突，配置 KEY 后即可直接使用", "Runs on Codex CLI without conflicting with your existing GPT / Codex — set the KEY and go")}
                            >
                              {t("使用 Codex CLI，和现有 GPT / Codex 不冲突，配置 KEY 后即可直接使用", "Runs on Codex CLI without conflicting with your existing GPT / Codex — set the KEY and go")}
                            </span>
                          </span>
                          <span className={`flex flex-none items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${
                            deepSeekStatus?.configured
                              ? "bg-emerald-500/8 text-emerald-500/85"
                              : "bg-base-300/10 text-muted/55"
                          }`}>
                            {deepSeekStatusLoading ? (
                              <Icon icon="mingcute:loading-3-line" className="animate-spin" />
                            ) : deepSeekStatus?.configured ? (
                              <Icon icon="mingcute:check-circle-line" />
                            ) : (
                              <Icon icon="mingcute:add-circle-line" />
                            )}
                            {deepSeekStatusLoading
                              ? t("检查中", "Checking")
                              : deepSeekStatus?.source === "environment"
                                ? t("环境管理", "Environment")
                                : deepSeekStatus?.configured
                                  ? t("已连接", "Connected")
                                  : deepSeekStatus?.supported === false
                                    ? t("仅限 Local", "Local only")
                                    : t("连接", "Connect")}
                          </span>
                          <Icon icon="mingcute:right-line" className="flex-none text-[15px] text-muted/35 transition-transform group-hover:translate-x-0.5" />
                        </button>
                        {deepSeekStatusError ? (
                          <p className="mb-0 mt-2 px-1 text-[11px] text-red-500/75">{deepSeekStatusError}</p>
                        ) : null}
                      </section>
                    ) : null}

                    <section>
                      <h3 className="text-[10px] font-bold text-muted/40 uppercase tracking-[0.2em] mb-8 px-1 flex items-center gap-2">
                        <Icon icon="mingcute:ai-line" className="text-sm" />
                        {t("Coding 工具", "Worker Model")}
                      </h3>
                      <div className="flex flex-col gap-4 px-1">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[14px] font-bold text-base-content/90">{t("默认执行工具", "Default Executor")}</span>
                          <span className="text-[12px] text-muted/50 leading-relaxed max-w-[420px]">
                            {t("Coding 工具负责干活，新建任务默认交由它执行，可在任务列表中随时调整。", "The worker model does the work. New tasks are assigned to it by default.")}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectableModelWorkers.map((worker) => (
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
                        <Icon icon="mingcute:command-line" className="text-sm" />
                        {t("领导模型", "Leader Model")}
                      </h3>
                      <div className="flex flex-col gap-4 px-1">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[14px] font-bold text-base-content/90">{t("项目经理工具", "Project Manager")}</span>
                          <span className="text-[12px] text-muted/50 leading-relaxed max-w-[420px]">
                            {t("必选项。领导模型是所有工作的发起者：诊断项目、把目标拆成任务树、派单给 Worker、收口验收，整个项目的统领与项目管理都由它出面。", "Required. The leader model initiates all work: it diagnoses the project, breaks goals into task trees, dispatches workers and closes out reviews.")}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectableModelWorkers.map((worker) => (
                            <button
                              key={worker.kind}
                              type="button"
                              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-[12px] font-bold transition-all ${
                                leaderWorker === worker.kind
                                  ? "bg-primary/5 border-primary/30 text-primary shadow-sm ring-1 ring-primary/10"
                                  : "bg-base-300/10 border-transparent text-muted hover:bg-base-300/20 hover:text-base-content"
                              }`}
                              onClick={() => onLeaderWorkerChange(worker.kind)}
                            >
                              <WorkerLogo kind={worker.kind} size={16} />
                              {worker.label}
                            </button>
                          ))}
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
                          const probeKind = worker.kind === "deepseek" ? "codex" : worker.kind;
                          const nativeProbe = installProbes[probeKind as InstallTargetId];
                          const wslProbe = installProbes[`wsl:${probeKind}` as InstallTargetId];
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
                                const probeKind = worker.kind === "deepseek" ? "codex" : worker.kind;
                                const nativeProbe = installProbes[probeKind as InstallTargetId];
                                const wslProbe = installProbes[`wsl:${probeKind}` as InstallTargetId];
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
                          "在此分别为 Leader 与 Worker 定义指令约束。两者在执行前都会阅读并严格遵守各自规则。",
                          "Define constraints for Leader and Worker here. Both will follow their own rules strictly before acting."
                        )}
                      </p>
                    </div>

                    <div className="flex flex-col gap-6 px-1">
                      <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-semibold text-muted/80 flex items-center gap-1.5">
                          <Icon icon="mingcute:compass-line" className="text-sm" />
                          {t("Leader 宪法", "Leader Constitution")}
                        </h4>
                        <p className="text-[11px] text-muted/50 leading-relaxed">
                          {t(
                            "Leader 在归组派单前阅读。用于约束调度行为，例如模型路由、任务拆分、验收规则。",
                            "Leader reads this before dispatching. Use it for routing, task splitting, and acceptance rules."
                          )}
                        </p>
                        <div className="relative group">
                          <textarea
                            className="ui-textarea min-h-[240px] bg-base-300/10 border-base-300/20 focus:bg-base-100/50 transition-all font-mono leading-relaxed p-5 rounded-2xl custom-scrollbar resize-none"
                            style={{ fontSize: "0.75rem" }}
                            value={leaderConstitutionDraft}
                            placeholder={t(
                              "例如你可以输入：\n- 前端任务必须派给 DeepSeek, kimi, GLM 模型\n- 前端不允许使用 GPT / codex 系模型",
                              "Example:\n- Frontend tasks must be assigned to DeepSeek, kimi, GLM models\n- Do not use GPT / codex models for frontend work"
                            )}
                            onChange={(event) => setLeaderConstitutionDraft(event.currentTarget.value)}
                          />
                          <div className="absolute top-4 right-4 flex items-center gap-2">
                            <div className="bg-base-100/80 backdrop-blur px-2 py-1 rounded-md border border-base-300/10 text-[10px] font-mono text-muted tabular-nums shadow-sm">
                              {leaderConstitutionDraft.length.toLocaleString()} <span className="opacity-40">CHARS</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <h4 className="text-xs font-semibold text-muted/80 flex items-center gap-1.5">
                          <Icon icon="mingcute:tool-line" className="text-sm" />
                          {t("Worker 宪法", "Worker Constitution")}
                        </h4>
                        <p className="text-[11px] text-muted/50 leading-relaxed">
                          {t(
                            "所有 Worker 在执行前阅读。用于约束具体实现，例如代码规范、技术栈、交付标准。",
                            "All workers read this before executing. Use it for code style, stack, and delivery standards."
                          )}
                        </p>
                        <div className="relative group">
                          <textarea
                            className="ui-textarea min-h-[240px] bg-base-300/10 border-base-300/20 focus:bg-base-100/50 transition-all font-mono leading-relaxed p-5 rounded-2xl custom-scrollbar resize-none"
                            style={{ fontSize: "0.75rem" }}
                            value={constitutionDraft}
                            placeholder={t(
                              "例如你可以输入：\n- 提交代码之前必须进行类型检查\n- 优先使用单次执行命令，避免交互式操作\n- 严格遵守现有的项目代码结构和命名规范",
                              "Example:\n- Always typecheck before committing code\n- Prefer one-shot commands over interactive ones\n- Follow existing project style and structure"
                            )}
                            onChange={(event) => setConstitutionDraft(event.currentTarget.value)}
                          />
                          <div className="absolute top-4 right-4 flex items-center gap-2">
                            <div className="bg-base-100/80 backdrop-blur px-2 py-1 rounded-md border border-base-300/10 text-[10px] font-mono text-muted tabular-nums shadow-sm">
                              {constitutionDraft.length.toLocaleString()} <span className="opacity-40">CHARS</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end min-h-5">
                        {constitutionSaveState === "saving" ? (
                          <span className="text-[11px] text-muted/70 flex items-center gap-1.5">
                            <Icon icon="mingcute:loading-3-line" className="text-[13px] animate-spin" />
                            {t("自动保存中…", "Auto-saving…")}
                          </span>
                        ) : constitutionSaveState === "saved" ? (
                          <span className="text-[11px] text-(--color-success) flex items-center gap-1.5">
                            <Icon icon="mingcute:check-line" className="text-[13px]" />
                            {t("已自动保存", "Auto-saved")}
                          </span>
                        ) : constitutionSaveState === "error" ? (
                          <span className="text-[11px] text-(--color-error) flex items-center gap-1.5">
                            <Icon icon="mingcute:alert-line" className="text-[13px]" />
                            {t("自动保存失败，请重试", "Auto-save failed, try again")}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted/40">
                            {t("输入后自动保存", "Auto-saves as you type")}
                          </span>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === "retry" && (
                  <section>
                    <div className="flex flex-col gap-1 mb-8 px-1">
                      <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
                        <Icon icon="mingcute:refresh-2-line" className="text-sm" />
                        {t("执行策略", "Execution")}
                      </h3>
                      <p className="text-xs text-muted/60 leading-relaxed mt-1">
                        {t(
                          "控制执行端的并行任务数，以及任务失败后的自动重试行为。",
                          "Control how many tasks a runner executes at once, and how failed tasks are retried."
                        )}
                      </p>
                    </div>

                    <div className="flex flex-col gap-8">
                      <div className="flex flex-col gap-4 px-1">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-semibold">{t("并发执行数", "Concurrency")}</span>
                          <span className="text-[12px] text-muted leading-relaxed">
                            {t(
                              "执行端同时运行的任务上限（1-16），超出部分会排队等待。",
                              "Maximum tasks a runner executes at the same time (1-16); the rest wait in queue."
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                          <input
                            type="range"
                            min={1}
                            max={16}
                            step={1}
                            value={workerConcurrency}
                            onChange={(event) => onWorkerConcurrencyChange(Number(event.currentTarget.value))}
                            className="flex-1 accent-(--color-primary)"
                            aria-label={t("并发执行数", "Concurrency")}
                          />
                          <span className="w-10 h-10 flex items-center justify-center rounded-lg bg-base-300/10 border border-base-300/10 font-mono text-sm font-bold tabular-nums">
                            {workerConcurrency}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-10 px-1">
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
                    </div>
                  </section>
                )}

                {activeTab === "reminder" && (
                  <section>
                    <div className="flex flex-col gap-1 mb-8 px-1">
                      <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
                        <Icon icon="mingcute:notification-line" className="text-sm" />
                        {t("提醒", "Reminder")}
                      </h3>
                      <p className="text-xs text-muted/60 leading-relaxed mt-1">
                        {t(
                          "上传一段不超过 500kB 的音频，任务完成时播放。",
                          "Upload an audio clip (up to 500kB) that plays when a task completes."
                        )}
                      </p>
                    </div>

                    <div className="flex flex-col gap-8">
                      <div className="flex flex-col gap-3 px-1">
                        <span className="text-sm font-semibold">
                          {t("完成提示音", "Completion sound")}
                        </span>
                        {reminderAudioUrl ? (
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-3">
                              <Icon icon="mingcute:music-2-line" className="text-lg text-muted" />
                              <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                                {reminderAudioName}
                              </span>
                              <button
                                type="button"
                                className="ui-btn ui-btn--xs ui-btn--ghost"
                                onClick={onRemoveReminderAudio}
                              >
                                <Icon icon="mingcute:delete-2-line" className="text-[13px]" />
                                {t("删除", "Remove")}
                              </button>
                            </div>
                            <audio
                              controls
                              src={reminderAudioUrl}
                              className="w-full max-w-sm"
                              preload="metadata"
                            />
                          </div>
                        ) : (
                          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-base-300/60 px-4 py-8 text-center transition-colors hover:border-(--color-primary)/40 hover:bg-(--color-primary)/[0.04]">
                            <Icon icon="mingcute:upload-2-line" className="text-xl text-muted" />
                            <span className="text-[13px] text-muted">
                              {t("选择音频文件（≤500kB）", "Choose an audio file (≤500kB)")}
                            </span>
                            <input
                              type="file"
                              accept="audio/*"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0];
                                if (file) onUploadReminderAudio(file);
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 px-1">
                        <span className="text-sm font-semibold">
                          {t("播放方式", "Playback")}
                        </span>
                        <span className="text-[12px] text-muted leading-relaxed -mt-1">
                          {t(
                            "可同时勾选、只勾选一个，或都不勾选。",
                            "You can enable both, one, or none."
                          )}
                        </span>
                        <label className="flex items-center gap-3 cursor-pointer select-none py-0.5">
                          <input
                            type="checkbox"
                            checked={reminderPlayCli}
                            onChange={(event) => onReminderPlayCliChange(event.currentTarget.checked)}
                            className="accent-(--color-primary)"
                          />
                          <span className="text-[13px]">
                            {t("通过 CLI 播放", "Play via CLI")}
                          </span>
                          <span className="text-[12px] text-muted">
                            {t("在终端执行端完成任务时播放", "Played on the CLI runner when a task finishes")}
                          </span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer select-none py-0.5">
                          <input
                            type="checkbox"
                            checked={reminderPlayMaple}
                            onChange={(event) => onReminderPlayMapleChange(event.currentTarget.checked)}
                            className="accent-(--color-primary)"
                          />
                          <span className="text-[13px]">
                            {t("在 Maple 内播放", "Play in Maple")}
                          </span>
                          <span className="text-[12px] text-muted">
                            {t("在应用界面内完成任务时播放", "Played in the Maple dashboard when a task finishes")}
                          </span>
                        </label>
                      </div>
                    </div>
                  </section>
                )}

                {activeTab === "debug" && (
                  <section>
                    <div className="flex flex-col gap-1 mb-8 px-1">
                      <h3 className="text-[12px] font-bold text-muted/60 uppercase tracking-[0.15em] m-0 flex items-center gap-2">
                        <Icon icon="mingcute:bug-line" className="text-sm" />
                        {t("调试", "Debug")}
                      </h3>
                      <p className="text-xs text-muted/60 leading-relaxed mt-1">
                        {t(
                          "在任务表格标签列右侧显示每次执行的调试信息：Token 缓存率、总价与 Session ID 前缀。",
                          "Show per-run debug info next to the tags column: token cache rate, total price and Session ID prefix."
                        )}
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 px-1">
                      <button
                        type="button"
                        className={`ui-btn ui-btn--sm justify-start w-full sm:w-auto ${
                          debugColumnEnabled ? "ui-btn--accent" : "ui-btn--ghost"
                        }`}
                        onClick={() => onDebugColumnChange(!debugColumnEnabled)}
                      >
                        <Icon
                          icon={debugColumnEnabled ? "mingcute:eye-close-line" : "mingcute:eye-2-line"}
                          className="text-[15px]"
                        />
                        {debugColumnEnabled
                          ? t("关闭调试列", "Hide debug column")
                          : t("显示调试列", "Show debug column")}
                      </button>
                      <span className="text-[12px] text-muted leading-relaxed">
                        {debugColumnEnabled
                          ? t("调试列已显示在任务表格中。", "The debug column is now visible in the task table.")
                          : t("调试列当前隐藏。", "The debug column is currently hidden.")}
                      </span>
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

                    <div className="flex flex-wrap items-center justify-between gap-3 group px-1">
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

                    <div className="flex flex-wrap items-center justify-between gap-3 group px-1 mt-6">
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
                    
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 px-1">
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
      <DeepSeekConnectionDialog
        open={deepSeekDialogOpen}
        status={deepSeekStatus}
        statusLoading={deepSeekStatusLoading}
        statusError={deepSeekStatusError}
        uiLanguage={uiLanguage}
        onClose={() => setDeepSeekDialogOpen(false)}
        onReload={reloadDeepSeekStatus}
        onConnect={handleConnectDeepSeek}
        onDisconnect={handleDisconnectDeepSeek}
      />
    </FadeContent>
  );

}

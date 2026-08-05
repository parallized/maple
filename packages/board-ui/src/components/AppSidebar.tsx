import { Icon } from "@iconify/react";
import { Reorder } from "framer-motion";
import { useState } from "react";
import { SplitText } from "./ReactBits";
import type { Project, RunnerSummary, ViewKey } from "../domain";
import type { UiLanguage } from "../lib/constants";
import { useMediaQuery } from "../lib/use-media-query";
import { isTaskInFlight } from "../lib/utils";
import { groupProjectsByRunner } from "../lib/sidebar-groups";
import type { SidebarWorkerItem } from "../lib/worker-sidebar";
import { VersionHistory } from "./VersionHistory";
import { RunnerPlatformIcon } from "./RunnerPlatformIcon";
import { WorkerLogo } from "./WorkerLogo";
import type { ReactNode } from "react";

/** 已被点开过的新项目 id；点开一次后「新」徽章不再出现，跨刷新记住。 */
const SEEN_PROJECTS_KEY = "maple:seen-projects";

function loadSeenProjects(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_PROJECTS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** 侧栏分组是否收起，跨刷新记住；键形如 "worker" / "projects" / "runner:<id>"。 */
const COLLAPSED_SECTIONS_KEY = "maple:sidebar-collapsed-sections";
type CollapsibleSection = string;

function loadCollapsedSections(): Set<CollapsibleSection> {
  try {
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is CollapsibleSection => typeof key === "string" && key.length > 0));
  } catch {
    return new Set();
  }
}

type SidebarSectionHeaderProps = {
  id: string;
  title: string;
  expanded: boolean;
  controls: string;
  toggleTitle: string;
  onToggle: () => void;
};

/** 侧栏分组标题：整行可点击收起/展开，Notion 风格小箭头。 */
function SidebarSectionHeader({
  id,
  title,
  expanded,
  controls,
  toggleTitle,
  onToggle,
}: SidebarSectionHeaderProps) {
  return (
    <button
      type="button"
      id={id}
      aria-expanded={expanded}
      aria-controls={controls}
      title={toggleTitle}
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-base-content)_5%,transparent)_0%,transparent_100%)]"
    >
      <Icon
        icon={expanded ? "mingcute:down-line" : "mingcute:right-line"}
        className="flex-none text-[12px] text-(--color-secondary)/50 transition-transform"
      />
      <span className="text-[12px] font-medium text-(--color-secondary)/80">{title}</span>
    </button>
  );
}

type AppSidebarProps = {
  view: ViewKey;
  projects: Project[];
  runners: RunnerSummary[];
  workers: SidebarWorkerItem[];
  showWorkers: boolean;
  boardProjectId: string | null;
  uiLanguage: UiLanguage;
  isTauri: boolean;
  windowMaximized: boolean;
  onViewChange: (view: ViewKey) => void;
  onProjectSelect: (projectId: string) => void;
  onReorderProjects: (projectIds: string[]) => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  footer?: ReactNode;
  /** 应用版本号，显示在侧栏最底部。 */
  version?: string;
  /** 点按品牌区回主页，仅 Web 端注入；桌面端缺省时保持不可点击。 */
  onBrandClick?: () => void;
};

/** 全局左侧导航栏(Linear 风):Logo / 概览 / 项目列表 / 设置。 */
export function AppSidebar({
  view,
  projects,
  runners,
  workers,
  showWorkers,
  boardProjectId,
  uiLanguage,
  isTauri,
  windowMaximized,
  onViewChange,
  onProjectSelect,
  onReorderProjects,
  onMinimize,
  onToggleMaximize,
  onClose,
  footer,
  version,
  onBrandClick
}: AppSidebarProps) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const [seenProjects, setSeenProjects] = useState<Set<string>>(loadSeenProjects);
  const [collapsedSections, setCollapsedSections] = useState<Set<CollapsibleSection>>(loadCollapsedSections);

  function markProjectSeen(projectId: string) {
    setSeenProjects((prev) => {
      if (prev.has(projectId)) return prev;
      const next = new Set(prev);
      next.add(projectId);
      try {
        localStorage.setItem(SEEN_PROJECTS_KEY, JSON.stringify([...next]));
      } catch {
        // 存储不可用时仅本次会话生效。
      }
      return next;
    });
  }

  function toggleSection(section: CollapsibleSection) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      try {
        localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...next]));
      } catch {
        // 存储不可用时仅本次会话生效。
      }
      return next;
    });
  }

  const isDevMode = import.meta.env.DEV;
  const projectOrder = projects.map((project) => project.id);
  // ≤980px 时侧栏是触屏抽屉：拖拽排序会抢占纵向滚动手势，直接禁用（滚动优先）。
  const reorderEnabled = !useMediaQuery("(max-width: 980px)");
  const workersExpanded = !collapsedSections.has("worker");

  // 各 Worker 当前工作中的任务数(队列中 + 规划中 + 运行中),用于行尾 xN 计数。
  const activeCountByKind = new Map<string, number>();
  for (const project of projects) {
    for (const task of project.tasks) {
      if (isTaskInFlight(task)) {
        activeCountByKind.set(task.workerKind, (activeCountByKind.get(task.workerKind) ?? 0) + 1);
      }
    }
  }
  // 有 Runner 时按主机归属项目：每个 Runner 一个分组，未绑定的项目收进「项目」兜底分组。
  const groupedMode = runners.length > 0;
  const { groups: runnerGroups, unassigned: unassignedProjects } = groupProjectsByRunner(runners, projects);
  const projectsExpanded = !collapsedSections.has("projects");

  const emptyGuide = (
    <p className="m-0 mt-1 flex items-center gap-1.5 px-2 text-[12px] text-(--color-secondary)/60">
      <Icon icon="mingcute:terminal-box-line" className="flex-none text-[13px] opacity-70" />
      {t("在 CLI 按", "Press")}
      <kbd className="flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-(--color-base-content)/15 bg-(--color-base-content)/[0.06] px-1 font-mono text-[11px] font-semibold text-(--color-base-content)/70">E</kbd>
      {t("添加", "in CLI to add")}
    </p>
  );

  const navBtnClass = (active: boolean) =>
    `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] font-medium transition-colors ${
      active
        ? "bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-base-content)_10%,transparent)_0%,transparent_100%)] text-(--color-base-content)"
        : "text-(--color-secondary) hover:bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-base-content)_5%,transparent)_0%,transparent_100%)] hover:text-(--color-base-content)"
    }`;

  /** 单个项目行内容：桌面端包在 Reorder.Item 里，触屏抽屉里包在普通 div 里。 */
  function renderProjectEntry(project: Project) {
    const active = view === "board" && boardProjectId === project.id;
    const confirmCount = project.tasks.filter((task) => task.status === "已完成" && task.needsConfirmation).length;
    const isExecuting = project.tasks.some((task) => isTaskInFlight(task));
    // 新增标记:创建未满 24 小时且还没点开过的项目,在项目名右侧显示「新」徽章。
    const isNew = project.createdAt !== undefined
      && Date.now() - Date.parse(project.createdAt) < 24 * 60 * 60 * 1000
      && !seenProjects.has(project.id);

    return (
      <div className="relative w-full">
        <button
          type="button"
          onClick={() => {
            if (isNew) markProjectSeen(project.id);
            onProjectSelect(project.id);
          }}
          title={project.directory}
          className={`${navBtnClass(active)} pr-7`}
        >
          <Icon icon="mingcute:folder-open-line" className="flex-none text-[15px] opacity-70" />
          <span className="truncate min-w-0">{project.name}</span>
          {/* 进行中指示紧贴项目名右侧;行右缘留给状态角标 */}
          {isExecuting && confirmCount === 0 ? (
            <Icon icon="mingcute:loading-line" className="ml-0.5 flex-none animate-spin text-[12px] text-(--color-primary)" />
          ) : null}
          {isNew ? (
            <span className="ml-0.5 flex-none rounded-[4px] bg-(--color-primary)/15 px-1 text-[9.5px] font-bold leading-[15px] tracking-[0.05em] text-(--color-primary)">
              {t("新", "NEW")}
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <aside
      className="board-sidebar gap-0.5"
      data-tauri-drag-region={isTauri ? "true" : undefined}
    >
      {/* ── Logo ── */}
      {(() => {
        const brand = (
          <>
            <Icon icon="mingcute:quill-pen-ai-fill" className="text-lg text-(--color-primary)" />
            <span className="flex items-center whitespace-nowrap">
              <SplitText text="Maple" className="inline" delay={40} />
              <SplitText text="Code" className="inline logo-code-gradient" delay={40} />
            </span>
            {isDevMode ? <span className="topnav-dev-badge">Dev</span> : null}
          </>
        );
        return onBrandClick ? (
          <button
            type="button"
            aria-label={t("返回主页", "Back to homepage")}
            onClick={onBrandClick}
            className="flex w-full items-center gap-2 px-1.5 pb-2 text-left transition-opacity hover:opacity-80"
          >
            {brand}
          </button>
        ) : (
          <div className="flex items-center gap-2 px-1.5 pb-2">{brand}</div>
        );
      })()}

      {/* ── 概览 ── */}
      <button type="button" className={navBtnClass(view === "overview")} onClick={() => onViewChange("overview")}>
        <Icon icon="mingcute:home-4-line" className="text-[15px] opacity-80" />
        <span>{t("概览", "Overview")}</span>
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {groupedMode ? (
          <>
            {/* ── 按 Runner 归属项目：每个已连接主机一个分组 ── */}
            {runnerGroups.map(({ runner, projects: runnerProjects }) => {
              const runnerKey = `runner:${runner.id}`;
              const runnerExpanded = !collapsedSections.has(runnerKey);
              return (
                <section key={runner.id} aria-label={runner.name} className="mt-5">
                  <button
                    type="button"
                    id={`sidebar-runner-group-${runner.id}-title`}
                    aria-expanded={runnerExpanded}
                    aria-controls={`sidebar-runner-group-${runner.id}-list`}
                    title={`${runner.hostname} · ${runner.platform} · ${runner.state === "online" ? t("在线", "Online") : t("离线", "Offline")}`}
                    onClick={() => toggleSection(runnerKey)}
                    className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-base-content)_5%,transparent)_0%,transparent_100%)]"
                  >
                    <Icon
                      icon={runnerExpanded ? "mingcute:down-line" : "mingcute:right-line"}
                      className="flex-none text-[12px] text-(--color-secondary)/50"
                    />
                    <RunnerPlatformIcon platform={runner.platform} className="text-[15px]" />
                    <span className="truncate min-w-0 text-[13px] font-medium text-(--color-secondary)/90">
                      {runner.name}
                    </span>
                    <span
                      className={`ml-0.5 size-1.5 flex-none rounded-full ${
                        runner.state === "online" ? "bg-(--color-success)" : "bg-(--color-secondary)/40"
                      }`}
                    />
                  </button>
                  <div
                    id={`sidebar-runner-group-${runner.id}-list`}
                    aria-hidden={!runnerExpanded}
                    className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                      runnerExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="mt-1 flex flex-col gap-0.5">
                        {runnerProjects.map((project) => renderProjectEntry(project))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}

            {/* ── 未绑定 Runner 的项目兜底分组 ── */}
            {unassignedProjects.length > 0 ? (
              <section aria-labelledby="sidebar-project-title" className="mt-5">
                <SidebarSectionHeader
                  id="sidebar-project-title"
                  title={t("项目", "Projects")}
                  expanded={projectsExpanded}
                  controls="sidebar-project-list"
                  toggleTitle={projectsExpanded ? t("收起项目", "Collapse projects") : t("展开项目", "Expand projects")}
                  onToggle={() => toggleSection("projects")}
                />
                <div
                  id="sidebar-project-list"
                  aria-hidden={!projectsExpanded}
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                    projectsExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="flex flex-col gap-0.5">
                      {unassignedProjects.map((project) => renderProjectEntry(project))}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {/* ── 空项目引导 ── */}
            {projects.length === 0 ? emptyGuide : null}
          </>
        ) : (
          <>
            {/* ── 项目分组 ── */}
            <div className="mt-3 flex items-center justify-between px-2 pb-0.5">
              <span className="text-[12px] font-medium text-(--color-secondary)/80">{t("项目", "Projects")}</span>
            </div>

            {/* ── 项目列表(桌面可拖拽排序;触屏抽屉里禁用拖拽,滚动优先) ── */}
            {reorderEnabled ? (
            <Reorder.Group as="div" axis="y" values={projectOrder} onReorder={onReorderProjects} className="flex flex-col gap-0.5">
              {projects.map((project) => (
                <Reorder.Item
                  key={project.id}
                  value={project.id}
                  className="flex w-full"
                  style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                  whileDrag={{ scale: 1.02, zIndex: 10, boxShadow: "0 10px 24px rgba(0, 0, 0, 0.16)" }}
                >
                  {renderProjectEntry(project)}
                </Reorder.Item>
              ))}
            </Reorder.Group>
            ) : (
            <div className="flex flex-col gap-0.5">
              {projects.map((project) => (
                <div key={project.id} className="flex w-full">
                  {renderProjectEntry(project)}
                </div>
              ))}
            </div>
            )}

            {/* ── 空项目引导:项目由 CLI 按 E 绑定目录创建 ── */}
            {projects.length === 0 ? emptyGuide : null}
          </>
        )}

        {showWorkers ? (
          <section aria-labelledby="sidebar-worker-title" className="mt-4">
            <SidebarSectionHeader
              id="sidebar-worker-title"
              title="Worker"
              expanded={workersExpanded}
              controls="sidebar-worker-list"
              toggleTitle={workersExpanded ? t("收起 Worker", "Collapse Worker") : t("展开 Worker", "Expand Worker")}
              onToggle={() => toggleSection("worker")}
            />
            <div
              id="sidebar-worker-list"
              aria-hidden={!workersExpanded}
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                workersExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="flex flex-col gap-0.5">
                  {workers.map((worker) => {
                    const hasModel = worker.state === "online" || worker.state === "offline";
                    const text = hasModel && worker.model !== "模型未解析" ? worker.model : worker.label;
                    const activeCount = activeCountByKind.get(worker.kind) ?? 0;
                    return (
                      <div
                        key={worker.uid}
                        className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-[14px] font-medium text-(--color-secondary) transition-colors hover:bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-base-content)_5%,transparent)_0%,transparent_100%)] hover:text-(--color-base-content)"
                        title={worker.title}
                      >
                        <WorkerLogo kind={worker.kind} size={15} className="flex-none self-center opacity-80" />
                        <span className="truncate min-w-0">{text}</span>
                        {activeCount > 0 ? (
                          <span className="shimmer-metal ml-0.5 flex-none text-[12px] font-semibold">
                            x{activeCount}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}

      </div>

      {/* ── 底部:账户 / 窗口控制(设置入口收进账户浮窗) ── */}
      <div className="mt-auto -mx-1 flex flex-col gap-0.5 pb-1 pt-2">
        {footer}
        {isTauri ? (
          <div className="flex items-center gap-1 px-1.5 pt-1">
            <button type="button" className="topnav-wc" onClick={onMinimize} aria-label={t("最小化", "Minimize")}>
              <Icon icon="mingcute:minimize-line" />
            </button>
            <button type="button" className="topnav-wc" onClick={onToggleMaximize} aria-label={t("最大化", "Maximize")}>
              <Icon icon={windowMaximized ? "mingcute:minimize-line" : "mingcute:fullscreen-line"} />
            </button>
            <button
              type="button"
              className="topnav-wc hover:bg-error/10 hover:text-error"
              onClick={onClose}
              aria-label={t("关闭", "Close")}
            >
              <Icon icon="mingcute:close-line" />
            </button>
          </div>
        ) : null}
        {version ? (
          <VersionHistory version={version} uiLanguage={uiLanguage} />
        ) : null}
      </div>
    </aside>
  );
}

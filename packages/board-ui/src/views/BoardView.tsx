import { Icon } from "@iconify/react";
import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InlineTaskInput } from "../components/InlineTaskInput";
import { PopoverMenu, type PopoverMenuItem } from "../components/PopoverMenu";
import { RunningElapsed } from "../components/RunningElapsed";
import { FadeContent } from "../components/ReactBits";
import { useArtifactObjectUrl } from "../components/TaskArtifactGallery";
import { WorkerLogo } from "../components/WorkerLogo";
import { type BoardDisplayType, type DetailMode, type Project, type TagCatalog, type Task, type TaskStatus, type WorkerKind } from "../domain";
import { EXTERNAL_EDITOR_META, WORKER_KINDS, type ExternalEditorApp, type UiLanguage } from "../lib/constants";
import { usePlatform } from "../platform/context";
import { formatTagLabel } from "../lib/tag-label";
import { buildTagBadgeStyle } from "../lib/tag-style";
import { resolveTagIconMeta, resolveTaskIcon } from "../lib/task-icons";
import { statusBadgeClass, statusDotClass } from "../lib/status-colors";
import { useMediaQuery } from "../lib/use-media-query";
import { getLastMentionTime, getTimeLevel, relativeTimeZh } from "../lib/utils";
import type { SidebarWorkerItem } from "../lib/worker-sidebar";

type BoardViewProps = {
  boardProject: Project | null;
  selectedTaskId: string | null;
  editingTaskId: string | null;
  uiLanguage: UiLanguage;
  tagLanguage: UiLanguage;
  detailMode: DetailMode;
  externalEditorApp: ExternalEditorApp;
  displayType: BoardDisplayType;
  leaderWorker: WorkerKind;
  workers: SidebarWorkerItem[];
  /** 点击 Leader 状态条:跳转设置「模型和工具」页签。 */
  onOpenLeaderSettings: () => void;
  onSetDisplayType: (type: BoardDisplayType) => void;
  onAddDraftTask: (projectId: string) => void;
  onCommitTaskTitle: (projectId: string, taskId: string, title: string) => boolean | Promise<boolean>;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onSelectTask: (taskId: string | null) => void;
  onEditTask: (taskId: string | null) => void;
  onUpdateTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => void;
  onUpdateTaskWorker: (projectId: string, taskId: string, kind: WorkerKind) => void;
  onSetDetailMode: (mode: DetailMode) => void;
  onOpenProjectConsole: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
};

const TASK_TITLE_MAX_WIDTH = 340;const DEFAULT_COL_WIDTHS: Record<string, number> = {
  confirm: 20,
  taskIcon: 24,
  task: TASK_TITLE_MAX_WIDTH,
  worker: 40,
  status: 100,
  lastMention: 100,
  tags: 168,
  actions: 40
};

export function BoardView({
  boardProject,
  selectedTaskId,
  editingTaskId,
  uiLanguage,
  tagLanguage,
  detailMode,
  externalEditorApp,
  displayType,
  leaderWorker,
  workers,
  onOpenLeaderSettings,
  onSetDisplayType,
  onAddDraftTask,
  onCommitTaskTitle,
  onDeleteTask,
  onSelectTask,
  onEditTask,
  onUpdateTaskStatus,
  onUpdateTaskWorker,
  onSetDetailMode,
  onOpenProjectConsole,
  onRemoveProject
}: BoardViewProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const resizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  function handleResizeStart(col: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[col] || 100;
    resizeRef.current = { col, startX, startW };

    function onMouseMove(ev: MouseEvent) {
      if (!resizeRef.current) return;
      const diff = ev.clientX - resizeRef.current.startX;
      const proposed = Math.max(30, resizeRef.current.startW + diff);
      const newW = resizeRef.current.col === "task" ? Math.min(TASK_TITLE_MAX_WIDTH, proposed) : proposed;
      setColWidths((prev) => ({ ...prev, [resizeRef.current!.col]: newW }));
    }
    function onMouseUp() {
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function handleResizeDblClick(col: string) {
    setColWidths((prev) => ({ ...prev, [col]: DEFAULT_COL_WIDTHS[col] }));
  }

  const selectedTask = boardProject && selectedTaskId ? boardProject.tasks.find((task) => task.id === selectedTaskId) ?? null : null;
  const isMobile = useMediaQuery("(max-width: 980px)");

  if (!boardProject) {
    return (
      <section className="h-full max-w-full flex flex-col">
        <FadeContent duration={300}>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted">
            <Icon icon="mingcute:folder-open-line" className="text-3xl" />
            <p>{isMobile ? "点底部「菜单」，选择一个项目" : "从侧边栏选择一个项目"}</p>
          </div>
        </FadeContent>
      </section>
    );
  }

  /* ── 存档:项目侧栏「新建任务 / 执行待办」卡片按钮 ──
   * 2026-07 布局改版:项目列表与项目操作迁入 AppSidebar,BoardView 侧栏整体移除。
   * 这两张磨砂玻璃卡片按钮按需求注释保留,之后可能会用。恢复时需同时还原:
   * - import: useCallback; ClickSpark / TiltedCard(../components/ReactBits); WorkerLogo;
   *   PopoverMenu 的 PopoverMenuItem 类型; DetailMode / WorkerKind(../domain);
   *   EXTERNAL_EDITOR_META / WORKER_KINDS / ExternalEditorApp(../lib/constants);
   *   usePlatform(../platform/context)
   * - props: detailMode, externalEditorApp, onAddTask, onCompletePending, onAssignWorkerKind,
   *   onSetDetailMode, onOpenConsole, onRemoveProject
   * - 状态: isExecutingProject = boardProject.tasks.some(队列中 / 进行中)
   * - 常量与组件如下(与卡片配套):

  const NEW_TASK_WATERMARK_ICON = "mingcute:plus-fill";
  const EXECUTE_TASK_WATERMARK_ICON = "mingcute:play-fill";

  function SidebarWatermarkIcon({ icon }: { icon: string }) {
    return (
      <Icon icon={icon} aria-hidden="true" className="sidebar-card-watermark-icon--metallic" />
    );
  }

  <ClickSpark sparkColor="color-mix(in srgb, var(--worker-color, var(--color-primary)) 76%, white 24%)">
    <div className="flex flex-col gap-3">
      <TiltedCard
        className="sidebar-card-btn sidebar-card-btn--glass"
        onClick={() => onAddTask(boardProject.id)}
        scaleOnHover={1}
        flat
      >
        <div className="sidebar-card-btn-content">
          <span className="sidebar-card-btn-title">
            <Icon icon="mingcute:plus-fill" className="mr-1.5 text-base inline-block -translate-y-px text-(--color-primary)" />
            <svg className="glass-text-svg inline-block h-[1.15em] w-auto -translate-y-px" viewBox="0 0 62 18" role="img" aria-label="新建任务">
              <defs>
                <linearGradient id={`glass-text-grad-${boardProject.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" className="glass-text-stop-1" />
                  <stop offset="32%" className="glass-text-stop-2" />
                  <stop offset="62%" className="glass-text-stop-3" />
                  <stop offset="100%" className="glass-text-stop-4" />
                </linearGradient>
              </defs>
              <text x="0" y="14" fill={`url(#glass-text-grad-${boardProject.id})`} fontSize="14" fontWeight="600">新建任务</text>
            </svg>
          </span>
          <span className="sidebar-card-btn-desc">创建一个新的任务条目</span>
        </div>
        <div className="sidebar-card-watermark sidebar-card-watermark--glass">
          <SidebarWatermarkIcon icon={NEW_TASK_WATERMARK_ICON} />
        </div>
      </TiltedCard>

      {capabilities.canExecuteWorkers ? (
      <TiltedCard
        className="sidebar-card-btn sidebar-card-btn--primary"
        onClick={() => onCompletePending(boardProject.id)}
        rotateAmplitude={isExecutingProject ? 0 : 12}
        scaleOnHover={isExecutingProject ? 1 : 1.02}
      >
        <div className="sidebar-card-btn-content">
          <span className="sidebar-card-btn-title text-[14px] flex items-center gap-2">
            <Icon
              icon={isExecutingProject ? "svg-spinners:pulse-ring" : "mingcute:play-fill"}
              className={`mr-1.5 ${isExecutingProject ? "text-base" : "text-[14px]"} inline-block -translate-y-px`}
            />
            <span>{isExecutingProject ? "执行中" : "执行待办"}</span>
          </span>
          <span className="sidebar-card-btn-desc text-[10.5px]">
            {isExecutingProject ? "正在运行项目任务…" : "运行当前项目的所有待办"}
          </span>
        </div>
        <div className="sidebar-card-watermark sidebar-card-watermark--metallic">
          <SidebarWatermarkIcon icon={EXECUTE_TASK_WATERMARK_ICON} />
        </div>
      </TiltedCard>
      ) : null}
    </div>
  </ClickSpark>
  */
  return (
    <section className="h-full max-w-full flex flex-col relative">
      <LeaderStatusBar
        leaderWorker={leaderWorker}
        leader={workers.find((worker) => worker.kind === leaderWorker) ?? null}
        activeCount={boardProject.tasks.filter((task) => task.executionPhase === "planning").length}
        uiLanguage={uiLanguage}
        onOpenSettings={onOpenLeaderSettings}
      />
      <EdgeTabs
        cardRef={cardRef}
        project={boardProject}
        detailMode={detailMode}
        externalEditorApp={externalEditorApp}
        displayType={displayType}
        onSetDisplayType={onSetDisplayType}
        uiLanguage={uiLanguage}
        onAddTask={() => onAddDraftTask(boardProject.id)}
        onSetDetailMode={onSetDetailMode}
        onOpenProjectConsole={onOpenProjectConsole}
        onRemoveProject={onRemoveProject}
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={`main-${boardProject.id}`}
          ref={cardRef}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="board-main"
        >
          {displayType === "gallery" ? (
            <TaskGallery
              tasks={boardProject.tasks}
              projectId={boardProject.id}
              selectedTaskId={selectedTaskId}
              editingTaskId={editingTaskId}
              tagLanguage={tagLanguage}
              tagCatalog={boardProject.tagCatalog}
              onSelectTask={onSelectTask}
              onEditTask={onEditTask}
              onCommitTaskTitle={onCommitTaskTitle}
              onUpdateTaskStatus={onUpdateTaskStatus}
              onUpdateTaskWorker={onUpdateTaskWorker}
            />
          ) : (
            <TaskTable
              tasks={boardProject.tasks}
              projectId={boardProject.id}
              selectedTaskId={selectedTaskId}
              editingTaskId={editingTaskId}
              uiLanguage={uiLanguage}
              tagLanguage={tagLanguage}
              tagCatalog={boardProject.tagCatalog}
              colWidths={colWidths}
              tableRef={tableRef}
              onSelectTask={onSelectTask}
              onEditTask={onEditTask}
              onCommitTaskTitle={onCommitTaskTitle}
              onUpdateTaskStatus={onUpdateTaskStatus}
              onUpdateTaskWorker={onUpdateTaskWorker}
              onDeleteTask={onDeleteTask}
              onResizeStart={handleResizeStart}
              onResizeDblClick={handleResizeDblClick}
            />
          )}

          {boardProject.tasks.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="py-8 text-center"
            >
              <p className="text-muted text-sm">
                {isMobile ? "还没有任务，点击右下角「+」新建一个。" : "还没有任务，点击左侧「+」添加。"}
              </p>
            </motion.div>
          ) : null}

        </motion.div>
      </AnimatePresence>
    </section>
  );
}

/** Leader PM 状态条：位于看板卡片上方、与卡片同一层。
    展示当前 Leader Worker、模型名、在线状态与规划中（PM 派单阶段）的任务数。 */
function LeaderStatusBar({
  leaderWorker,
  leader,
  activeCount,
  uiLanguage,
  onOpenSettings
}: {
  leaderWorker: WorkerKind;
  leader: SidebarWorkerItem | null;
  activeCount: number;
  uiLanguage: UiLanguage;
  onOpenSettings: () => void;
}) {
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const online = leader?.state === "online";
  const model = leader && leader.model !== "模型未解析" ? leader.model : null;

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      title={t("前往「模型和工具」设置", "Open Models & Workflow settings")}
      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 mb-1 text-left text-[12px] leading-none text-(--color-secondary) transition-colors hover:bg-[linear-gradient(to_right,color-mix(in_srgb,var(--color-base-content)_5%,transparent)_0%,transparent_100%)] hover:text-(--color-base-content)"
    >
      <WorkerLogo kind={leaderWorker} size={13} className="opacity-80" />
      <span className="font-semibold text-(--color-base-content)/85">{t("领导", "Leader")}</span>
      {model ? <span className="text-(--color-secondary)/75">{model}</span> : null}
      <span className="ml-auto flex items-center gap-1.5 text-(--color-secondary)/60">
        {activeCount > 0 ? (
          <span className="shimmer-metal text-[11px] font-semibold">x{activeCount}</span>
        ) : null}
        <span className={`size-1.5 rounded-full ${online ? "bg-(--color-success)" : "bg-(--color-secondary)/35"}`} />
        {online ? t("在线", "Online") : leader ? t("离线", "Offline") : t("未接入", "Not connected")}
      </span>
    </button>
  );
}

/** 卡片左缘悬浮页签组：绿色「新建任务」+ 黄色「项目设置」（原侧栏项目行 hover 菜单迁入）。
    锚定 .board-main 卡片本体，列表/画廊两种展示类型下都生效。 */
function EdgeTabs({
  cardRef,
  project,
  detailMode,
  externalEditorApp,
  displayType,
  onSetDisplayType,
  uiLanguage,
  onAddTask,
  onSetDetailMode,
  onOpenProjectConsole,
  onRemoveProject
}: {
  cardRef: React.RefObject<HTMLDivElement | null>;
  project: Project;
  detailMode: DetailMode;
  externalEditorApp: ExternalEditorApp;
  displayType: BoardDisplayType;
  onSetDisplayType: (type: BoardDisplayType) => void;
  uiLanguage: UiLanguage;
  onAddTask: () => void;
  onSetDetailMode: (mode: DetailMode) => void;
  onOpenProjectConsole: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const platform = usePlatform();
  const { capabilities } = platform;
  const t = (zh: string, en: string) => (uiLanguage === "en" ? en : zh);
  const editorMeta = EXTERNAL_EDITOR_META[externalEditorApp];
  // ≤980px：页签锚定布局让位给右下角悬浮按钮。
  const isMobile = useMediaQuery("(max-width: 980px)");

  useEffect(() => {
    const update = () => {
      const card = cardRef.current;
      if (!card) return;
      // 挂载到 .app-frame（卡片外层，无 overflow 裁剪），z 序低于卡片，
      // 出现动画与卡片重叠的阶段被卡片遮住，呈现“从卡片后滑出”。
      const frame = card.closest(".app-frame");
      if (!(frame instanceof HTMLElement)) return;
      const cardRect = card.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      // 列表模式对齐表头高度；画廊模式没有 thead，用固定偏移对齐第一行卡片。
      const header = card.querySelector("thead")?.getBoundingClientRect().height ?? 42;
      setHost(frame);
      setPos({ top: cardRect.top - frameRect.top + header + 6, left: cardRect.left - frameRect.left });
    };
    // 移动端 FAB 不需要等卡片动画，立即确认挂载宿主。
    const card = cardRef.current;
    const frame = card?.closest(".app-frame");
    if (frame instanceof HTMLElement) setHost(frame);
    // 项目切换：先隐藏，等卡片入场动画（delay 0.05s + duration 0.3s = 0.35s 后才完全不透明）
    // 结束再测量定位并滑出，避免半透明卡片期间页签透出来，也避免动画期间位置抖动。
    setPos(null);
    const timer = window.setTimeout(update, 450);
    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", update);
    };
  }, [cardRef, project.id]);

  if (!host) return null;

  const projectMenuItems: PopoverMenuItem[] = [
    { kind: "heading", label: "详情展示" },
    { kind: "item", key: "detail-sidebar", label: "右侧边栏", icon: "mingcute:layout-right-line", checked: detailMode === "sidebar", onSelect: () => onSetDetailMode("sidebar") },
    { kind: "item", key: "detail-modal", label: "弹出式", icon: "mingcute:layout-grid-line", checked: detailMode === "modal", onSelect: () => onSetDetailMode("modal") },
    { kind: "heading", label: "展示类型" },
    { kind: "item", key: "display-list", label: "自优化列表", icon: "mingcute:rows-3-line", checked: displayType === "list", onSelect: () => onSetDisplayType("list") },
    { kind: "item", key: "display-gallery", label: "任务画廊", icon: "mingcute:photo-album-line", checked: displayType === "gallery", onSelect: () => onSetDisplayType("gallery") },
    { kind: "item", key: "display-tree", label: "关系树", icon: "mingcute:tree-line", disabled: true, onSelect: () => undefined },
    ...(capabilities.canOpenPath && project.directory
      ? [
          { kind: "heading", label: "" } as const,
          {
            kind: "item" as const,
            key: "open-folder",
            label: t("在文件夹中打开", "Open in folder"),
            icon: "mingcute:folder-open-line",
            onSelect: () => {
              void platform.openPath(project.directory).catch((error) => console.error("Failed to open folder:", error));
            }
          },
          {
            kind: "item" as const,
            key: "open-editor",
            label: `${t("在", "Open in")} ${editorMeta.label} ${t("中打开", "")}`.trim(),
            icon: editorMeta.icon,
            onSelect: () => {
              void platform.openInEditor(project.directory, externalEditorApp).catch((error) => console.error("Failed to open in editor:", error));
            }
          }
        ]
      : []),
    ...(capabilities.canExecuteWorkers
      ? [
          { kind: "heading", label: "" } as const,
          {
            kind: "item" as const,
            key: "console",
            label: t("控制台", "Console"),
            icon: "mingcute:terminal-box-line",
            onSelect: () => onOpenProjectConsole(project.id)
          }
        ]
      : []),
    { kind: "heading", label: "" },
    { kind: "item", key: "remove-project", label: t("删除项目", "Remove project"), icon: "mingcute:delete-2-line", onSelect: () => onRemoveProject(project.id) }
  ];

  /* 移动端：两个页签改为右下角悬浮按钮（新建在下，项目设置在上），
     菜单由 PopoverMenu 自动翻转向上弹出，避免被屏幕底缘裁掉。 */
  if (isMobile) {
    return createPortal(
      <>
        <button
          type="button"
          className="board-edge-fab"
          onClick={onAddTask}
          title="新建任务"
          aria-label="新建任务"
        >
          <Icon icon="mingcute:add-line" />
        </button>
        <PopoverMenu
          label={t("项目设置", "Project settings")}
          align="right"
          style={{ position: "fixed", right: 14, bottom: 114, zIndex: 45 }}
          triggerNode={
            <span
              className="board-edge-fab board-edge-fab--project"
              style={{ position: "static" }}
              title={t("项目设置", "Project settings")}
            >
              <Icon icon="mingcute:settings-3-line" />
            </span>
          }
          items={projectMenuItems}
        />
      </>,
      host
    );
  }

  if (!pos) return null;

  return createPortal(
    <>
      <button
        type="button"
        className="board-add-tab"
        style={{ top: pos.top, left: pos.left }}
        onClick={onAddTask}
        title="新建任务"
      >
        <span className="board-add-tab-label">新建任务</span>
        <span className="board-add-tab-icon">
          <Icon icon="mingcute:add-line" />
        </span>
      </button>
      <PopoverMenu
        label={t("项目设置", "Project settings")}
        align="left"
        /* 外壳必须 absolute：.app-frame 是 flex+gap 容器，static/relative 的外壳会成为
           在流 flex 子项多吃一个 gap，把卡片右缘挤塌；absolute 后出流不影响布局。
           同时外壳要钉在页签自身位置——PopoverMenu 用外壳的 getBoundingClientRect()
           计算菜单弹点，钉在 frame 原点会让菜单跑到左上角。内部页签 span 相对外壳定位即可。 */
        style={{ position: "absolute", top: pos.top + 36, left: pos.left }}
        triggerNode={
          <span
            className="board-add-tab board-project-tab"
            style={{ top: 0, left: 0 }}
            title={t("项目设置", "Project settings")}
          >
            <span className="board-add-tab-label">{t("项目设置", "Project settings")}</span>
            <span className="board-add-tab-icon">
              <Icon icon="mingcute:settings-3-line" />
            </span>
          </span>
        }
        items={projectMenuItems}
      />
    </>,
    host
  );
}

type TaskTableProps = {
  tasks: Task[];
  projectId: string;
  selectedTaskId: string | null;
  editingTaskId: string | null;
  uiLanguage: UiLanguage;
  tagLanguage: UiLanguage;
  tagCatalog?: TagCatalog | null;
  colWidths: Record<string, number>;
  tableRef: React.Ref<HTMLTableElement>;
  onSelectTask: (taskId: string) => void;
  onEditTask: (taskId: string) => void;
  onCommitTaskTitle: (projectId: string, taskId: string, title: string) => void;
  onUpdateTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => void;
  onUpdateTaskWorker: (projectId: string, taskId: string, kind: WorkerKind) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onResizeStart: (col: string, e: React.MouseEvent) => void;
  onResizeDblClick: (col: string) => void;
};

/** 任务 Worker 指定菜单（表格行 / 画廊卡片共用）。 */
function TaskWorkerMenu({ task, projectId, onUpdateTaskWorker }: {
  task: Task;
  projectId: string;
  onUpdateTaskWorker: (projectId: string, taskId: string, kind: WorkerKind) => void;
}) {
  return (
    <PopoverMenu
      label="Worker Selector"
      triggerNode={
        <button
          type="button"
          className="task-worker-btn flex items-center justify-center w-6 h-6 rounded-md cursor-pointer hover:bg-(--color-base-200) active:scale-95 transition-all"
          title={`Worker: ${task.workerKind}`}
        >
          <WorkerLogo kind={task.workerKind} size={15} />
        </button>
      }
      align="left"
      items={[
        { kind: "heading", label: "指定 Worker" },
        ...WORKER_KINDS.map((w) => ({
          kind: "item" as const,
          key: `worker-${w.kind}`,
          label: w.label,
          iconNode: (
            <div className="flex items-center justify-center w-full h-full">
              <WorkerLogo kind={w.kind} size={14} />
            </div>
          ),
          checked: task.workerKind === w.kind,
          onSelect: () => onUpdateTaskWorker(projectId, task.id, w.kind),
        })),
      ]}
    />
  );
}

/** 任务状态修改菜单（表格行 / 画廊卡片共用）。
    执行阶段只认服务端下发的 executionPhase：queued → 队列中，planning → 规划中（无 spinner/时间），
    running → spinner + 运行时长（不显示文字）；缺失/null 时按旧 status 展示（兼容旧 Server）。 */
function TaskStatusMenu({ task, projectId, onUpdateTaskStatus }: {
  task: Task;
  projectId: string;
  onUpdateTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => void;
}) {
  // 徽标配色跟随「显示状态」：执行阶段优先，与展示文案口径一致。
  const displayStatus =
    task.executionPhase === "queued"
      ? "队列中"
      : task.executionPhase === "planning"
        ? "规划中"
        : task.executionPhase === "running"
          ? "进行中"
          : task.status;
  return (
    <PopoverMenu
      label="Status Selector"
      triggerNode={
        <div
          className={`ui-badge cursor-pointer hover:brightness-95 hover:-translate-y-px active:scale-[0.98] transition-all ${statusBadgeClass(displayStatus)}`}
        >
          {task.executionPhase === "queued" ? (
            "队列中"
          ) : task.executionPhase === "planning" ? (
            "规划中"
          ) : task.executionPhase === "running" ? (
            <>
              <Icon icon="mingcute:loading-3-line" className="text-[12px] animate-spin opacity-80 mr-0.5" />
              <RunningElapsed since={task.startedAt ?? task.updatedAt} />
            </>
          ) : task.status === "进行中" ? (
            <>
              <Icon icon="mingcute:loading-3-line" className="text-[12px] animate-spin opacity-80 mr-0.5" />
              <RunningElapsed since={task.startedAt ?? task.updatedAt} />
            </>
          ) : (
            task.status
          )}
        </div>
      }
      align="left"
      items={[
        { kind: "heading", label: "修改状态" },
        ...(["草稿", "待办", "待返工", "队列中", "进行中", "需要更多信息", "已完成", "已阻塞"] as const).map((s) => ({
          kind: "item" as const,
          key: `status-${s}`,
          label: s,
          iconNode: (
            <div className="flex items-center justify-center w-full h-full">
              <div className={`w-2 h-2 rounded-full ${statusDotClass(s)}`} />
            </div>
          ),
          checked: task.status === s,
          onSelect: () => onUpdateTaskStatus(projectId, task.id, s as TaskStatus),
        })),
      ]}
    />
  );
}

type TaskRowProps = {
  task: Task;
  index: number;
  selectedTaskId: string | null;
  editingTaskId: string | null;
  projectId: string;
  uiLanguage: UiLanguage;
  tagLanguage: UiLanguage;
  tagCatalog?: TagCatalog | null;
  onSelectTask: (taskId: string) => void;
  onEditTask: (taskId: string) => void;
  onCommitTaskTitle: (projectId: string, taskId: string, title: string) => void;
  onUpdateTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => void;
  onUpdateTaskWorker: (projectId: string, taskId: string, kind: WorkerKind) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
};

const TaskRow = React.forwardRef<HTMLTableRowElement, TaskRowProps>(({
  task,
  index,
  selectedTaskId,
  editingTaskId,
  projectId,
  uiLanguage,
  tagLanguage,
  tagCatalog,
  onSelectTask,
  onEditTask,
  onCommitTaskTitle,
  onUpdateTaskStatus,
  onUpdateTaskWorker,
  onDeleteTask,
}: TaskRowProps, ref) => {
  return (
    <motion.tr
      ref={ref}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: "easeOut", delay: Math.min(index * 0.04, 0.8) }}
      className={[
        "task-row",
        task.id === selectedTaskId ? "selected" : "",
        editingTaskId === task.id ? "editing" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (editingTaskId !== task.id) {
          onSelectTask(task.id);
        }
      }}
    >
      <td className="col-confirm">
        {task.status === "已完成" && task.needsConfirmation ? (
          <span className="task-confirm-text" title="待确认">
            <Icon icon="mingcute:question-2-fill" />
          </span>
        ) : task.status === "需要更多信息" ? (
          <span className="task-question-text" title="需要更多信息">
            <Icon icon="mingcute:question-2-fill" />
          </span>
        ) : null}
      </td>
      {/* 特殊状态图标列：暂时整列隐藏，保留实现以便恢复。
      <td className="col-taskIcon">
        {(() => {
          const { icon, isDefault } = resolveTaskIcon(task, tagCatalog);
          // 该列只标识特殊状态的任务；默认图标（无特殊状态）不渲染。
          if (isDefault) return null;
          return (
            <span className="task-icon-pure opacity-90" title={task.title || "(无标题)"}>
              <Icon icon={icon} />
            </span>
          );
        })()}
      </td>
      */}
      <td className="col-task">
        {editingTaskId === task.id ? (
          <InlineTaskInput
            initialValue={task.title}
            onCommit={(title) => onCommitTaskTitle(projectId, task.id, title)}
            autoFocus
          />
        ) : (
          <div className="task-title-cell flex items-center gap-1 min-w-0">
            <span
              className="task-title-text flex-1 cursor-text px-0.5 overflow-hidden text-ellipsis whitespace-nowrap"
              style={{ maxWidth: `${TASK_TITLE_MAX_WIDTH}px` }}
              onClick={(e) => {
                e.stopPropagation();
                onEditTask(task.id);
              }}
            >
              {task.title || "(无标题)"}
            </span>
            <button
              type="button"
              className="task-open-btn ui-btn ui-btn--xs ui-btn--outline shrink-0 gap-1 text-(--color-primary)"
              onClick={(e) => {
                e.stopPropagation();
                onSelectTask(task.id);
              }}
            >
              <Icon icon="mingcute:external-link-line" className="text-xs" />
              打开
            </button>
          </div>
        )}
      </td>
      <td className="col-worker">
        <TaskWorkerMenu task={task} projectId={projectId} onUpdateTaskWorker={onUpdateTaskWorker} />
      </td>
      <td className="col-status">
        <TaskStatusMenu task={task} projectId={projectId} onUpdateTaskStatus={onUpdateTaskStatus} />
      </td>
      <td className="col-lastMention text-[12px]">
        {(() => {
          const timeStr = getLastMentionTime(task);
          const level = getTimeLevel(timeStr);
          return <span className={`time-level-${level}`}>{relativeTimeZh(timeStr)}</span>;
        })()}
      </td>
      <td className="col-tags">
        <div className="tags-inline">
          {task.tags.length === 0 ? <span className="text-xs text-muted">—</span> : null}
          {task.tags.map((tag, index) => {
            const { icon, isDefault } = resolveTagIconMeta(tag, tagCatalog);
            const label = formatTagLabel(tag, tagLanguage, tagCatalog);
            return (
              <span
                key={`${tag}-${index}`}
                className="ui-badge ui-badge--tag"
                style={buildTagBadgeStyle(tag, tagCatalog) as React.CSSProperties}
                title={tag}
              >
                {isDefault ? null : <Icon icon={icon} className="text-[12px] opacity-70 shrink-0" />}
                <span className="flex-1 min-w-0">{label}</span>
              </span>
            );
          })}
        </div>
      </td>
      <td className="col-actions">
        <motion.button
          whileTap={{ scale: 0.85 }}
          type="button"
          className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn row-delete-btn opacity-0 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteTask(projectId, task.id);
          }}
          aria-label="删除任务"
        >
          <Icon icon="mingcute:delete-2-line" />
        </motion.button>
      </td>
    </motion.tr>
  );
});

function TaskTable({
  tasks,
  projectId,
  selectedTaskId,
  editingTaskId,
  uiLanguage,
  tagLanguage,
  tagCatalog,
  colWidths,
  tableRef,
  onSelectTask,
  onEditTask,
  onCommitTaskTitle,
  onUpdateTaskStatus,
  onUpdateTaskWorker,
  onDeleteTask,
  onResizeStart,
  onResizeDblClick
}: TaskTableProps) {
  const INITIAL_ROWS = 80;
  const PAGE_ROWS = 80;

  const [visibleCount, setVisibleCount] = useState(() => Math.min(tasks.length, INITIAL_ROWS));
  const loadMoreRef = useRef<HTMLTableRowElement | null>(null);
  const prevProjectIdRef = useRef(projectId);
  const hasMore = visibleCount < tasks.length;
  const visibleTasks = tasks.slice(0, visibleCount);

  useEffect(() => {
    const projectChanged = prevProjectIdRef.current !== projectId;
    if (projectChanged) {
      prevProjectIdRef.current = projectId;
    }

    setVisibleCount((prev) => {
      const initial = Math.min(tasks.length, INITIAL_ROWS);
      if (projectChanged) return initial;
      if (prev > tasks.length) return tasks.length;
      if (prev === 0 && tasks.length > 0) return initial;
      return prev;
    });
  }, [projectId, tasks.length]);

  useEffect(() => {
    if (!hasMore) return;
    const node = loadMoreRef.current;
    if (!node) return;

    const root = node.closest(".board-main");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((prev) => Math.min(prev + PAGE_ROWS, tasks.length));
      },
      { root, rootMargin: "600px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, tasks.length]);

  return (
    <table ref={tableRef} className="task-table">
      <colgroup>
        <col style={{ width: colWidths.confirm }} />
        {/* taskIcon 列随单元格一并隐藏 */}
        {/* <col style={{ width: colWidths.taskIcon }} /> */}
        <col style={colWidths.task ? { width: colWidths.task } : undefined} />
        <col style={{ width: colWidths.worker }} />
        <col style={{ width: colWidths.status }} />
        <col style={{ width: colWidths.lastMention }} />
        <col style={colWidths.tags > 0 ? { width: colWidths.tags } : undefined} />
        <col style={{ width: colWidths.actions }} />
      </colgroup>
      <thead>
        <tr>
          <th className="col-confirm"></th>
          {[
            // { key: "taskIcon", label: "", icon: "mingcute:ai-line" },
            { key: "task", label: "任务", icon: "mingcute:task-line" },
            { key: "worker", label: "", icon: "mingcute:robot-line" },
            { key: "status", label: "状态", icon: "mingcute:signal-line" },
            { key: "lastMention", label: "上次提及", icon: "mingcute:time-line" },
            { key: "tags", label: "标签", icon: "mingcute:tag-line" },
          ].map((col) => (
            <th key={col.key} className={`col-${col.key}`}>
              <span className={`flex items-center ${col.label ? "justify-start" : "justify-center"} translate-y-[-2.5px] gap-1.5 w-full`}>
                {col.icon ? <Icon icon={col.icon} className="text-[14px] opacity-70" /> : null}
                {col.label ? col.label : null}
              </span>
              {col.key !== "taskIcon" && col.key !== "worker" ? (
                <div
                  className="col-resize-handle"
                  onMouseDown={(e) => onResizeStart(col.key, e)}
                  onDoubleClick={() => onResizeDblClick(col.key)}
                />
              ) : null}
            </th>
          ))}
          <th className="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        <AnimatePresence>
          {visibleTasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              index={index}
              selectedTaskId={selectedTaskId}
              editingTaskId={editingTaskId}
              projectId={projectId}
              uiLanguage={uiLanguage}
              tagLanguage={tagLanguage}
              tagCatalog={tagCatalog}
              onSelectTask={onSelectTask}
              onEditTask={onEditTask}
              onCommitTaskTitle={onCommitTaskTitle}
              onUpdateTaskStatus={onUpdateTaskStatus}
              onUpdateTaskWorker={onUpdateTaskWorker}
              onDeleteTask={onDeleteTask}
            />
          ))}
        </AnimatePresence>
        {hasMore ? (
          <tr ref={loadMoreRef}>
            <td colSpan={7} className="py-3 text-center text-[12px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Icon icon="mingcute:loading-3-line" className="text-[14px] animate-spin opacity-70" />
                加载更多…
              </span>
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}


/** 画廊卡片封面：斜向渐变底，铺满整张卡片；任务有验收截图时覆盖显示第一张，
    由上层的渐变过渡层把图片与文字融为一体。 */
function GalleryCardCover({ taskId }: { taskId: string }) {
  const platform = usePlatform();
  const [artifactId, setArtifactId] = useState<string | null>(null);

  useEffect(() => {
    if (!platform.loadTaskArtifacts) return;
    let stale = false;
    platform
      .loadTaskArtifacts(taskId)
      .then((artifacts) => {
        if (!stale) setArtifactId(artifacts[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [platform, taskId]);

  return (
    <div className="absolute inset-0 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_22%,transparent)_0%,color-mix(in_srgb,var(--color-primary)_8%,transparent)_48%,color-mix(in_srgb,var(--color-base-content)_6%,transparent)_100%)]">
      {artifactId ? <GalleryCoverImage taskId={taskId} artifactId={artifactId} /> : null}
    </div>
  );
}

function GalleryCoverImage({ taskId, artifactId }: { taskId: string; artifactId: string }) {
  const { url } = useArtifactObjectUrl(taskId, artifactId);
  if (!url) return null;
  return <img src={url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />;
}

/** ── 任务画廊：响应式卡片网格，与列表共用同一个 .board-main 容器 ── */

type TaskGalleryProps = {
  tasks: Task[];
  projectId: string;
  selectedTaskId: string | null;
  editingTaskId: string | null;
  tagLanguage: UiLanguage;
  tagCatalog?: TagCatalog | null;
  onSelectTask: (taskId: string) => void;
  onEditTask: (taskId: string) => void;
  onCommitTaskTitle: (projectId: string, taskId: string, title: string) => void;
  onUpdateTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => void;
  onUpdateTaskWorker: (projectId: string, taskId: string, kind: WorkerKind) => void;
};

function TaskGallery({
  tasks,
  projectId,
  selectedTaskId,
  editingTaskId,
  tagLanguage,
  tagCatalog,
  onSelectTask,
  onEditTask,
  onCommitTaskTitle,
  onUpdateTaskStatus,
  onUpdateTaskWorker
}: TaskGalleryProps) {
  return (
    <div className="grid gap-3 pt-[1.2rem] pb-1 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
      {tasks.map((task, index) => {
        const timeStr = getLastMentionTime(task);
        const level = getTimeLevel(timeStr);
        return (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut", delay: Math.min(index * 0.04, 0.8) }}
            className={`gallery-card relative overflow-hidden rounded-[10px] border border-(--color-base-300)/60 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] ${
              task.id === selectedTaskId ? "ring-1 ring-(--color-primary)" : ""
            }`}
            onClick={() => {
              if (editingTaskId !== task.id) {
                onSelectTask(task.id);
              }
            }}
          >
            {/* 封面背景：截图或斜向渐变，铺满卡片 */}
            <GalleryCardCover taskId={task.id} />
            {/* 底部磨砂玻璃：向卡片底部渐显的 backdrop 模糊，把截图柔化成雾面；
                自身带圆角：backdrop-filter 层不受祖先 overflow-hidden 裁切，不圆角会在卡片下两角漏出尖刺 */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] rounded-b-[10px] backdrop-blur-[10px] [mask-image:linear-gradient(to_bottom,transparent,black_55%)]" />
            {/* 渐变过渡层（竖向）：顶部薄压暗（避免截图白边炸光），向下渐变为卡片底色，文字与图片融为一体 */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-base-content)_10%,transparent)_0%,color-mix(in_srgb,var(--color-base-content)_6%,transparent)_26%,color-mix(in_srgb,var(--color-base-100)_78%,transparent)_62%,var(--color-base-100)_88%)]" />
            {/* 噪点质感：Vercel 式细碎颗粒，压在底部雾面上 */}
            <div className="gallery-noise pointer-events-none absolute inset-0 rounded-[10px] [mask-image:linear-gradient(to_bottom,transparent_30%,black_75%)]" />
            {/* 内阴影 vignette：软化截图四边四角的白光 */}
            <div className="pointer-events-none absolute inset-0 rounded-[10px] shadow-[inset_0_0_28px_color-mix(in_srgb,var(--color-base-content)_12%,transparent)]" />

            {/* 内容区：顶行 + 标题 + 标签 + 时间，浮在渐变之上 */}
            <div className="relative flex flex-col gap-2.5 p-3 pt-[104px]">
              {/* 顶行：状态 + 特殊状态标记 / Worker（画廊不显示删除按钮，避免挤压布局） */}
              <div className="flex items-center gap-1.5">
              <TaskStatusMenu task={task} projectId={projectId} onUpdateTaskStatus={onUpdateTaskStatus} />
              {task.status === "已完成" && task.needsConfirmation ? (
                <span className="task-confirm-text" title="待确认">
                  <Icon icon="mingcute:question-2-fill" />
                </span>
              ) : task.status === "需要更多信息" ? (
                <span className="task-question-text" title="需要更多信息">
                  <Icon icon="mingcute:question-2-fill" />
                </span>
              ) : null}
              <span className="ml-auto" />
              <TaskWorkerMenu task={task} projectId={projectId} onUpdateTaskWorker={onUpdateTaskWorker} />
            </div>

            {/* 标题 */}
            {editingTaskId === task.id ? (
              <InlineTaskInput
                initialValue={task.title}
                onCommit={(title) => onCommitTaskTitle(projectId, task.id, title)}
                autoFocus
              />
            ) : (
              <span
                className="text-[13.5px] font-medium leading-snug line-clamp-2 cursor-text break-words"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditTask(task.id);
                }}
              >
                {task.title || "(无标题)"}
              </span>
            )}

            {/* 标签 */}
            {task.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {task.tags.map((tag, tagIndex) => {
                  const { icon, isDefault } = resolveTagIconMeta(tag, tagCatalog);
                  const label = formatTagLabel(tag, tagLanguage, tagCatalog);
                  return (
                    <span
                      key={`${tag}-${tagIndex}`}
                      className="ui-badge ui-badge--tag"
                      style={buildTagBadgeStyle(tag, tagCatalog) as React.CSSProperties}
                      title={tag}
                    >
                      {isDefault ? null : <Icon icon={icon} className="text-[12px] opacity-70 shrink-0" />}
                      <span className="flex-1 min-w-0">{label}</span>
                    </span>
                  );
                })}
              </div>
            ) : null}

              {/* 底行：上次提及 */}
              <span className={`text-[11px] time-level-${level}`}>{relativeTimeZh(timeStr)}</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@iconify/react";
import { FadeContent, TiltedCard } from "../components/ReactBits";
import { InlineTaskInput } from "../components/InlineTaskInput";
import { PopoverMenu, type PopoverMenuItem } from "../components/PopoverMenu";
import { WorkerLogo } from "../components/WorkerLogo";
import { WORKER_KINDS, type ExternalEditorApp, type UiLanguage } from "../lib/constants";
import { resolveTagIconMeta, resolveTaskIcon } from "../lib/task-icons";
import { formatTagLabel } from "../lib/tag-label";
import { buildTagBadgeStyle } from "../lib/tag-style";
import { relativeTimeZh, getLastMentionTime, getTimeLevel } from "../lib/utils";
import { type DetailMode, type Project, type TagCatalog, type Task, type WorkerKind } from "../domain";
import React, { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type BoardViewProps = {
  boardProject: Project | null;
  selectedTaskId: string | null;
  editingTaskId: string | null;
  detailMode: DetailMode;
  releaseReport: string;
  externalEditorApp: ExternalEditorApp;
  uiLanguage: UiLanguage;
  tagLanguage: UiLanguage;
  onAddTask: (projectId: string) => void;
  onCommitTaskTitle: (projectId: string, taskId: string, title: string) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onSelectTask: (taskId: string | null) => void;
  onEditTask: (taskId: string | null) => void;
  onCompletePending: (projectId: string) => void;
  onCreateReleaseDraft: (projectId: string) => void;
  onAssignWorkerKind: (projectId: string, kind: WorkerKind) => void;
  onSetDetailMode: (mode: DetailMode) => void;
  onOpenConsole: () => void;
  onRemoveProject: (projectId: string) => void;
};

const TASK_TITLE_MAX_WIDTH = 340;
const DEFAULT_COL_WIDTHS: Record<string, number> = {
  confirm: 28,
  taskIcon: 48,
  task: TASK_TITLE_MAX_WIDTH,
  status: 100,
  lastMention: 100,
  tags: 0,
  actions: 40
};

export function BoardView({
  boardProject,
  selectedTaskId,
  editingTaskId,
  detailMode,
  releaseReport,
  externalEditorApp,
  uiLanguage,
  tagLanguage,
  onAddTask,
  onCommitTaskTitle,
  onDeleteTask,
  onSelectTask,
  onEditTask,
  onCompletePending,
  onCreateReleaseDraft,
  onAssignWorkerKind,
  onSetDetailMode,
  onOpenConsole,
  onRemoveProject
}: BoardViewProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const resizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const isExecutingProject = Boolean(
    boardProject?.tasks.some((task) => task.status === "队列中" || task.status === "进行中")
  );

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

  const handleOpenFolder = useCallback(async () => {
    if (!boardProject?.directory) return;
    try {
      await invoke("open_path", { path: boardProject.directory });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, [boardProject?.directory]);

  const handleOpenInEditor = useCallback(async () => {
    if (!boardProject?.directory) return;
    try {
      await invoke("open_in_editor", { path: boardProject.directory, app: externalEditorApp });
    } catch (err) {
      console.error("Failed to open in editor:", err);
    }
  }, [boardProject?.directory, externalEditorApp]);

  const selectedTask = boardProject && selectedTaskId ? boardProject.tasks.find((task) => task.id === selectedTaskId) ?? null : null;

  if (!boardProject) {
    return (
      <section className="h-full max-w-full flex flex-col">
        <FadeContent duration={300}>
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted">
            <Icon icon="mingcute:folder-open-line" className="text-3xl" />
            <p>从侧边栏选择一个项目</p>
          </div>
        </FadeContent>
      </section>
    );
  }

  return (
    <section className="h-full max-w-full flex flex-col">
      <div className="board-layout">
        <AnimatePresence mode="wait">
        <motion.aside 
          key={`sidebar-${boardProject.id}`}
          initial="hidden"
          animate="visible"
          exit={{ opacity: 0, x: -10, transition: { duration: 0.15 } }}
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.05, delayChildren: 0.05 }
            }
          }}
          className="board-sidebar"
        >
          <motion.div 
            variants={{
              hidden: { opacity: 0, x: -10 },
              visible: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 25 } }
            }}
            className="flex items-center justify-between gap-1 mb-2"
          >
            <div className="flex items-center gap-2 min-w-0 px-1">
              <span className="text-[1.35rem] font-medium truncate tracking-tight text-primary">{boardProject.name}</span>
            </div>
            <PopoverMenu
              label="Project Actions"
              icon="mingcute:more-2-line"
              align="right"
              style={{ "--worker-color": WORKER_KINDS.find(w => w.kind === boardProject.workerKind)?.color ?? "var(--color-primary)" } as React.CSSProperties}
              items={[
                { kind: "item", key: "release-draft", label: "版本草稿", icon: "mingcute:send-plane-line", onSelect: () => onCreateReleaseDraft(boardProject.id) },
                { kind: "heading", label: "Worker" },
                ...WORKER_KINDS.map(({ kind, label }) => ({
                  kind: "item" as const,
                  key: `worker-${kind}`,
                  label,
                  icon: "mingcute:ai-line",
                  checked: boardProject.workerKind === kind,
                  onSelect: () => onAssignWorkerKind(boardProject.id, kind)
                })),
                { kind: "heading", label: "详情展示" },
                { kind: "item", key: "detail-sidebar", label: "右侧边栏", icon: "mingcute:layout-right-line", checked: detailMode === "sidebar", onSelect: () => onSetDetailMode("sidebar") },
                { kind: "item", key: "detail-modal", label: "弹出式", icon: "mingcute:layout-grid-line", checked: detailMode === "modal", onSelect: () => onSetDetailMode("modal") },
                { kind: "heading", label: "" },
                { kind: "item", key: "remove-project", label: "删除项目", icon: "mingcute:delete-2-line", onSelect: () => onRemoveProject(boardProject.id) }
              ] satisfies PopoverMenuItem[]}
            />
          </motion.div>

          <motion.div 
            variants={{
              hidden: { opacity: 0, x: -10 },
              visible: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 25 } }
            }}
            className="flex flex-col gap-2 mt-2 px-1 mb-8"
          >
            <div className="flex items-center gap-2 text-[12.5px] text-primary/90 font-medium">
              {boardProject.workerKind ? (
                <WorkerLogo kind={boardProject.workerKind} size={14} />
              ) : (
                <Icon icon="mingcute:ai-line" className="opacity-60" />
              )}
              <span className="truncate">
                Worker {WORKER_KINDS.find((w) => w.kind === boardProject.workerKind)?.label ?? "未分配"}
              </span>
            </div>
            <div 
              className="flex items-center gap-2 text-[11.5px] text-muted"
              style={{ "--worker-color": WORKER_KINDS.find(w => w.kind === boardProject.workerKind)?.color ?? "var(--color-primary)" } as React.CSSProperties}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-(--worker-color) opacity-40" />
              <span className="opacity-80">Version {boardProject.version}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-(--color-base-content) opacity-20" />
              <span className="truncate opacity-60" title={boardProject.directory}>
                {boardProject.directory}
              </span>
            </div>
          </motion.div>

          <motion.div 
            variants={{
              hidden: { opacity: 0, x: -10 },
              visible: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 25 } }
            }}
            className="board-sidebar-nav"
          >
            <TiltedCard 
              className="sidebar-card-btn sidebar-card-btn--primary" 
              onClick={() => onAddTask(boardProject.id)}
              style={{ "--worker-color": WORKER_KINDS.find(w => w.kind === boardProject.workerKind)?.color ?? "var(--color-primary)" } as React.CSSProperties}
            >
              <div className="sidebar-card-btn-content">
                <span className="sidebar-card-btn-title">
                  <Icon icon="mingcute:plus-fill" className="mr-1.5 text-base inline-block -translate-y-px" />
                  新建任务
                </span>
                <span className="sidebar-card-btn-desc">创建一个新的任务条目</span>
              </div>
              <div className="sidebar-card-watermark">
                <Icon icon="mingcute:quill-pen-ai-fill" />
              </div>
            </TiltedCard>

            <TiltedCard 
              className={`sidebar-card-btn sidebar-card-btn--primary ${isExecutingProject ? "sidebar-card-btn--disabled" : ""}`}
              onClick={isExecutingProject ? undefined : () => onCompletePending(boardProject.id)}
              rotateAmplitude={isExecutingProject ? 0 : 12}
              scaleOnHover={isExecutingProject ? 1 : 1.02}
              style={{ "--worker-color": WORKER_KINDS.find(w => w.kind === boardProject.workerKind)?.color ?? "var(--color-primary)" } as React.CSSProperties}
            >
              <div className="sidebar-card-btn-content">
                <span className="sidebar-card-btn-title">
                  <Icon 
                    icon={isExecutingProject ? "svg-spinners:pulse-ring" : "mingcute:play-fill"} 
                    className={`mr-1.5 ${isExecutingProject ? "text-lg" : "text-base"} inline-block -translate-y-px`} 
                  />
                  {isExecutingProject ? "执行中" : "执行待办"}
                </span>
                <span className="sidebar-card-btn-desc">
                  {isExecutingProject ? "正在运行当前项目的待办任务" : "运行当前项目的所有待办"}
                </span>
              </div>
              <div className="sidebar-card-watermark">
                <Icon icon="mingcute:cursor-3-fill" />
              </div>
            </TiltedCard>

            <div className="mt-4 pt-4 border-t border-(--color-base-300)/20 flex flex-col gap-2">
              <motion.button 
                whileTap={{ scale: 0.96 }} 
                type="button" 
                className="ui-btn ui-btn--sm w-full gap-2 justify-start px-3" 
                onClick={handleOpenFolder}
              >
                <Icon icon="mingcute:folder-open-line" className="text-base opacity-70" />
                在文件夹中打开
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                className="ui-btn ui-btn--sm w-full gap-2 justify-start px-3"
                onClick={handleOpenInEditor}
              >
                <Icon icon="mingcute:code-line" className="text-base opacity-70" />
                在编辑器打开
              </motion.button>
              <motion.button 
                whileTap={{ scale: 0.96 }} 
                type="button" 
                className="ui-btn ui-btn--sm w-full gap-2 justify-start px-3" 
                onClick={onOpenConsole}
              >
                <Icon icon="mingcute:terminal-box-line" className="text-base opacity-70" />
                控制台
              </motion.button>
            </div>
          </motion.div>
        </motion.aside>
        </AnimatePresence>

        <AnimatePresence mode="wait">
        <motion.div 
          key={`main-${boardProject.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10, transition: { duration: 0.15 } }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="board-main"
        >
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
            onDeleteTask={onDeleteTask}
            onResizeStart={handleResizeStart}
            onResizeDblClick={handleResizeDblClick}
          />

          {boardProject.tasks.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ delay: 0.2 }}
              className="py-8 text-center"
            >
              <p className="text-muted text-sm">还没有任务，点击左侧「新建」添加。</p>
            </motion.div>
          ) : null}

          {releaseReport ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }} 
              animate={{ opacity: 1, scale: 1 }} 
              className="ui-card p-4 mt-3"
            >
              <h3 className="font-semibold m-0">版本草稿</h3>
              <textarea className="ui-textarea w-full mt-2" value={releaseReport} readOnly rows={14} />
            </motion.div>
          ) : null}
        </motion.div>
        </AnimatePresence>
      </div>
    </section>
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
  onDeleteTask: (projectId: string, taskId: string) => void;
  onResizeStart: (col: string, e: React.MouseEvent) => void;
  onResizeDblClick: (col: string) => void;
};

const trVariants = {
  hidden: { opacity: 0 },
  visible: (index: number) => ({
    opacity: 1,
    transition: { delay: index * 0.03, duration: 0.18, ease: "easeOut" as const }
  }),
  exit: { opacity: 0, transition: { duration: 0.12 } }
};

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
	onDeleteTask
}, ref) => {
  return (
    <motion.tr
      ref={ref}
      custom={index}
      variants={trVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{ "--row-enter-delay": `${index * 30}ms` } as React.CSSProperties}
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
      <td className="col-confirm text-center">
        {task.status === "已完成" && task.needsConfirmation ? (
          <div className="task-confirm-badge" title="待确认" />
        ) : null}
      </td>
      <td className="col-taskIcon text-center">
        {(() => {
          const { icon, isDefault } = resolveTaskIcon(task);
          return (
            <span
              className={`task-icon-pill ${isDefault ? "opacity-70" : "opacity-100"}`}
              title={task.title || "(无标题)"}
            >
              <Icon icon={icon} className="text-base" />
            </span>
          );
        })()}
      </td>
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
      <td className="col-status">
        <span
          className={`ui-badge ${
            task.status === "已完成"
              ? "ui-badge--success"
              : task.status === "已阻塞"
                ? "ui-badge--error"
                : task.status === "进行中"
                  ? "ui-badge--solid"
                    : task.status === "需要更多信息"
                      ? "ui-badge--warning"
                    : task.status === "队列中" || task.status === "待办" || task.status === "待返工"
                      ? "ui-badge--neutral"
                      : ""
          }`}
        >
          {task.status}
        </span>
      </td>
      <td className="col-lastMention text-[11px]">
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
                {isDefault ? null : <Icon icon={icon} className="text-[11px] opacity-70 shrink-0" />}
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
  onDeleteTask,
  onResizeStart,
  onResizeDblClick
}: TaskTableProps) {
  return (
    <table ref={tableRef} className="task-table">
      <colgroup>
        <col style={{ width: colWidths.confirm }} />
        <col style={{ width: colWidths.taskIcon }} />
        <col style={colWidths.task ? { width: colWidths.task } : undefined} />
        <col style={{ width: colWidths.status }} />
        <col style={{ width: colWidths.lastMention }} />
        <col style={colWidths.tags > 0 ? { width: colWidths.tags } : undefined} />
        <col style={{ width: colWidths.actions }} />
      </colgroup>
      <thead>
        <tr>
          <th className="col-confirm"></th>
          {[
            { key: "taskIcon", label: "", icon: "mingcute:ai-line" },
            { key: "task", label: "任务", icon: "mingcute:task-line" },
            { key: "status", label: "状态", icon: "mingcute:signal-line" },
            { key: "lastMention", label: "上次提及", icon: "mingcute:time-line" },
            { key: "tags", label: "标签", icon: "mingcute:tag-line" },
          ].map((col) => (
            <th key={col.key} className={`col-${col.key}`}>
              <span className="inline-flex items-center gap-1">
                <Icon icon={col.icon} className={`opacity-60 ${col.key === "taskIcon" ? "text-sm" : "text-xs"}`} />
                {col.label ? col.label : null}
              </span>
              {col.key !== "taskIcon" ? (
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
      <motion.tbody
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1
          }
        }}
      >
        <AnimatePresence>
          {tasks.map((task, index) => (
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
              onDeleteTask={onDeleteTask}
            />
          ))}
        </AnimatePresence>
      </motion.tbody>
    </table>
  );
}

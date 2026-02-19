import { Icon } from "@iconify/react";
import { FadeContent } from "../components/ReactBits";
import { InlineTaskInput } from "../components/InlineTaskInput";
import { PopoverMenu, type PopoverMenuItem } from "../components/PopoverMenu";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { WORKER_KINDS } from "../lib/constants";
import { relativeTimeZh, getLastMentionTime } from "../lib/utils";
import type { DetailMode, Project, Task, WorkerKind } from "../domain";
import type React from "react";
import { useRef, useState } from "react";

type BoardViewProps = {
  boardProject: Project | null;
  selectedTaskId: string | null;
  editingTaskId: string | null;
  detailMode: DetailMode;
  releaseReport: string;
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

const DEFAULT_COL_WIDTHS: Record<string, number> = { task: 0, status: 100, lastMention: 100, tags: 180, actions: 40 };

export function BoardView({
  boardProject,
  selectedTaskId,
  editingTaskId,
  detailMode,
  releaseReport,
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

  function handleResizeStart(col: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[col] || 100;
    resizeRef.current = { col, startX, startW };

    function onMouseMove(ev: MouseEvent) {
      if (!resizeRef.current) return;
      const diff = ev.clientX - resizeRef.current.startX;
      const newW = Math.max(30, resizeRef.current.startW + diff);
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
        <aside className="board-sidebar">
          <div className="flex items-center justify-between gap-1 mb-2">
            <div className="flex items-center gap-2 min-w-0 px-1">
              <span className="text-2xl font-bold truncate tracking-tight text-primary">{boardProject.name}</span>
            </div>
            <PopoverMenu
              label=""
              icon="mingcute:more-1-line"
              align="left"
              items={
                [
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
                ] satisfies PopoverMenuItem[]
              }
            />
          </div>

          <div className="flex flex-col gap-2.5 mt-2 px-1 mb-8">
            <div className="flex items-center gap-2 text-[13px] text-muted font-medium">
              <span className="w-2 h-2 rounded-full bg-(--color-primary) opacity-40" />
              <span>Version {boardProject.version}</span>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <span className="w-2 h-2 rounded-full bg-(--color-base-content) opacity-20" />
              <span className="truncate opacity-80" title={boardProject.directory}>
                {boardProject.directory}
              </span>
            </div>
          </div>

          <div className="board-sidebar-nav">
            <button type="button" className="ui-btn ui-btn--sm ui-btn--accent gap-2" onClick={() => onAddTask(boardProject.id)}>
              <Icon icon="mingcute:add-line" className="text-base" />
              新建任务
            </button>
            <button type="button" className="ui-btn ui-btn--sm gap-2" onClick={() => onCompletePending(boardProject.id)}>
              <Icon icon="mingcute:check-circle-line" className="text-base" />
              执行待办
            </button>
            <button type="button" className="ui-btn ui-btn--sm gap-2" onClick={onOpenConsole}>
              <Icon icon="mingcute:terminal-box-line" className="text-base" />
              控制台
            </button>
          </div>
        </aside>

        <div className="board-main">
          <TaskTable
            tasks={boardProject.tasks}
            projectId={boardProject.id}
            selectedTaskId={selectedTaskId}
            editingTaskId={editingTaskId}
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
            <div className="py-8 text-center">
              <p className="text-muted text-sm">还没有任务，点击左侧「新建」添加。</p>
            </div>
          ) : null}

          {releaseReport ? (
            <div className="ui-card p-4 mt-3">
              <h3 className="font-semibold m-0">版本草稿</h3>
              <textarea className="ui-textarea w-full mt-2" value={releaseReport} readOnly rows={14} />
            </div>
          ) : null}
        </div>
      </div>

      {selectedTask && detailMode === "sidebar" ? (
        <div className="detail-sidebar">
          <button
            type="button"
            className="detail-sidebar-close ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn"
            onClick={() => onSelectTask(null)}
            aria-label="关闭侧边栏"
          >
            <Icon icon="mingcute:close-line" />
          </button>
          <TaskDetailPanel
            task={selectedTask}
            onClose={undefined}
            onDelete={() => onDeleteTask(boardProject.id, selectedTask.id)}
          />
        </div>
      ) : null}

      {detailMode === "modal" && selectedTask ? (
        <div className="ui-modal" role="dialog" aria-modal="true" aria-label="任务详情">
          <div className="ui-modal-backdrop" onClick={() => onSelectTask(null)} />
          <div className="ui-modal-panel">
            <div className="ui-modal-body">
              <TaskDetailPanel
                task={selectedTask}
                onClose={() => onSelectTask(null)}
                onDelete={() => onDeleteTask(boardProject.id, selectedTask.id)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

type TaskTableProps = {
  tasks: Task[];
  projectId: string;
  selectedTaskId: string | null;
  editingTaskId: string | null;
  colWidths: Record<string, number>;
  tableRef: React.Ref<HTMLTableElement>;
  onSelectTask: (taskId: string) => void;
  onEditTask: (taskId: string) => void;
  onCommitTaskTitle: (projectId: string, taskId: string, title: string) => void;
  onDeleteTask: (projectId: string, taskId: string) => void;
  onResizeStart: (col: string, e: React.MouseEvent) => void;
  onResizeDblClick: (col: string) => void;
};

function TaskTable({
  tasks,
  projectId,
  selectedTaskId,
  editingTaskId,
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
        <col style={colWidths.task ? { width: colWidths.task } : undefined} />
        <col style={{ width: colWidths.status }} />
        <col style={{ width: colWidths.lastMention }} />
        <col style={{ width: colWidths.tags }} />
        <col style={{ width: colWidths.actions }} />
      </colgroup>
      <thead>
        <tr>
          {[
            { key: "task", label: "任务", icon: "mingcute:task-line" },
            { key: "status", label: "状态", icon: "mingcute:signal-line" },
            { key: "lastMention", label: "上次提及", icon: "mingcute:time-line" },
            { key: "tags", label: "标签", icon: "mingcute:tag-line" },
          ].map((col) => (
            <th key={col.key} className={`col-${col.key}`}>
              <span className="inline-flex items-center gap-1">
                <Icon icon={col.icon} className="text-xs opacity-60" />
                {col.label}
              </span>
              <div
                className="col-resize-handle"
                onMouseDown={(e) => onResizeStart(col.key, e)}
                onDoubleClick={() => onResizeDblClick(col.key)}
              />
            </th>
          ))}
          <th className="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr
            key={task.id}
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
            <td className="col-task">
              {editingTaskId === task.id ? (
                <InlineTaskInput
                  initialValue={task.title}
                  onCommit={(title) => onCommitTaskTitle(projectId, task.id, title)}
                />
              ) : (
                <div className="task-title-cell flex items-center gap-1 min-w-0">
                  <span
                    className="task-title-text flex-1 cursor-text px-0.5 overflow-hidden text-ellipsis whitespace-nowrap"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditTask(task.id);
                    }}
                  >
                    {task.title || "(无标题)"}
                  </span>
                  <button
                    type="button"
                    className="task-open-btn ui-btn ui-btn--xs ui-btn--outline shrink-0 gap-1 text-[color:var(--color-primary)]"
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
              <span className={`ui-badge ${task.status === "已完成" ? "ui-badge--success" : task.status === "已阻塞" ? "ui-badge--error" : task.status === "进行中" ? "ui-badge--solid" : task.status === "需要更多信息" ? "ui-badge--warning" : ""}`}>
                <span className={`status-dot status-${task.status === "已完成" ? "done" : task.status === "已阻塞" ? "blocked" : task.status === "进行中" ? "active" : task.status === "需要更多信息" ? "info" : "pending"}`} />
                {task.status}
              </span>
            </td>
            <td className="col-lastMention text-muted">{relativeTimeZh(getLastMentionTime(task))}</td>
            <td className="col-tags">
              <div className="tags-inline">
                {task.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="ui-badge mr-1">
                    {tag}
                  </span>
                ))}
                {task.tags.length > 3 ? (
                  <span className="ui-badge opacity-60">+{task.tags.length - 3}</span>
                ) : null}
              </div>
            </td>
            <td className="col-actions">
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--ghost ui-icon-btn row-delete-btn opacity-0 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTask(projectId, task.id);
                }}
                aria-label="删除任务"
              >
                <Icon icon="mingcute:delete-2-line" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

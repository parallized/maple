import { Icon } from "@iconify/react";
import type { Task } from "../domain";

type TaskDetailPanelProps = {
  task: Task;
  onClose?: () => void;
  onDelete?: () => void;
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function joinTags(tags: string[]): string {
  return tags.map((tag) => tag.trim()).filter(Boolean).join("、");
}

export function TaskDetailPanel({ task, onClose, onDelete }: TaskDetailPanelProps) {
  return (
    <section className="grid gap-2">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h3 className="m-0 font-semibold">{task.title}</h3>
          <span className="ui-badge">提及 {task.reports.length}</span>
        </div>
        <div className="flex gap-1 shrink-0">
          {onDelete ? (
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost ui-btn--danger ui-icon-btn"
              onClick={onDelete}
              aria-label="删除任务"
            >
              <Icon icon="mingcute:delete-2-line" />
            </button>
          ) : null}
          {onClose ? (
            <button type="button" className="ui-btn ui-btn--sm ui-btn--ghost ui-icon-btn" onClick={onClose} aria-label="关闭详情">
              <Icon icon="mingcute:close-line" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="task-properties ui-card p-3">
        <div className="task-prop flex justify-between items-center gap-3">
          <span className="text-muted text-sm whitespace-nowrap">状态</span>
          <span className="ui-badge ui-badge--solid">{task.status}</span>
        </div>
        <div className="task-prop flex justify-between items-center gap-3">
          <span className="text-muted text-sm whitespace-nowrap">版本</span>
          <span className="ui-badge">{task.version}</span>
        </div>
        <div className="task-prop task-prop-wide flex justify-between items-center gap-3">
          <span className="text-muted text-sm whitespace-nowrap">标签</span>
          <span className="text-sm text-right">{joinTags(task.tags) || "无"}</span>
        </div>
        <div className="task-prop flex justify-between items-center gap-3">
          <span className="text-muted text-sm whitespace-nowrap">创建时间</span>
          <span className="text-sm">{formatDateTime(task.createdAt)}</span>
        </div>
        <div className="task-prop flex justify-between items-center gap-3">
          <span className="text-muted text-sm whitespace-nowrap">上次调整</span>
          <span className="text-sm">{formatDateTime(task.updatedAt)}</span>
        </div>
      </div>

      <div>
        <h4 className="mt-1 mb-0 text-sm font-semibold">结论记录</h4>
        {task.reports.length === 0 ? <p className="text-muted text-sm mt-2">暂无结论记录。</p> : null}

        <div className="grid gap-2 mt-1.5">
          {task.reports.map((report) => (
            <article key={report.id} className="ui-card p-3">
              <div className="flex justify-between items-center gap-2 mb-2 text-sm">
                <strong>{report.author}</strong>
                <span className="text-muted">{formatDateTime(report.createdAt)}</span>
              </div>
              <pre className="bg-[color:var(--color-base-200)] rounded-lg p-3 text-xs whitespace-pre-wrap break-words m-0 border-0">
                {report.content}
              </pre>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

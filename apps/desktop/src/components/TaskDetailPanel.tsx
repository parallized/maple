import { Icon } from "@iconify/react";
import type { Task } from "../domain";
import { relativeTimeZh } from "../lib/utils";

type TaskDetailPanelProps = {
  task: Task;
  onClose?: () => void;
  onDelete?: () => void;
};

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return relativeTimeZh(value);
}

function formatAbsoluteTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

export function TaskDetailPanel({ task, onClose, onDelete }: TaskDetailPanelProps) {
  return (
    <section className="task-detail-panel flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-2xl font-semibold tracking-tight text-primary flex items-center gap-3">
            {task.title}
            <span className="text-sm font-normal text-muted bg-base-200 px-2 py-0.5 rounded-md">提及 {task.reports.length}</span>
          </h2>
          {onDelete ? (
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost ui-btn--danger ui-icon-btn shrink-0"
              onClick={onDelete}
              aria-label="删除任务"
            >
              <Icon icon="mingcute:delete-2-line" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="task-properties grid grid-cols-[100px_1fr] gap-y-3 gap-x-4 items-center">
        <span className="text-muted text-sm">状态</span>
        <div className="flex items-center">
          <span className={`ui-badge ${task.status === "已完成" ? "ui-badge--success" : task.status === "已阻塞" ? "ui-badge--error" : task.status === "进行中" ? "ui-badge--solid" : task.status === "需要更多信息" ? "ui-badge--warning" : ""}`}>
            {task.status}
          </span>
        </div>

        <span className="text-muted text-sm">版本</span>
        <div className="flex items-center">
          <span className="ui-badge">{task.version}</span>
        </div>

        <span className="text-muted text-sm">标签</span>
        <div className="flex flex-wrap gap-1.5">
          {task.tags.length === 0 ? <span className="text-sm text-muted">无</span> : null}
          {task.tags.map((tag) => (
            <span key={tag} className="ui-badge">
              {tag}
            </span>
          ))}
        </div>

        <span className="text-muted text-sm">创建时间</span>
        <div className="flex items-center text-sm" title={formatAbsoluteTime(task.createdAt)}>
          {formatRelativeTime(task.createdAt)}
        </div>

        <span className="text-muted text-sm">上次调整</span>
        <div className="flex items-center text-sm" title={formatAbsoluteTime(task.updatedAt)}>
          {formatRelativeTime(task.updatedAt)}
        </div>
      </div>

      <div className="h-px bg-(--color-base-300) my-1" />

      <div>
        <h3 className="text-lg font-medium mb-4">结论记录</h3>
        {task.reports.length === 0 ? <p className="text-muted text-sm">暂无结论记录。</p> : null}

        <div className="flex flex-col gap-6">
          {task.reports.map((report) => (
            <article key={report.id} className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-sm">
                <strong className="font-medium">{report.author}</strong>
                <span className="text-muted" title={formatAbsoluteTime(report.createdAt)}>
                  {formatRelativeTime(report.createdAt)}
                </span>
              </div>
              <div className="text-sm leading-relaxed text-base-content whitespace-pre-wrap">
                {report.content}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

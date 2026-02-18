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
    <section className="task-detail">
      <header className="task-detail-head">
        <div className="task-detail-title">
          <h3>{task.title}</h3>
          <span className="mention-badge">提及 {task.reports.length}</span>
        </div>
        <div className="task-detail-actions">
          {onDelete ? (
            <button className="icon-button" onClick={onDelete} aria-label="删除任务">
              <Icon icon="mingcute:delete-2-line" />
            </button>
          ) : null}
          {onClose ? (
            <button className="icon-button" onClick={onClose} aria-label="关闭详情">
              <Icon icon="mingcute:close-line" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="task-properties">
        <div className="task-prop">
          <span className="task-prop-label">状态</span>
          <span className="task-prop-value">
            <span className="status-pill">{task.status}</span>
          </span>
        </div>
        <div className="task-prop">
          <span className="task-prop-label">版本</span>
          <span className="task-prop-value">
            <span className="tag-pill">{task.version}</span>
          </span>
        </div>
        <div className="task-prop task-prop-wide">
          <span className="task-prop-label">标签</span>
          <span className="task-prop-value">{joinTags(task.tags) || "无"}</span>
        </div>
        <div className="task-prop">
          <span className="task-prop-label">创建时间</span>
          <span className="task-prop-value">{formatDateTime(task.createdAt)}</span>
        </div>
        <div className="task-prop">
          <span className="task-prop-label">上次调整</span>
          <span className="task-prop-value">{formatDateTime(task.updatedAt)}</span>
        </div>
      </div>

      <div className="task-section">
        <h4>结论记录</h4>
        {task.reports.length === 0 ? <p className="hint">暂无结论记录。</p> : null}

        <div className="report-list">
          {task.reports.map((report) => (
            <article key={report.id} className="report-item">
              <div className="report-head">
                <strong>{report.author}</strong>
                <span>{formatDateTime(report.createdAt)}</span>
              </div>
              <pre>{report.content}</pre>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}


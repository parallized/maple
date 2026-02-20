import { Icon } from "@iconify/react";
import type { Task } from "../domain";
import { relativeTimeZh } from "../lib/utils";
import type { ReactNode } from "react";

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

type ParsedTaskReport = { status: string; description: string };

function parseTaskReport(content: string): ParsedTaskReport | null {
  const lines = content.split(/\r?\n/);
  const statusLineIndex = lines.findIndex((line) => line.trimStart().startsWith("状态："));
  if (statusLineIndex < 0) return null;

  const statusLine = lines[statusLineIndex] ?? "";
  const status = statusLine.replace(/^\s*状态：/, "").trim();
  const detailLines = lines.slice(statusLineIndex + 1);
  if (!status) return null;

  const labelIndex = detailLines.findIndex((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith("描述：") || trimmed.startsWith("结论：");
  });

  if (labelIndex < 0) {
    const fallback = detailLines.join("\n").trim();
    return fallback ? { status, description: fallback } : { status, description: "" };
  }

  const labelLine = detailLines[labelIndex] ?? "";
  const labelPrefix = labelLine.trimStart().startsWith("结论：") ? "结论：" : "描述：";
  const labelRemainder = labelLine.replace(new RegExp(`^\\s*${labelPrefix}`), "").trim();
  const rest = detailLines.slice(labelIndex + 1).join("\n").trim();
  const description = [labelRemainder, rest].filter(Boolean).join("\n").trim();
  return { status, description };
}

function reportBadgeClass(status: string): string {
  if (status.includes("已完成")) return "ui-badge--success";
  if (status.includes("已阻塞")) return "ui-badge--error";
  if (status.includes("进行中")) return "ui-badge--solid";
  if (status.includes("需要更多信息")) return "ui-badge--warning";
  return "";
}

type ReportBlock = { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

function splitReportBlocks(text: string): ReportBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: ReportBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    const payload = paragraph.join("\n").trim();
    if (payload) blocks.push({ kind: "paragraph", text: payload });
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length > 0) blocks.push({ kind: "list", items: listItems });
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    if (!line.trim()) {
      flushList();
      flushParagraph();
      continue;
    }

    const match = /^\s*[-*]\s+(.*)$/.exec(line);
    if (match) {
      flushParagraph();
      listItems.push(match[1] ?? "");
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushList();
  flushParagraph();
  return blocks;
}

function renderReportDescription(description: string): ReactNode {
  const blocks = splitReportBlocks(description);
  if (blocks.length === 0) return <span className="text-muted">无</span>;

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => (
        block.kind === "list"
          ? (
            <ul key={`list-${index}`} className="list-disc pl-5 space-y-1">
              {block.items.map((item, itemIndex) => (
                <li key={`${index}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          )
          : (
            <p key={`p-${index}`} className="m-0 whitespace-pre-wrap">
              {block.text}
            </p>
          )
      ))}
    </div>
  );
}

export function TaskDetailPanel({ task, onClose, onDelete }: TaskDetailPanelProps) {
  return (
    <section className="task-detail-panel flex flex-col pb-8 px-2">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="m-0 text-[32px] font-serif font-bold tracking-tight text-primary leading-snug">
            {task.title || "(无标题)"}
          </h2>
          {onDelete ? (
            <button
              type="button"
              className="ui-btn ui-btn--sm ui-btn--ghost ui-btn--danger ui-icon-btn shrink-0 mt-1"
              onClick={onDelete}
              aria-label="删除任务"
            >
              <Icon icon="mingcute:delete-2-line" className="text-base" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="task-properties grid grid-cols-[120px_1fr] gap-y-1.5 items-center mb-8">
        <span className="text-muted text-[14px] flex items-center gap-2">
          <Icon icon="mingcute:signal-line" className="text-[16px] opacity-70" />
          状态
        </span>
        <div className="flex items-center min-h-[32px]">
          <span className={`ui-badge ${task.status === "已完成" ? "ui-badge--success" : task.status === "已阻塞" ? "ui-badge--error" : task.status === "进行中" ? "ui-badge--solid" : task.status === "需要更多信息" ? "ui-badge--warning" : ""}`}>
            <span className={`status-dot status-${task.status === "已完成" ? "done" : task.status === "已阻塞" ? "blocked" : task.status === "进行中" ? "active" : task.status === "需要更多信息" ? "info" : "pending"}`} />
            {task.status}
          </span>
        </div>

        <span className="text-muted text-[14px] flex items-center gap-2">
          <Icon icon="mingcute:version-line" className="text-[16px] opacity-70" />
          版本
        </span>
        <div className="flex items-center min-h-[32px] text-[14px] text-primary">
          {task.version ? <span className="ui-badge">{task.version}</span> : <span className="text-muted opacity-50">空白</span>}
        </div>

        <span className="text-muted text-[14px] flex items-center gap-2">
          <Icon icon="mingcute:tag-line" className="text-[16px] opacity-70" />
          标签
        </span>
        <div className="flex flex-wrap gap-1.5 items-center min-h-[32px]">
          {task.tags.length === 0 ? <span className="text-muted text-[14px] opacity-50">空白</span> : null}
          {task.tags.map((tag) => (
            <span key={tag} className="ui-badge">
              {tag}
            </span>
          ))}
        </div>

        <span className="text-muted text-[14px] flex items-center gap-2">
          <Icon icon="mingcute:time-line" className="text-[16px] opacity-70" />
          创建
        </span>
        <div className="flex items-center min-h-[32px] text-[14px] text-primary" title={formatAbsoluteTime(task.createdAt)}>
          {formatRelativeTime(task.createdAt)}
        </div>

        <span className="text-muted text-[14px] flex items-center gap-2">
          <Icon icon="mingcute:history-line" className="text-[16px] opacity-70" />
          更新
        </span>
        <div className="flex items-center min-h-[32px] text-[14px] text-primary" title={formatAbsoluteTime(task.updatedAt)}>
          {formatRelativeTime(task.updatedAt)}
        </div>
      </div>

      <div className="h-px bg-(--color-base-300) mb-8" />

      <div>
        <h3 className="text-[14px] font-medium mb-4 mt-2 flex items-center gap-2 text-muted">
          <Icon icon="mingcute:comment-line" className="text-[16px] opacity-70" />
          执行报告
          <span className="ui-badge px-1.5 py-0.5 text-[12px] ml-1 opacity-80">{task.reports.length}</span>
        </h3>
        
        {task.reports.length === 0 ? (
          <div className="py-6 text-center border border-dashed border-(--color-base-300) rounded-xl">
            <p className="text-muted text-sm m-0">暂无执行报告</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-6">
          {task.reports.map((report) => {
            const parsed = parseTaskReport(report.content);
            return (
              <article key={report.id} className="flex flex-col gap-3 group mt-2">
                <div className="flex items-center gap-2 text-[14px]">
                  <div className="w-6 h-6 rounded-full bg-(--color-base-200) border border-(--color-base-300) flex items-center justify-center text-[12px] font-bold text-secondary">
                    {report.author.charAt(0).toUpperCase()}
                  </div>
                  <strong className="font-medium text-primary">{report.author}</strong>
                  <span
                    className="text-muted text-[13px] ml-auto opacity-60 group-hover:opacity-100 transition-opacity"
                    title={formatAbsoluteTime(report.createdAt)}
                  >
                    {formatRelativeTime(report.createdAt)}
                  </span>
                </div>
                <div className="pt-1">
                  <div className="bg-(--color-base-200)/50 rounded-2xl p-4">
                    {parsed ? (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <span className={`ui-badge ${reportBadgeClass(parsed.status)}`}>{parsed.status}</span>
                        </div>
                        <div className="text-[14px] leading-relaxed text-base-content">
                          {renderReportDescription(parsed.description)}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[14px] leading-relaxed text-base-content whitespace-pre-wrap">{report.content}</div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import { Icon } from "@iconify/react";
import type { Task, WorkerKind } from "../domain";
import { relativeTimeZh } from "../lib/utils";
import { type ReactNode, useState } from "react";
import { WorkerLogo } from "./WorkerLogo";

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

function renderAuthorIcon(author: string, size = 14) {
  const normalized = author.toLowerCase();
  if (normalized === "claude") return <WorkerLogo kind="claude" size={size} />;
  if (normalized === "codex") return <WorkerLogo kind="codex" size={size} />;
  if (normalized === "iflow") return <WorkerLogo kind="iflow" size={size} />;
  if (normalized === "mcp") return <Icon icon="mingcute:server-line" className="opacity-80" style={{ fontSize: size }} />;
  return <Icon icon="mingcute:paper-line" className="opacity-60" style={{ fontSize: size }} />;
}

export function TaskDetailPanel({ task, onClose, onDelete }: TaskDetailPanelProps) {
  const [activeReportId, setActiveReportId] = useState<string | null>(
    task.reports.length > 0 ? task.reports[task.reports.length - 1]!.id : null
  );

  return (
    <section className="task-detail-panel flex flex-col pb-10">
      <header className="mb-6 relative">
        <div className="flex items-start justify-between gap-6">
          <h2 className="m-0 text-[26px] font-semibold tracking-tight text-primary leading-[1.3]">
            {task.title || "(无标题)"}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            {onDelete ? (
              <button
                type="button"
                className="ui-btn ui-btn--xs ui-btn--ghost ui-btn--danger ui-icon-btn opacity-40 hover:opacity-100 transition-opacity"
                onClick={onDelete}
                aria-label="删除任务"
              >
                <Icon icon="mingcute:delete-2-line" className="text-base" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="task-properties flex flex-col gap-y-3 mb-8">
        {/* ... (properties grid remains same) */}
        <div className="grid grid-cols-2 gap-x-8">
          <div className="flex items-center gap-4">
            <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
              <Icon icon="mingcute:signal-line" className="text-[15px] opacity-60" />
              状态
            </span>
            <div className="flex items-center">
              <span className={`ui-badge ui-badge--sm ${task.status === "已完成" ? "ui-badge--success" : task.status === "已阻塞" ? "ui-badge--error" : task.status === "进行中" ? "ui-badge--solid" : task.status === "需要更多信息" ? "ui-badge--warning" : ""}`}>
                <span className={`status-dot status-${task.status === "已完成" ? "done" : task.status === "已阻塞" ? "blocked" : task.status === "进行中" ? "active" : task.status === "需要更多信息" ? "info" : "pending"}`} />
                {task.status}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
              <Icon icon="mingcute:version-line" className="text-[15px] opacity-60" />
              版本
            </span>
            <div className="flex items-center text-[13px] text-primary">
              {task.version ? <span className="ui-badge ui-badge--sm">{task.version}</span> : <span className="text-muted opacity-40">未指定</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8">
          <div className="flex items-center gap-4">
            <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
              <Icon icon="mingcute:time-line" className="text-[15px] opacity-60" />
              创建
            </span>
            <div className="flex items-center text-[13px] text-secondary/80" title={formatAbsoluteTime(task.createdAt)}>
              {formatRelativeTime(task.createdAt)}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
              <Icon icon="mingcute:history-line" className="text-[15px] opacity-60" />
              更新
            </span>
            <div className="flex items-center text-[13px] text-secondary/80" title={formatAbsoluteTime(task.updatedAt)}>
              {formatRelativeTime(task.updatedAt)}
            </div>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px] pt-1">
            <Icon icon="mingcute:tag-line" className="text-[15px] opacity-60" />
            标签
          </span>
          <div className="flex flex-wrap gap-1.5 items-center">
            {task.tags.length === 0 ? <span className="text-muted text-[13px] opacity-40">无标签</span> : null}
            {task.tags.map((tag) => (
              <span key={tag} className="ui-badge ui-badge--sm">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="h-px bg-(--color-base-300) mb-4" />

      <div className="pt-2 flex flex-col flex-1 min-h-0">
        <header className="flex items-center gap-6 border-b border-(--color-base-300)/30 mb-6 px-1">
          <h3 className="text-[13px] font-semibold flex items-center gap-2 text-primary/80 tracking-wide uppercase m-0 pb-3">
            <Icon icon="mingcute:comment-line" className="text-[16px] opacity-60" />
            执行报告
          </h3>
          
          {task.reports.length > 0 && (
            <nav className="flex items-center gap-6 flex-1 overflow-x-auto scrollbar-none">
              {task.reports.map((report) => {
                const active = activeReportId === report.id;
                return (
                  <button
                    key={report.id}
                    onClick={() => setActiveReportId(report.id)}
                    className={`relative flex items-center gap-2 pb-3 transition-all text-[12px] font-medium group select-none whitespace-nowrap ${
                      active ? "text-primary" : "text-muted hover:text-secondary"
                    }`}
                  >
                    <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'}`}>
                      {renderAuthorIcon(report.author, 14)}
                    </span>
                    <span>{formatRelativeTime(report.createdAt)}</span>
                    {active && (
                      <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-primary rounded-full animate-in fade-in zoom-in-95 duration-300" />
                    )}
                  </button>
                );
              })}
            </nav>
          )}
        </header>
        
        {task.reports.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-(--color-base-300) rounded-2xl bg-(--color-base-200)/30">
            <Icon icon="mingcute:empty-line" className="text-2xl text-muted/30 mb-2 mx-auto" />
            <p className="text-muted/60 text-[13px] m-0">暂无执行报告</p>
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 px-1">
            {task.reports.map((report) => {
              if (report.id !== activeReportId) return null;
              const parsed = parseTaskReport(report.content);
              return (
                <article key={report.id} className="flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-300">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center">
                        {renderAuthorIcon(report.author, 12)}
                      </div>
                      <span className="text-[11px] font-semibold text-secondary/70 tracking-tight">{report.author}</span>
                    </div>
                    {parsed && (
                      <span className={`ui-badge ui-badge--sm ${reportBadgeClass(parsed.status)} font-medium opacity-90`}>
                        {parsed.status}
                      </span>
                    )}
                  </div>

                  <div className="report-content text-[13.5px] leading-[1.7] text-secondary/90 whitespace-pre-wrap">
                    {parsed ? renderReportDescription(parsed.description) : report.content}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

import { Icon } from "@iconify/react";
import type { Task, TaskReport } from "../domain";
import { relativeTimeZh, getTimeLevel } from "../lib/utils";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { InlineTaskInput } from "./InlineTaskInput";
import { TaskDetailsEditor } from "./TaskDetailsEditor";
import { WorkerLogo } from "./WorkerLogo";

type TaskDetailPanelProps = {
  task: Task;
  onUpdateTitle?: (title: string) => void;
  onUpdateDetails?: (details: string) => void;
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
  if (statusLineIndex < 0) {
    const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);
    if (firstNonEmptyIndex < 0) return null;
    const firstLine = lines[firstNonEmptyIndex] ?? "";
    const statusPrefix = firstLine.match(/^\s*(待办|队列中|进行中|需要更多信息|已完成|已阻塞)\s*[:：]\s*(.*)$/);
    if (!statusPrefix) return null;
    const status = statusPrefix[1]?.trim() ?? "";
    const firstDetail = statusPrefix[2]?.trim() ?? "";
    const detailLines = lines.slice(firstNonEmptyIndex + 1);
    const rest = detailLines.join("\n").trim();
    const description = [firstDetail, rest].filter(Boolean).join("\n").trim();
    return { status, description };
  }

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

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; language: string; code: string };

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeFence = line.match(/^```([\w-]*)\s*$/);
    if (codeFence) {
      const language = codeFence[1] ?? "";
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trimEnd();
        if (/^```/.test(candidate)) break;
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language, code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ kind: "heading", level: headingMatch[1]!.length, text: headingMatch[2]!.trim() });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? "").trimEnd();
        if (!/^>\s?/.test(current)) break;
        quoteLines.push(current.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const matcher = ordered ? /^\d+\.\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      const items: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? "").trimEnd();
        const itemMatch = current.match(matcher);
        if (!itemMatch) break;
        items.push(itemMatch[1] ?? "");
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trimEnd();
      if (!current.trim()) break;
      if (
        /^```/.test(current)
        || /^(#{1,6})\s+/.test(current)
        || /^>\s?/.test(current)
        || /^[-*+]\s+/.test(current)
        || /^\d+\.\s+/.test(current)
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraphLines });
      continue;
    }

    index += 1;
  }

  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0] ?? "";
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(<span key={`plain-${matchIndex}`}>{text.slice(cursor, start)}</span>);
      matchIndex += 1;
    }

    if (token.startsWith("`")) {
      nodes.push(
        <code key={`code-${matchIndex}`} className="px-1 py-0.5 rounded bg-(--color-base-200) text-[0.92em] font-mono">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${matchIndex}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={`em-${matchIndex}`}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const href = link[2] ?? "";
        const safe = /^https?:\/\//i.test(href);
        nodes.push(
          safe
            ? (
              <a
                key={`link-${matchIndex}`}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2"
              >
                {link[1]}
              </a>
            )
            : <span key={`link-plain-${matchIndex}`}>{link[1]}</span>
        );
      } else {
        nodes.push(<span key={`token-${matchIndex}`}>{token}</span>);
      }
    }
    cursor = start + token.length;
    matchIndex += 1;
  }

  if (cursor < text.length) {
    nodes.push(<span key={`tail-${matchIndex}`}>{text.slice(cursor)}</span>);
  }
  return nodes;
}

function renderMarkdownText(markdown: string): ReactNode {
  const blocks = parseMarkdownBlocks(markdown);
  if (blocks.length === 0) return <span className="text-muted">无</span>;

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, blockIndex) => {
        if (block.kind === "heading") {
          const headingClass = block.level <= 2 ? "text-[16px] font-semibold" : "text-[14px] font-semibold";
          return (
            <h4 key={`h-${blockIndex}`} className={`m-0 ${headingClass}`}>
              {renderInlineMarkdown(block.text)}
            </h4>
          );
        }

        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={`list-${blockIndex}`} className={`${block.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ListTag>
          );
        }

        if (block.kind === "quote") {
          return (
            <blockquote
              key={`quote-${blockIndex}`}
              className="m-0 pl-3 border-l-2 border-(--color-base-300) text-secondary/90"
            >
              {block.lines.map((line, lineIndex) => (
                <p key={`${blockIndex}-${lineIndex}`} className="m-0">
                  {renderInlineMarkdown(line)}
                </p>
              ))}
            </blockquote>
          );
        }

        if (block.kind === "code") {
          return (
            <pre
              key={`code-${blockIndex}`}
              className="m-0 p-3 rounded-lg bg-(--color-base-200) border border-(--color-base-300) overflow-x-auto"
            >
              <code className="font-mono text-[12px] leading-[1.6] whitespace-pre">
                {block.code}
              </code>
            </pre>
          );
        }

        return (
          <p key={`p-${blockIndex}`} className="m-0 whitespace-pre-wrap">
            {block.lines.map((line, lineIndex) => (
              <span key={`${blockIndex}-${lineIndex}`}>
                {renderInlineMarkdown(line)}
                {lineIndex < block.lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function isCompletedReport(report: TaskReport): boolean {
  const parsed = parseTaskReport(report.content);
  if (parsed?.status.includes("已完成")) return true;

  const normalized = report.content.toLowerCase();
  return /status[:：].*completed/.test(normalized) || /状态[:：].*已完成/.test(report.content);
}

function renderAuthorIcon(author: string, size = 14) {
  const normalized = author.toLowerCase();
  if (normalized === "claude") return <WorkerLogo kind="claude" size={size} />;
  if (normalized === "codex") return <WorkerLogo kind="codex" size={size} />;
  if (normalized === "iflow") return <WorkerLogo kind="iflow" size={size} />;
  if (normalized === "mcp") return <Icon icon="mingcute:server-line" className="opacity-80" style={{ fontSize: size }} />;
  return <Icon icon="mingcute:paper-line" className="opacity-60" style={{ fontSize: size }} />;
}

export function TaskDetailPanel({ task, onUpdateTitle, onUpdateDetails, onClose }: TaskDetailPanelProps) {
  const completedReports = useMemo(
    () => task.reports.filter(isCompletedReport),
    [task.reports]
  );
  const [activeReportId, setActiveReportId] = useState<string | null>(
    completedReports.length > 0 ? completedReports[completedReports.length - 1]!.id : null
  );

  useEffect(() => {
    if (completedReports.length === 0) {
      setActiveReportId(null);
      return;
    }
    if (!activeReportId || !completedReports.some((report) => report.id === activeReportId)) {
      setActiveReportId(completedReports[completedReports.length - 1]!.id);
    }
  }, [activeReportId, completedReports]);

  return (
    <section className="task-detail-panel flex flex-col pb-10">
      <header className="mb-6 relative">
        <div className="flex items-start gap-4 pr-10">
          <div className="flex-1 min-w-0">
            <InlineTaskInput
              initialValue={task.title}
              className="task-detail-title-input"
              ariaLabel="编辑任务标题"
              onCommit={(nextTitle) => {
                const trimmed = nextTitle.trim();
                const current = task.title.trim();
                if (trimmed === current) return;
                onUpdateTitle?.(trimmed);
              }}
            />
          </div>
        </div>
      </header>

      <div className="task-properties flex flex-col gap-y-0.5">
        <div className="grid grid-cols-2 gap-x-8">
          <div className="flex items-center gap-4 h-9">
            <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
              <Icon icon="mingcute:signal-line" className="text-[15px] opacity-60" />
              状态
            </span>
            <div className="flex items-center">
              <span className={`ui-badge ui-badge--sm ${reportBadgeClass(task.status)}`}>
                {task.status}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 h-9">
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
          <div className="flex items-center gap-4 h-9">
            <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
              <Icon icon="mingcute:time-line" className="text-[15px] opacity-60" />
              创建
            </span>
            <div className={`flex items-center text-[13px] ${(() => {
            const level = getTimeLevel(task.createdAt);
            return `time-level-${level}`;
          })()}`} title={formatAbsoluteTime(task.createdAt)}>
            {formatRelativeTime(task.createdAt)}
          </div>
          </div>

          <div className="flex items-center gap-4 h-9">
            <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
              <Icon icon="mingcute:history-line" className="text-[15px] opacity-60" />
              更新
            </span>
            <div className={`flex items-center text-[13px] ${(() => {
            const level = getTimeLevel(task.updatedAt);
            return `time-level-${level}`;
          })()}`} title={formatAbsoluteTime(task.updatedAt)}>
            {formatRelativeTime(task.updatedAt)}
          </div>
          </div>
        </div>

        <div className="flex items-center gap-4 h-9">
          <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
            <Icon icon="mingcute:tag-line" className="text-[15px] opacity-60" />
            标签
          </span>
          <div className="flex flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none select-none" style={{ maskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 24px), transparent 100%)' }}>
            {task.tags.length === 0 ? <span className="text-muted text-[13px] opacity-40">无标签</span> : null}
            {task.tags.map((tag) => (
              <span key={tag} className="ui-badge ui-badge--sm shrink-0">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col mt-1">
          <header className="flex items-center gap-2 h-9">
            <h3 className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px] m-0">
              <Icon icon="mingcute:file-text-line" className="text-[15px] opacity-60" />
              详情
            </h3>
          </header>
          {onUpdateDetails ? (
            <TaskDetailsEditor value={task.details ?? ""} onCommit={onUpdateDetails} />
          ) : (
            <div className="task-details-surface">
              {task.details?.trim() ? (
                <div className="task-details-text">{task.details}</div>
              ) : (
                <span className="task-details-placeholder">暂无详情</span>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <header className={`flex items-center gap-4 h-9 ${completedReports.length > 0 ? 'border-b border-(--color-base-300)/30 mb-4' : ''}`}>
            <h3 className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px] m-0">
              <Icon icon="mingcute:comment-line" className="text-[15px] opacity-60" />
              执行报告
            </h3>
            
            <div className="flex-1 min-h-0 self-stretch flex items-end">
              {completedReports.length > 0 ? (
                <nav className="flex items-center gap-5 overflow-x-auto scrollbar-none w-full">
                  {completedReports.slice(-3).map((report) => {
                    const active = activeReportId === report.id;
                    return (
                      <button
                        key={report.id}
                        onClick={() => setActiveReportId(report.id)}
                        className={`relative flex items-center gap-1.5 pb-2.5 transition-all text-[12px] font-medium group select-none whitespace-nowrap leading-none ${
                          active ? "text-primary" : "text-muted hover:text-secondary"
                        }`}
                      >
                        <span className={`transition-opacity flex items-center ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'}`}>
                          {renderAuthorIcon(report.author, 13)}
                        </span>
                        <span className={`flex items-center ${(() => {
                        const level = getTimeLevel(report.createdAt);
                        return `time-level-${level}`;
                      })()}`}>{formatRelativeTime(report.createdAt)}</span>
                        {active && (
                          <div className="absolute -bottom-px left-0 right-0 h-[2px] bg-primary rounded-full animate-in fade-in duration-200" />
                        )}
                      </button>
                    );
                  })}
                </nav>
              ) : (
                <div className="flex items-center text-[13px] text-muted opacity-40 pb-2.5">
                  暂无执行报告
                </div>
              )}
            </div>
          </header>

          {completedReports.length > 0 && (
            <div className="flex flex-col flex-1 min-h-0 pt-2 px-1">
              {completedReports.map((report) => {
                if (report.id !== activeReportId) return null;
                const parsed = parseTaskReport(report.content);
                return (
                  <article key={report.id} className="flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-300">
                    <div className="report-content text-[13.5px] leading-[1.6] text-secondary/90 whitespace-pre-wrap">
                      {parsed ? renderMarkdownText(parsed.description) : renderMarkdownText(report.content)}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

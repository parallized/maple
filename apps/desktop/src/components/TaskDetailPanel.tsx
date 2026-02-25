import { Icon } from "@iconify/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { TagCatalog, Task } from "../domain";
import type { UiLanguage } from "../lib/constants";
import { formatTagLabel } from "../lib/tag-label";
import { buildTagBadgeStyle } from "../lib/tag-style";
import { resolveTagIconMeta } from "../lib/task-icons";
import { renderTaskMarkdown } from "../lib/task-markdown";
import { getTimeLevel, relativeTimeZh } from "../lib/utils";
import { InlineTaskInput } from "./InlineTaskInput";
import { TaskDetailsEditor } from "./TaskDetailsEditor";
import { WorkerLogo } from "./WorkerLogo";

type TaskDetailPanelProps = {
  task: Task;
  tagLanguage: UiLanguage;
  tagCatalog?: TagCatalog | null;
  onUpdateTitle?: (title: string) => void;
  onUpdateDetails?: (details: string, detailsDoc: unknown) => void;
  onMarkAsDone?: () => void;
  onReworkToDraft?: () => void;
  onSetAsTodo?: () => void;
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
    const statusPrefix = firstLine.match(/^\s*(草稿|待办|待返工|队列中|进行中|需要更多信息|已完成|已阻塞)\s*[:：]\s*(.*)$/);
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
  if (status.includes("草稿") || status.includes("队列中") || status.includes("待办") || status.includes("待返工")) return "ui-badge--neutral";
  return "";
}

function renderAuthorIcon(author: string, size = 14) {
  const normalized = author.toLowerCase();
  if (normalized === "claude") return <WorkerLogo kind="claude" size={size} />;
  if (normalized === "codex") return <WorkerLogo kind="codex" size={size} />;
  if (normalized === "iflow") return <WorkerLogo kind="iflow" size={size} />;
  if (normalized === "mcp") return <Icon icon="mingcute:server-line" className="opacity-80" style={{ fontSize: size }} />;
  return <Icon icon="mingcute:paper-line" className="opacity-60" style={{ fontSize: size }} />;
}

export function TaskDetailPanel({
  task,
  tagLanguage,
  tagCatalog,
  onUpdateTitle,
  onUpdateDetails,
  onMarkAsDone,
  onReworkToDraft,
  onSetAsTodo,
  onClose
}: TaskDetailPanelProps) {
  const reports = useMemo(() => {
    return task.reports
      .filter((report) => report.content.trim().length > 0)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [task.reports]);
  const [activeReportId, setActiveReportId] = useState<string | null>(
    reports.length > 0 ? reports[0]!.id : null
  );

  useEffect(() => {
    if (reports.length === 0) {
      setActiveReportId(null);
      return;
    }
    if (!activeReportId || !reports.some((report) => report.id === activeReportId)) {
      setActiveReportId(reports[0]!.id);
    }
  }, [activeReportId, reports]);

  const primaryAction =
    task.status === "待办" && typeof onMarkAsDone === "function"
      ? {
          label: "标记为已完成",
          ariaLabel: "标记为已完成",
          title: "将任务标记为已完成",
          icon: "mingcute:check-line",
          className:
            "ui-btn ui-btn--sm rounded-full border-(--color-base-300) bg-transparent hover:bg-primary/5 hover:border-primary/30 hover:text-primary text-muted transition-all duration-300 gap-1.5 px-4",
          onClick: onMarkAsDone,
        }
      : task.status === "已完成" && typeof onReworkToDraft === "function"
        ? {
            label: "返工",
            ariaLabel: "返工并设为草稿",
            title: "将任务返工并设置为草稿（可继续编辑后再设置为待办）",
            icon: "mingcute:refresh-3-line",
            className:
              "ui-btn ui-btn--sm rounded-full border-(--color-base-300) bg-transparent hover:bg-warning/5 hover:border-warning/30 hover:text-warning text-muted transition-all duration-300 gap-1.5 px-4",
            onClick: onReworkToDraft,
          }
        : task.status === "草稿" && typeof onSetAsTodo === "function"
          ? {
              label: "设置为待办",
              ariaLabel: "设置为待办",
              title: "将草稿任务设置为待办",
              icon: "mingcute:time-line",
              className:
                "ui-btn ui-btn--sm rounded-full border-(--color-base-300) bg-transparent hover:bg-primary/5 hover:border-primary/30 hover:text-primary text-muted transition-all duration-300 gap-1.5 px-4",
              onClick: onSetAsTodo,
            }
          : null;

  return (
    <motion.section 
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="task-detail-panel flex flex-col h-full min-h-0 overflow-x-hidden"
    >
      <header className="mb-4 relative">
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
        {primaryAction ? (
          <div className="mt-3 flex justify-start">
            <button
              type="button"
              className={primaryAction.className}
              onClick={primaryAction.onClick}
              aria-label={primaryAction.ariaLabel}
              title={primaryAction.title}
            >
              <Icon icon={primaryAction.icon} className="text-[14px]" />
              <span className="font-medium text-[12.5px]">{primaryAction.label}</span>
            </button>
          </div>
        ) : null}
      </header>

      <motion.div 
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } }
        }}
        className="task-properties flex flex-col gap-y-0.5 flex-1 min-h-0"
      >
        <motion.div 
          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
          className="grid grid-cols-2 gap-x-8"
        >
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
        </motion.div>

        <motion.div 
          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
          className="grid grid-cols-2 gap-x-8"
        >
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
        </motion.div>

        <motion.div 
          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
          className="flex items-center gap-4 h-9"
        >
          <span className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px]">
            <Icon icon="mingcute:tag-line" className="text-[15px] opacity-60" />
            标签
          </span>
          <div className="flex flex-1 items-center gap-1.5 overflow-hidden select-none min-w-0 flex-wrap">
            {task.tags.length === 0 ? <span className="text-muted text-[13px] opacity-40">无标签</span> : null}
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="ui-badge ui-badge--sm ui-badge--tag inline-flex items-center gap-1"
                style={buildTagBadgeStyle(tag, tagCatalog) as CSSProperties}
                title={tag}
              >
                <Icon icon={resolveTagIconMeta(tag, tagCatalog).icon} className="text-[12px] opacity-80" />
                <span>{formatTagLabel(tag, tagLanguage, tagCatalog)}</span>
              </span>
            ))}
          </div>
        </motion.div>

        <motion.div 
          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
          className="flex flex-col"
        >
          <header className={`flex items-center gap-4 h-9 ${reports.length > 0 ? 'border-b border-(--color-base-300)/30 mb-4' : ''}`}>
            <h3 className="text-muted text-[13px] flex items-center gap-2 font-medium min-w-[60px] m-0">
              <Icon icon="mingcute:comment-line" className="text-[15px] opacity-60" />
              执行报告
            </h3>
            
            <div className="flex-1 min-h-0 self-stretch flex items-end">
              {reports.length > 0 ? (
                <nav className="flex items-center gap-5 overflow-hidden w-full min-w-0 flex-wrap">
                  {reports.slice(0, 3).map((report, index) => {
                    const active = activeReportId === report.id;
                    return (
                      <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0, transition: { delay: index * 0.05 } }}
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
                          <motion.div
                            layoutId="activeTab"
                            className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t-full"
                          />
                        )}
                      </motion.button>
                    );
                  })}
                </nav>
              ) : (
                <div className="flex items-center text-[13px] text-muted opacity-40 pb-2">
                  暂无执行报告
                </div>
              )}
            </div>
          </header>

          <div className="pl-[22px] mt-1">
            {reports.length > 0 && (
              <div className="relative">
                <AnimatePresence mode="wait">
                  {reports.filter(r => r.id === activeReportId).map((report) => {
                    const parsed = parseTaskReport(report.content);
                    return (
                      <motion.article 
                        key={report.id}
                        initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        className="flex flex-col"
                      >
                        <div className="report-content text-[13px] leading-[1.55] text-secondary/85 flex gap-2.5">
                          <div className="shrink-0 mt-[3px] -ml-[22px] opacity-40" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}>
                            {renderAuthorIcon(report.author, 14)}
                          </div>
                          <div className="flex-1 min-w-0">
                            {parsed ? renderTaskMarkdown(parsed.description) : renderTaskMarkdown(report.content)}
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div 
          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }}
          className="flex flex-col mt-4 pt-4 border-t border-(--color-base-300)/18 flex-1 min-h-0"
        >
          {onUpdateDetails ? (
            <TaskDetailsEditor value={task.details ?? ""} valueDoc={task.detailsDoc} onCommit={onUpdateDetails} />
          ) : (
            <div className="task-details-surface">
              {task.details?.trim() ? (
                <div className="task-details-text">{renderTaskMarkdown(task.details)}</div>
              ) : (
                <span className="task-details-placeholder">暂无详情</span>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </motion.section>
  );
}

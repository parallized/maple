import { Icon } from "@iconify/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { TagCatalog, Task, TaskStatus, WorkerKind } from "../domain";
import type { UiLanguage } from "../lib/constants";
import { WORKER_KINDS } from "../lib/constants";
import { formatTagLabel } from "../lib/tag-label";
import { buildTagBadgeStyle } from "../lib/tag-style";
import { resolveTagIconMeta } from "../lib/task-icons";
import { renderTaskMarkdown } from "../lib/task-markdown";
import { buildNeedsInfoAppendixMarkdown, parseNeedsInfoFormFromReport } from "../lib/needs-info-form";
import { statusBadgeClass, statusDotClass } from "../lib/status-colors";
import { getTimeLevel, relativeTimeZh } from "../lib/utils";
import { InlineTaskInput } from "./InlineTaskInput";
import { TaskDetailsEditor } from "./TaskDetailsEditor";
import { WorkerLogo } from "./WorkerLogo";
import { PopoverMenu, type PopoverMenuItem } from "./PopoverMenu";

type TaskDetailPanelProps = {
  task: Task;
  projectWorkerKind?: WorkerKind | null;
  tagLanguage: UiLanguage;
  tagCatalog?: TagCatalog | null;
  onUpdateTitle?: (title: string) => void;
  onUpdateDetails?: (details: string, detailsDoc: unknown) => void;
  onMarkAsDone?: () => void;
  onReworkToDraft?: () => void;
  onSetAsRework?: () => void;
  onSetAsTodo?: () => void;
  onUpdateTaskStatus?: (status: TaskStatus) => void;
  onUpdateTargetWorkerKind?: (kind: WorkerKind | null) => void;
  onRestartExecution?: () => void;
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

function renderAuthorIcon(author: string, size = 14) {
  const normalized = author.toLowerCase();
  if (normalized === "claude") return <WorkerLogo kind="claude" size={size} />;
  if (normalized === "codex") return <WorkerLogo kind="codex" size={size} />;
  if (normalized === "iflow") return <WorkerLogo kind="iflow" size={size} />;
  if (normalized === "gemini") return <WorkerLogo kind="gemini" size={size} />;
  if (normalized === "opencode") return <WorkerLogo kind="opencode" size={size} />;
  if (normalized === "mcp") return <Icon icon="mingcute:server-line" className="opacity-80" style={{ fontSize: size }} />;
  return <Icon icon="mingcute:paper-line" className="opacity-60" style={{ fontSize: size }} />;
}

export function TaskDetailPanel({
  task,
  projectWorkerKind,
  tagLanguage,
  tagCatalog,
  onUpdateTitle,
  onUpdateDetails,
  onMarkAsDone,
  onReworkToDraft,
  onSetAsRework,
  onSetAsTodo,
  onUpdateTaskStatus,
  onUpdateTargetWorkerKind,
  onRestartExecution,
  onClose,
  onDelete,
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

  const activeReport = useMemo(() => {
    if (!activeReportId) return null;
    return reports.find((report) => report.id === activeReportId) ?? null;
  }, [activeReportId, reports]);

  const activeNeedsInfoForm = useMemo(() => {
    if (!activeReport) return null;
    return parseNeedsInfoFormFromReport(activeReport.content);
  }, [activeReport]);

  const [needsInfoValuesByReportId, setNeedsInfoValuesByReportId] = useState<Record<string, Record<string, string>>>({});
  const [needsInfoErrorsByReportId, setNeedsInfoErrorsByReportId] = useState<Record<string, Record<string, string>>>({});
  const [needsInfoSubmitting, setNeedsInfoSubmitting] = useState(false);

  function updateNeedsInfoValue(reportId: string, fieldId: string, value: string) {
    setNeedsInfoValuesByReportId((prev) => ({
      ...prev,
      [reportId]: {
        ...(prev[reportId] ?? {}),
        [fieldId]: value,
      },
    }));

    setNeedsInfoErrorsByReportId((prev) => {
      const current = prev[reportId] ?? {};
      if (!current[fieldId]) return prev;
      const next = { ...current };
      delete next[fieldId];
      return { ...prev, [reportId]: next };
    });
  }

  async function handleNeedsInfoDone() {
    if (needsInfoSubmitting) return;

    // Fallback: when there's no structured form in the report, keep the old behavior.
    if (!activeReport || !activeNeedsInfoForm) {
      onSetAsTodo?.();
      return;
    }

    const schema = activeNeedsInfoForm.schema;
    const reportId = activeReport.id;
    const values = needsInfoValuesByReportId[reportId] ?? {};

    const fieldErrors: Record<string, string> = {};
    for (const field of schema.fields) {
      if (!field.required) continue;
      const v = (values[field.id] ?? "").trim();
      if (!v) {
        fieldErrors[field.id] = "必填";
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      setNeedsInfoErrorsByReportId((prev) => ({ ...prev, [reportId]: fieldErrors }));
      return;
    }

    const appendix = buildNeedsInfoAppendixMarkdown(schema, values, new Date());
    const currentDetails = task.details ?? "";
    const nextDetails = currentDetails.trim()
      ? `${currentDetails.trimEnd()}\n\n${appendix}`
      : appendix;

    try {
      setNeedsInfoSubmitting(true);
      onUpdateDetails?.(nextDetails, undefined);
      onSetAsTodo?.();
    } finally {
      setNeedsInfoSubmitting(false);
    }
  }

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
      : task.status === "需要更多信息" && typeof onSetAsTodo === "function"
        ? {
            label: "填写完毕",
            ariaLabel: "填写完毕并设为待办",
            title: "将补充信息写入详情，并把任务设为待办以继续执行",
            icon: "mingcute:check-line",
            className:
              "ui-btn ui-btn--sm rounded-full border-(--color-base-300) bg-transparent hover:bg-primary/5 hover:border-primary/30 hover:text-primary text-muted transition-all duration-300 gap-1.5 px-4",
            onClick: () => void handleNeedsInfoDone(),
          }
        : task.status === "已阻塞" && typeof onSetAsRework === "function"
          ? {
              label: "返工",
              ariaLabel: "返工并设为待返工",
              title: "将任务设为待返工，以便继续处理",
              icon: "mingcute:refresh-3-line",
              className:
                "ui-btn ui-btn--sm rounded-full border-(--color-base-300) bg-transparent hover:bg-warning/5 hover:border-warning/30 hover:text-warning text-muted transition-all duration-300 gap-1.5 px-4",
              onClick: onSetAsRework,
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

  const canPickTargetWorker =
    typeof onUpdateTargetWorkerKind === "function"
    && (
      task.status === "草稿"
      || task.status === "需要更多信息"
      || task.status === "待办"
      || task.status === "待返工"
      || task.status === "队列中"
      || task.status === "已阻塞"
    );

  const resolvedProjectWorkerLabel = projectWorkerKind
    ? WORKER_KINDS.find((entry) => entry.kind === projectWorkerKind)?.label ?? projectWorkerKind
    : "";

  const resolvedTargetWorkerLabel = task.targetWorkerKind
    ? WORKER_KINDS.find((entry) => entry.kind === task.targetWorkerKind)?.label ?? task.targetWorkerKind
    : resolvedProjectWorkerLabel
      ? `跟随项目（${resolvedProjectWorkerLabel}）`
      : "跟随项目";

  const workerPickerColor = WORKER_KINDS.find((entry) => entry.kind === (task.targetWorkerKind ?? projectWorkerKind))?.color
    ?? "var(--color-primary)";

  const workerPickerItems: PopoverMenuItem[] = [
    { kind: "heading", label: "指定 Worker" },
    {
      kind: "item",
      key: "follow-project",
      label: resolvedProjectWorkerLabel ? `跟随项目（${resolvedProjectWorkerLabel}）` : "跟随项目",
      icon: "mingcute:link-line",
      checked: !task.targetWorkerKind,
      onSelect: () => onUpdateTargetWorkerKind?.(null),
    },
    ...WORKER_KINDS.map(({ kind, label }) => ({
      kind: "item" as const,
      key: `worker-${kind}`,
      label,
      iconNode: <WorkerLogo kind={kind} size={16} className="opacity-85" />,
      checked: task.targetWorkerKind === kind,
      onSelect: () => onUpdateTargetWorkerKind?.(kind),
    })),
  ];

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
        {primaryAction || canPickTargetWorker ? (
          <div className="mt-3 flex justify-start items-center gap-2 flex-wrap">
            {primaryAction ? (
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
            ) : null}
            {canPickTargetWorker ? (
              <PopoverMenu
                label="指定 Worker"
                icon="mingcute:ai-line"
                triggerText={resolvedTargetWorkerLabel}
                align="left"
                style={{ "--worker-color": workerPickerColor } as CSSProperties}
                items={workerPickerItems}
              />
            ) : null}
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
              <PopoverMenu
                label="Status Selector"
                triggerNode={
                  <span className={`ui-badge ui-badge--sm cursor-pointer hover:brightness-95 hover:-translate-y-px active:scale-[0.98] transition-all ${statusBadgeClass(task.status)}`}>
                    {task.status === "进行中" && (
                      <Icon icon="mingcute:loading-3-line" className="text-[11px] animate-spin opacity-80 mr-0.5" />
                    )}
                    {task.status}
                  </span>
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
                    onSelect: () => onUpdateTaskStatus?.(s as TaskStatus),
                  })),
                ]}
              />
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
                    const needsInfo = task.status === "需要更多信息"
                      ? parseNeedsInfoFormFromReport(report.content)
                      : null;
                    const reportContent = needsInfo?.contentWithoutSchema ?? report.content;
                    const parsed = parseTaskReport(reportContent);
                    const schema = needsInfo?.schema ?? null;
                    const values = needsInfoValuesByReportId[report.id] ?? {};
                    const errors = needsInfoErrorsByReportId[report.id] ?? {};
                    const canFill = task.status === "需要更多信息"
                      && Boolean(schema)
                      && typeof onUpdateDetails === "function"
                      && typeof onSetAsTodo === "function";
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
                            {parsed ? renderTaskMarkdown(parsed.description) : renderTaskMarkdown(reportContent)}
                          </div>
                        </div>

                        {task.status === "需要更多信息" ? (
                          schema ? (
                            <div className="mt-3 rounded-[12px] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] bg-(--color-base-100) px-3 py-2.5">
                              <div className="flex items-center gap-2 text-[12px] font-sans font-semibold text-(--color-base-content)">
                                <Icon icon="mingcute:edit-2-line" className="text-[16px] opacity-80" />
                                <span>补充信息</span>
                              </div>

                              <div className="mt-2 flex flex-col gap-2">
                                {schema.fields.map((field) => {
                                  const currentValue = values[field.id] ?? "";
                                  const fieldError = errors[field.id] ?? "";
                                  const label = field.required ? `${field.label} *` : field.label;

                                  return (
                                    <label key={field.id} className="flex flex-col gap-1.5">
                                      <span className="text-[12px] font-sans text-(--color-base-content) opacity-85">
                                        {label}
                                      </span>

                                      {field.type === "textarea" ? (
                                        <textarea
                                          className="ui-textarea font-sans"
                                          rows={3}
                                          value={currentValue}
                                          placeholder={field.placeholder ?? ""}
                                          onChange={(event) => updateNeedsInfoValue(report.id, field.id, event.currentTarget.value)}
                                        />
                                      ) : field.type === "select" && Array.isArray(field.options) && field.options.length > 0 ? (
                                        <select
                                          className="ui-input font-sans"
                                          value={currentValue}
                                          onChange={(event) => updateNeedsInfoValue(report.id, field.id, event.currentTarget.value)}
                                        >
                                          <option value="">请选择</option>
                                          {field.options.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                              {opt.label}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          type="text"
                                          className="ui-input font-sans"
                                          value={currentValue}
                                          placeholder={field.placeholder ?? ""}
                                          onChange={(event) => updateNeedsInfoValue(report.id, field.id, event.currentTarget.value)}
                                        />
                                      )}

                                      {fieldError ? (
                                        <span className="text-[11px] font-sans text-[color:var(--color-error)]">
                                          {fieldError}
                                        </span>
                                      ) : null}
                                    </label>
                                  );
                                })}
                              </div>

                              <div className="flex items-center gap-2 mt-3">
                                <button
                                  type="button"
                                  className="ui-btn ui-btn--sm ui-btn--accent gap-1"
                                  disabled={!canFill || needsInfoSubmitting}
                                  onClick={() => void handleNeedsInfoDone()}
                                  title={!canFill ? "当前视图不可写入详情" : undefined}
                                >
                                  <Icon
                                    icon={needsInfoSubmitting ? "mingcute:loading-3-line" : "mingcute:check-line"}
                                    className={`text-[16px] ${needsInfoSubmitting ? "animate-spin opacity-80" : ""}`.trim()}
                                  />
                                  填写完毕
                                </button>

                                <span className="text-xs text-muted ml-auto opacity-70">
                                  {schema.fields.some((field) => field.required) ? "带 * 为必填" : ""}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 rounded-[12px] border border-[color-mix(in_srgb,var(--color-base-300)_45%,transparent)] bg-(--color-base-100) px-3 py-2.5">
                              <div className="flex items-center gap-2 text-[12px] font-sans text-muted">
                                <Icon icon="mingcute:information-line" className="text-[16px] opacity-80" />
                                <span>此报告未包含可解析的表单。请在「详情」补充信息后，点击「填写完毕」。</span>
                              </div>
                            </div>
                          )
                        ) : null}
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

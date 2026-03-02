export type WorkerExecutionPromptInput = {
  projectName: string;
  directory: string;
  taskTitle: string;
  /**
   * Preferred language for user-visible outputs (reports/decisions/summaries).
   * Keep code/commands/paths as-is.
   */
  language?: "zh" | "en";
  workerKind?: "claude" | "codex" | "iflow" | string;
};

export type WorkerExecutionResultLike = {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

export type MapleWorkerSkill = {
  id: string;
  title: string;
  objective: string;
};

export const MAPLE_WORKER_SKILLS: MapleWorkerSkill[] = [
  { id: "implement", title: "实现变更", objective: "按任务目标完成代码与结构改动，避免临时兜底方案。" },
  { id: "verify", title: "验证结果", objective: "至少执行类型检查和构建，记录关键验证输出。" },
  { id: "summarize", title: "结果归档", objective: "汇总变更、影响范围与后续风险，便于回写任务系统。" }
];

export type MapleMcpDecisionStatus = "队列中" | "进行中" | "待返工" | "已完成" | "已阻塞" | "需要更多信息";

export type MapleMcpDecision = {
  status: MapleMcpDecisionStatus;
  comment: string;
  tags: string[];
};

export type MapleStructuredExecutionOutput = {
  conclusion: string;
  changes: string[];
  verification: string[];
  decision: MapleMcpDecision | null;
};

const FINAL_DECISION_STATUSES = ["已完成", "待返工", "已阻塞", "需要更多信息"] as const;
const OUTPUT_SCHEMA_HINT =
  `终端最后请输出一个 JSON 代码块（\`\`\`json ... \`\`\`），字段包含：conclusion, changes[], verification[], mcp_decision{status, comment, tags[]}。`
  + `mcp_decision.status 仅可用：${FINAL_DECISION_STATUSES.join(" / ")}。`
  + "mcp_decision.tags 可填写 0-5 个与任务相关的 tag。标签必须使用中文（如 bug修复、前端、重构、新功能），禁止使用英文标签（如 frontend、bugfix）。若引入新 tag，请先 upsert_tag_definition 提供 icon 与 zh/en label。";
const REQUIRED_DECISION_HINT = "若缺少 mcp_decision，则任务会被判定为已阻塞，不允许兜底标记完成。";
const REQUIRED_MCP_FLOW_HINT =
  "执行时必须逐条通过 submit_task_report 驱动状态流转：query_project_todos 后，选中要处理的任务先更新为「队列中」；真正开工再更新为「进行中」；结束后更新为「已完成/已阻塞/需要更多信息」。结束前再次 query_project_todos，确认无待办/待返工/队列中/进行中任务后，再调用 finish_worker（必须作为最后一个 MCP 调用）。";
const REQUIRED_TAG_CATALOG_HINT =
  "系统无任何内置 tag preset。所有 tag 的图标（icon，仅允许 mingcute:*）与多语言 label（label_zh / label_en）均由你负责定义。"
  + "在 submit_task_report 或 mcp_decision 中使用任何 tag 之前，必须先调用 upsert_tag_definition 创建或确认该 tag 的定义（含 icon 和 zh/en label）。"
  + "submit_task_report 的 tags 和 mcp_decision.tags 都必须使用中文标签。";

function renderSkillChecklist(skills: MapleWorkerSkill[]): string[] {
  return skills.map((skill, index) => `${index + 1}. ${skill.title}：${skill.objective}`);
}

export function createWorkerExecutionPrompt(input: WorkerExecutionPromptInput): string {
  const trigger = input.workerKind === "codex" ? "$maple" : "/maple";
  const language = input.language ?? "zh";

  const languageHint =
    language === "en"
      ? [
          "Preferred language: English.",
          "Requirement: all user-visible outputs must be in English (submit_task_report.report, mcp_decision.comment, conclusion/changes/verification, and explanations/errors).",
          "Allowed: keep code/commands/paths/identifiers unchanged."
        ].join("\n")
      : [
          "偏好语言：中文（简体）。",
          "要求：所有面向用户的输出必须使用中文（submit_task_report.report、mcp_decision.comment、conclusion/changes/verification，以及解释/报错）。",
          "允许：代码/命令/路径/标识符保持原样。"
        ].join("\n");

  return `${trigger}\n\n${languageHint}`;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return null;
}

function normalizeDecisionStatus(value: unknown): MapleMcpDecisionStatus | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "队列中" || raw === "queued" || raw === "queue") return "队列中";
  if (raw === "进行中" || raw === "in_progress" || raw === "in progress" || raw === "running") return "进行中";
  if (raw === "待返工" || raw === "rework" || raw === "redo" || raw === "revise") return "待返工";
  if (raw === "已完成" || raw === "done" || raw === "completed" || raw === "success") return "已完成";
  if (raw === "已阻塞" || raw === "blocked" || raw === "fail" || raw === "failed") return "已阻塞";
  if (raw === "需要更多信息" || raw === "need_more_info" || raw === "needs_info") return "需要更多信息";
  return null;
}

function parseDecisionFromRecord(record: Record<string, unknown>): MapleMcpDecision | null {
  const status = normalizeDecisionStatus(record.status);
  const comment = typeof record.comment === "string" ? record.comment.trim() : "";
  const tagsInput = normalizeList(record.tags ?? record.tag).map((tag) => tag.trim()).filter(Boolean);
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const tag of tagsInput) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 5) break;
  }
  if (!status || !comment) return null;
  return { status, comment, tags };
}

function parseStructuredExecution(text: string): MapleStructuredExecutionOutput | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const conclusion = typeof parsed.conclusion === "string" ? parsed.conclusion.trim() : "";
    const changes = normalizeList(parsed.changes);
    const verification = normalizeList(parsed.verification);

    let decision: MapleMcpDecision | null = null;
    if (parsed.mcp_decision && typeof parsed.mcp_decision === "object") {
      decision = parseDecisionFromRecord(parsed.mcp_decision as Record<string, unknown>);
    }
    if (!decision) {
      decision = parseDecisionFromRecord(parsed);
    }

    if (!conclusion && changes.length === 0 && verification.length === 0 && !decision) {
      return null;
    }
    return { conclusion, changes, verification, decision };
  } catch {
    return null;
  }
}

function stripAnsi(text: string): string {
  return text
    // CSI (Control Sequence Introducer)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    // OSC (Operating System Command)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function combinedWorkerOutput(result: WorkerExecutionResultLike): string {
  return stripAnsi([result.stdout, result.stderr].filter(Boolean).join("\n")).trim();
}

function tailExcerpt(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(trimmed.length - maxChars);
  const firstNewline = slice.indexOf("\n");
  if (firstNewline >= 0 && firstNewline < 80) {
    return slice.slice(firstNewline + 1).trimStart();
  }
  return slice.trimStart();
}

function looksLikeNeedsMoreInfo(output: string): boolean {
  const text = output.trim();
  if (!text) return false;

  const lower = text.toLowerCase();
  const signals = [
    // zh
    "需要更多信息",
    "需要了解更多",
    "需要补充",
    "请提供",
    "请补充",
    "请问",
    "能否提供",
    "麻烦提供",
    "缺少以下",
    // en
    "need more information",
    "need more info",
    "please provide",
    "could you",
    "can you provide",
  ];

  const hit = signals.some((signal) => lower.includes(signal));
  if (!hit) return false;

  const hasQuestionMark = text.includes("?") || text.includes("？");
  const hasList = /\n\s*(\d+\.|[-*]\s+)/.test(text);
  const hasQuestionHeader = /请问\s*[:：]/.test(text) || /questions?\s*[:：]/i.test(text);

  return hasQuestionMark || hasList || hasQuestionHeader || lower.includes("please provide") || lower.includes("请提供");
}

export function inferFallbackTaskStatus(result: WorkerExecutionResultLike): MapleMcpDecisionStatus {
  if (!result.success) return "已阻塞";
  const output = combinedWorkerOutput(result);
  if (looksLikeNeedsMoreInfo(output)) return "需要更多信息";
  return "待返工";
}

export function parseWorkerExecutionResult(result: WorkerExecutionResultLike): MapleStructuredExecutionOutput | null {
  const stdout = stripAnsi(result.stdout).trim();
  const stderr = stripAnsi(result.stderr).trim();
  return parseStructuredExecution(stdout) ?? parseStructuredExecution(stderr);
}

export function resolveMcpDecision(result: WorkerExecutionResultLike): MapleMcpDecision | null {
  const structured = parseWorkerExecutionResult(result);
  return structured?.decision ?? null;
}

export function buildWorkerArchiveReport(result: WorkerExecutionResultLike, taskTitle: string): string {
  const structured = parseWorkerExecutionResult(result);
  const output = combinedWorkerOutput(result);
  const rawExcerpt = tailExcerpt(output, 320);

  const reportLines: string[] = [];
  const statusLine = result.success
    ? "状态：已阻塞（未收到 MCP 回写）"
    : "状态：已阻塞（执行失败）";

  reportLines.push(statusLine);
  reportLines.push("描述：");

  const conclusion = structured?.conclusion?.trim();
  const baseDescription = result.success
    ? "Worker 已退出，但未通过 MCP 提交任务状态与报告。"
    : "Worker 执行失败，且未通过 MCP 提交任务状态与报告。";

  reportLines.push(
    [
      baseDescription,
      conclusion ? `\n\n结论：\n${conclusion}` : taskTitle.trim() ? `\n\n任务：\n${taskTitle.trim()}` : "",
      result.code != null ? `\n\nExit code：${result.code}` : "",
      rawExcerpt ? `\n\n输出摘录（末尾）：\n${rawExcerpt}` : "",
    ].join("").trim()
  );

  if (structured?.changes?.length) {
    reportLines.push("");
    reportLines.push("变更：");
    reportLines.push(...structured.changes.map((item) => `- ${item}`));
  }

  if (structured?.verification?.length) {
    reportLines.push("");
    reportLines.push("验证：");
    reportLines.push(...structured.verification.map((item) => `- ${item}`));
  }

  return reportLines.join("\n");
}

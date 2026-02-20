export type WorkerExecutionPromptInput = {
  projectName: string;
  directory: string;
  taskTitle: string;
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

export type MapleMcpDecisionStatus = "队列中" | "进行中" | "已完成" | "已阻塞" | "需要更多信息";

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

const TAG_OPTIONS = ["架构", "配置", "UI", "修复"] as const;
const OUTPUT_SCHEMA_HINT = `终端最后请输出一个 JSON 代码块（\`\`\`json ... \`\`\`），字段包含：conclusion, changes[], verification[], mcp_decision{status, comment, tags[]}。tags 仅可用：${TAG_OPTIONS.join(" / ")}。`;
const REQUIRED_DECISION_HINT = "若缺少 mcp_decision，则任务会被判定为已阻塞，不允许兜底标记完成。";

function renderSkillChecklist(skills: MapleWorkerSkill[]): string[] {
  return skills.map((skill, index) => `${index + 1}. ${skill.title}：${skill.objective}`);
}

export function createWorkerExecutionPrompt(input: WorkerExecutionPromptInput): string {
  return [
    "[Maple Worker Task]",
    `Project: ${input.projectName}`,
    `Directory: ${input.directory}`,
    `Task: ${input.taskTitle}`,
    "先在会话中加载 Maple 能力：非 Codex 输入 `/maple`，Codex 输入 `$maple`。",
    "随后按任务完成实现与验证。",
    REQUIRED_DECISION_HINT,
    OUTPUT_SCHEMA_HINT
  ].join("\n");
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
  if (raw === "已完成" || raw === "done" || raw === "completed" || raw === "success") return "已完成";
  if (raw === "已阻塞" || raw === "blocked" || raw === "fail" || raw === "failed") return "已阻塞";
  if (raw === "需要更多信息" || raw === "need_more_info" || raw === "needs_info") return "需要更多信息";
  return null;
}

function normalizeDecisionTag(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("架构") || normalized.includes("arch")) return "架构";
  if (normalized.includes("配置") || normalized.includes("config") || normalized.includes("env")) return "配置";
  if (normalized.includes("ui") || normalized.includes("ux") || normalized.includes("界面") || normalized.includes("交互")) return "UI";
  if (normalized.includes("修复") || normalized.includes("bug") || normalized.includes("fix") || normalized.includes("错误")) return "修复";
  return null;
}

function parseDecisionFromRecord(record: Record<string, unknown>): MapleMcpDecision | null {
  const status = normalizeDecisionStatus(record.status);
  const comment = typeof record.comment === "string" ? record.comment.trim() : "";
  const tags = [
    ...new Set(
      normalizeList(record.tags ?? record.tag)
        .map((tag) => normalizeDecisionTag(tag))
        .filter((tag): tag is string => Boolean(tag))
    )
  ].slice(0, 5);
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
  const decision = structured?.decision ?? null;

  if (!structured || !decision) {
    const raw = (result.stdout.trim() || result.stderr.trim()).slice(0, 200);
    return [
      "状态：已阻塞（缺少 MCP 决策输出）",
      "描述：",
      `Worker 未返回可解析的 mcp_decision。${raw ? `\n\n输出摘录：\n${raw}` : ""}`.trim()
    ].join("\n");
  }

  const statusDetail =
    decision.status === "已完成"
      ? "已完成（执行成功）"
      : decision.status === "进行中"
        ? "进行中（等待继续处理）"
        : decision.status === "队列中"
          ? "队列中（等待执行）"
          : decision.status === "需要更多信息"
            ? "需要更多信息（请补充后继续）"
            : "已阻塞（执行受阻）";

  const description = decision.comment.trim() || taskTitle;

  return [
    "状态：" + statusDetail,
    "描述：",
    description
  ].join("\n");
}

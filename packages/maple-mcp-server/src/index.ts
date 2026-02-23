#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Types ──

type TaskStatus = "草稿" | "待办" | "待返工" | "队列中" | "进行中" | "需要更多信息" | "已完成" | "已阻塞";

type TaskReport = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
};

type TagDefinition = {
  color?: string;
  icon?: string;
  label?: {
    zh?: string;
    en?: string;
  };
};

type TagCatalog = Record<string, TagDefinition>;

type Task = {
  id: string;
  title: string;
  details: string;
  status: TaskStatus;
  tags: string[];
  version: string;
  createdAt: string;
  updatedAt: string;
  reports: TaskReport[];
};

type Project = {
  id: string;
  name: string;
  version: string;
  directory: string;
  workerKind?: string;
  tasks: Task[];
  tagCatalog?: TagCatalog;
};

const TERMINAL_TASK_STATUSES: TaskStatus[] = ["已完成", "已阻塞", "需要更多信息"];
const TERMINAL_TASK_STATUS_SET = new Set<TaskStatus>(TERMINAL_TASK_STATUSES);

function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUS_SET.has(status);
}

// ── State File ──

const STATE_DIR = join(homedir(), ".maple");
const STATE_FILE = join(STATE_DIR, "state.json");

function readState(): Project[] {
  if (!existsSync(STATE_FILE)) return [];
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeState(projects: Project[]): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(projects, null, 2), "utf-8");
}

function findProject(projects: Project[], name: string): Project | undefined {
  const keyword = name.trim().toLowerCase();
  if (!keyword) return undefined;
  return (
    projects.find((p) => p.name.toLowerCase() === keyword) ??
    projects.find((p) => p.name.toLowerCase().includes(keyword))
  );
}

function normalizeTagId(value: string): string {
  return value.trim().toLowerCase();
}

function isValidMingcuteIcon(icon: string): boolean {
  return icon.trim().toLowerCase().startsWith("mingcute:");
}

// ── MCP Server ──

const server = new McpServer({
  name: "maple",
  version: "0.1.0",
});

server.tool(
  "query_project_todos",
  "按项目名查询未完成任务，返回状态、标签与详情内容。",
  { project: z.string().describe("项目名称（模糊匹配）") },
  async ({ project }) => {
    const projects = readState();
    const target = findProject(projects, project);
    if (!target) {
      return {
        content: [{ type: "text" as const, text: `未找到匹配项目「${project}」。可用项目：${projects.map((p) => p.name).join("、") || "（无）"}` }],
      };
    }
    const todos = target.tasks
      .filter((t) => t.status !== "已完成")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (todos.length === 0) {
      return {
        content: [{ type: "text" as const, text: `项目「${target.name}」暂无未完成任务。` }],
      };
    }
    const lines = todos.map((t, i) => {
      const tags = t.tags.length ? ` [${t.tags.join(", ")}]` : "";
      const title = t.title?.trim() ? t.title : "（无标题）";
      const details = (t.details ?? "").trim();
      const detailsText = details.length > 0 ? details : "（空）";
      return [
        `${i + 1}. [${t.status}] ${title}${tags}  (id: ${t.id})`,
        "详情：",
        detailsText,
      ].join("\n");
    });
    return {
      content: [{ type: "text" as const, text: `项目「${target.name}」— ${todos.length} 个未完成任务：\n\n${lines.join("\n\n---\n\n")}` }],
    };
  }
);

server.tool(
  "query_recent_context",
  "查询最近任务报告，支持项目名和关键词过滤。",
  {
    project: z.string().optional().describe("项目名称（可选，模糊匹配）"),
    keyword: z.string().optional().describe("搜索关键词（可选）"),
    limit: z.number().optional().default(10).describe("最多返回条数"),
  },
  async ({ project, keyword, limit }) => {
    const projects = readState();
    const filtered = project ? [findProject(projects, project)].filter(Boolean) as Project[] : projects;

    type ContextItem = { project: string; task: string; createdAt: string; text: string };
    const items: ContextItem[] = [];

    for (const p of filtered) {
      for (const task of p.tasks) {
        for (const report of task.reports) {
          const content = report.content.trim();
          if (!content) continue;
          if (keyword && !content.toLowerCase().includes(keyword.toLowerCase())) continue;
          items.push({
            project: p.name,
            task: task.title,
            createdAt: report.createdAt,
            text: content,
          });
        }
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const result = items.slice(0, Math.max(1, limit ?? 10));

    if (result.length === 0) {
      return {
        content: [{ type: "text" as const, text: "未找到匹配的任务报告。" }],
      };
    }

    const lines = result.map((item) =>
      `[${item.project}] ${item.task}\n  时间：${item.createdAt}\n  内容：${item.text.slice(0, 200)}`
    );
    return {
      content: [{ type: "text" as const, text: lines.join("\n\n") }],
    };
  }
);

server.tool(
  "query_task_details",
  "查询指定任务的详情内容（包含 markdown、图片、文件引用等）。",
  {
    project: z.string().describe("项目名称（模糊匹配）"),
    task_id: z.string().describe("任务 ID"),
  },
  async ({ project, task_id }) => {
    const projects = readState();
    const target = findProject(projects, project);
    if (!target) {
      return {
        content: [{ type: "text" as const, text: `未找到匹配项目「${project}」。` }],
        isError: true,
      };
    }

    const task = target.tasks.find((t) => t.id === task_id);
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `项目「${target.name}」中未找到任务 ID「${task_id}」。` }],
        isError: true,
      };
    }

    const tags = task.tags.length > 0 ? task.tags.join("、") : "（无）";
    const details = (task.details ?? "").trim();
    const detailsText = details.length > 0 ? details : "（空）";

    return {
      content: [
        {
          type: "text" as const,
          text: [
            `任务：${task.title || "（无标题）"}  (id: ${task.id})`,
            `状态：${task.status}`,
            `标签：${tags}`,
            `版本：${task.version}`,
            `更新时间：${task.updatedAt}`,
            "",
            "详情：",
            detailsText,
          ].join("\n"),
        },
      ],
    };
  }
);

server.tool(
  "submit_task_report",
  "提交任务执行报告，并可修改任务状态。",
  {
    project: z.string().describe("项目名称"),
    task_id: z.string().describe("任务 ID"),
    status: z.enum(["草稿", "待办", "待返工", "队列中", "进行中", "需要更多信息", "已完成", "已阻塞"]).optional().describe("新状态（可选）"),
    report: z.string().describe("报告内容"),
    tags: z.array(z.string()).optional().describe("标签列表（可选，0-5 个）"),
  },
  async ({ project, task_id, status, report, tags }) => {
    const projects = readState();
    const target = findProject(projects, project);
    if (!target) {
      return {
        content: [{ type: "text" as const, text: `未找到匹配项目「${project}」。` }],
        isError: true,
      };
    }

    const task = target.tasks.find((t) => t.id === task_id);
    if (!task) {
      return {
        content: [{ type: "text" as const, text: `项目「${target.name}」中未找到任务 ID「${task_id}」。` }],
        isError: true,
      };
    }

    const now = new Date().toISOString();
    const newReport: TaskReport = {
      id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      author: "mcp",
      content: report,
      createdAt: now,
    };

    task.reports.push(newReport);
    task.updatedAt = now;
    if (status) task.status = status;
    if (tags && tags.length > 0) task.tags = tags.slice(0, 5);

    writeState(projects);

    const statusText = status ? `状态已更新为「${status}」` : "状态未变更";
    return {
      content: [{ type: "text" as const, text: `已提交报告至「${target.name}」任务「${task.title}」。${statusText}。` }],
    };
  }
);

server.tool(
  "query_tag_catalog",
  "查询项目 Tag Catalog（标签定义：颜色/图标/多语言 label）。",
  {
    project: z.string().describe("项目名称（模糊匹配）"),
  },
  async ({ project }) => {
    const projects = readState();
    const target = findProject(projects, project);
    if (!target) {
      return {
        content: [{ type: "text" as const, text: `未找到匹配项目「${project}」。` }],
        isError: true,
      };
    }

    const catalog = target.tagCatalog ?? {};
    const entries = Object.entries(catalog);
    if (entries.length === 0) {
      return {
        content: [{ type: "text" as const, text: `项目「${target.name}」暂无 Tag Catalog。` }],
      };
    }

    const lines = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, def]) => {
        const color = def.color?.trim() ? def.color.trim() : "（未设置）";
        const icon = def.icon?.trim() ? def.icon.trim() : "（未设置）";
        const labelZh = def.label?.zh?.trim() ? def.label.zh.trim() : "（未设置）";
        const labelEn = def.label?.en?.trim() ? def.label.en.trim() : "（未设置）";
        return `- ${tag}  color: ${color}  icon: ${icon}  label.zh: ${labelZh}  label.en: ${labelEn}`;
      });

    return {
      content: [{ type: "text" as const, text: `项目「${target.name}」Tag Catalog：\n${lines.join("\n")}` }],
    };
  }
);

server.tool(
  "upsert_tag_definition",
  "创建或更新 Tag 定义（用于 UI 渲染颜色/图标/多语言 label）。",
  {
    project: z.string().describe("项目名称（模糊匹配）"),
    tag: z.string().describe("Tag ID（会被 trim + lower-case 归一化）"),
    color: z.string().optional().describe("CSS 颜色（例如 #22c55e / hsl(...) / var(--color-primary)）"),
    icon: z.string().optional().describe("Iconify 图标（仅允许 mingcute 集，例如 mingcute:tag-line）"),
    label_zh: z.string().optional().describe("中文展示名（可选）"),
    label_en: z.string().optional().describe("英文展示名（可选）"),
  },
  async ({ project, tag, color, icon, label_zh, label_en }) => {
    const projects = readState();
    const target = findProject(projects, project);
    if (!target) {
      return {
        content: [{ type: "text" as const, text: `未找到匹配项目「${project}」。` }],
        isError: true,
      };
    }

    const tagId = normalizeTagId(tag);
    if (!tagId) {
      return {
        content: [{ type: "text" as const, text: "tag 不能为空。" }],
        isError: true,
      };
    }

    if (icon?.trim() && !isValidMingcuteIcon(icon)) {
      return {
        content: [{ type: "text" as const, text: "icon 必须是 Iconify 的 mingcute 图标（例如 mingcute:tag-line）。" }],
        isError: true,
      };
    }

    target.tagCatalog ??= {};
    const existing = target.tagCatalog[tagId] ?? {};
    const next: TagDefinition = { ...existing };

    if (typeof color === "string" && color.trim()) next.color = color.trim();
    if (typeof icon === "string" && icon.trim()) next.icon = icon.trim().toLowerCase();

    if (typeof label_zh === "string" || typeof label_en === "string") {
      const label: NonNullable<TagDefinition["label"]> = { ...(existing.label ?? {}) };
      if (label_zh?.trim()) label.zh = label_zh.trim();
      if (label_en?.trim()) label.en = label_en.trim();
      next.label = Object.keys(label).length > 0 ? label : undefined;
    }

    target.tagCatalog[tagId] = next;
    writeState(projects);

    return {
      content: [{ type: "text" as const, text: `已更新「${target.name}」Tag「${tagId}」定义。` }],
    };
  }
);

// ── Start ──

const SIGNAL_FILE = join(STATE_DIR, "worker-signal.json");

server.tool(
  "finish_worker",
  "通知 Maple 当前 Worker 已执行完毕。调用前必须确保项目内无草稿/待办/待返工/队列中/进行中任务。",
  {
    project: z.string().describe("项目名称"),
    summary: z.string().optional().describe("执行总结（可选）"),
  },
  async ({ project, summary }) => {
    const projects = readState();
    const target = findProject(projects, project);
    if (!target) {
      return {
        content: [{ type: "text" as const, text: `未找到匹配项目「${project}」。` }],
        isError: true,
      };
    }

    const unresolvedTasks = target.tasks.filter((task) => !isTerminalTaskStatus(task.status));
    if (unresolvedTasks.length > 0) {
      const lines = unresolvedTasks.map((task, index) => (
        `${index + 1}. [${task.status}] ${task.title}  (id: ${task.id})`
      ));
      return {
        content: [{
          type: "text" as const,
          text: [
            `项目「${target.name}」仍有 ${unresolvedTasks.length} 个任务未收敛，禁止 finish_worker。`,
            "请先对每条任务调用 submit_task_report，将状态更新为：已完成 / 已阻塞 / 需要更多信息。",
            "",
            ...lines
          ].join("\n")
        }],
        isError: true,
      };
    }

    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
    const signal = {
      project: target.name,
      summary: summary ?? "",
      timestamp: new Date().toISOString(),
      action: "finish" as const,
    };
    writeFileSync(SIGNAL_FILE, JSON.stringify(signal, null, 2), "utf-8");
    return {
      content: [{ type: "text" as const, text: `已通知 Maple 项目「${target.name}」的 Worker 执行完毕。` }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`Maple MCP Server 启动失败: ${error}\n`);
  process.exit(1);
});

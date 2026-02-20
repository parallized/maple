#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Types ──

type TaskStatus = "待办" | "队列中" | "进行中" | "需要更多信息" | "已完成" | "已阻塞";

type TaskReport = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
};

type Task = {
  id: string;
  title: string;
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
};

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

// ── MCP Server ──

const server = new McpServer({
  name: "maple",
  version: "0.1.0",
});

server.tool(
  "query_project_todos",
  "按项目名查询未完成任务，返回状态、更新时间与标签。",
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
      return `${i + 1}. [${t.status}] ${t.title}${tags}  (id: ${t.id})`;
    });
    return {
      content: [{ type: "text" as const, text: `项目「${target.name}」— ${todos.length} 个未完成任务：\n\n${lines.join("\n")}` }],
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
  "submit_task_report",
  "提交任务执行报告，并可修改任务状态。",
  {
    project: z.string().describe("项目名称"),
    task_id: z.string().describe("任务 ID"),
    status: z.enum(["待办", "队列中", "进行中", "需要更多信息", "已完成", "已阻塞"]).optional().describe("新状态（可选）"),
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

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`Maple MCP Server 启动失败: ${error}\n`);
  process.exit(1);
});

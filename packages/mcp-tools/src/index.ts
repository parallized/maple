export type McpTodoTaskLike = {
  title: string;
  status: string;
  updatedAt: string;
  tags: string[];
};

export type McpTodoProjectLike<TTask extends McpTodoTaskLike = McpTodoTaskLike> = {
  name: string;
  tasks: TTask[];
};

export type McpTaskReportLike = {
  content: string;
  createdAt: string;
};

export type McpContextTaskLike<TReport extends McpTaskReportLike = McpTaskReportLike> = {
  title: string;
  reports: TReport[];
};

export type McpContextProjectLike<TTask extends McpContextTaskLike = McpContextTaskLike> = {
  name: string;
  tasks: TTask[];
};

export type MapleMcpTodoItem = {
  title: string;
  status: string;
  updatedAt: string;
  tags: string[];
};

export type MapleMcpToolDefinition = {
  name: "query_project_todos" | "query_task_details" | "query_recent_context";
  description: string;
};

export const MAPLE_MCP_TOOLS: MapleMcpToolDefinition[] = [
  {
    name: "query_project_todos",
    description: "按项目名查询未完成任务，返回状态、标签与详情内容。"
  },
  {
    name: "query_task_details",
    description: "查询指定任务的详情内容（包含 markdown、图片、文件引用等）。"
  },
  {
    name: "query_recent_context",
    description: "查询最近任务报告与 Worker 日志，支持关键词过滤。"
  }
];

export type MapleMcpContextItem = {
  project: string;
  source: "report" | "worker_log";
  taskTitle: string;
  createdAt: string;
  text: string;
};

export function queryProjectTodos<TProject extends McpTodoProjectLike>(
  projects: TProject[],
  projectName: string
): MapleMcpTodoItem[] {
  const keyword = projectName.trim().toLowerCase();
  if (!keyword) return [];
  const target = projects.find((project) => project.name.toLowerCase() === keyword)
    ?? projects.find((project) => project.name.toLowerCase().includes(keyword));
  if (!target) return [];
  return target.tasks
    .filter((task) => task.status !== "已完成")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((task) => ({
      title: task.title || "(无标题)",
      status: task.status,
      updatedAt: task.updatedAt,
      tags: task.tags
    }));
}

export function queryRecentContext<TProject extends McpContextProjectLike>(
  projects: TProject[],
  workerLogs: Record<string, string>,
  keyword: string,
  limit = 10
): MapleMcpContextItem[] {
  const needle = keyword.trim().toLowerCase();
  const items: MapleMcpContextItem[] = [];

  for (const project of projects) {
    for (const task of project.tasks) {
      for (const report of task.reports) {
        const content = report.content.trim();
        if (!content) continue;
        if (needle && !content.toLowerCase().includes(needle)) continue;
        items.push({
          project: project.name,
          source: "report",
          taskTitle: task.title || "(无标题)",
          createdAt: report.createdAt,
          text: content
        });
      }
    }
  }

  const now = new Date().toISOString();
  for (const [workerId, log] of Object.entries(workerLogs)) {
    const lines = log
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const recent = lines.slice(Math.max(0, lines.length - 60));
    for (const line of recent) {
      if (needle && !line.toLowerCase().includes(needle)) continue;
      items.push({
        project: "console",
        source: "worker_log",
        taskTitle: workerId,
        createdAt: now,
        text: line
      });
    }
  }

  return items
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, Math.max(1, limit));
}

export function getMapleMcpToolHelpText(): string {
  const lines = ["Maple MCP Tools:"];
  for (const tool of MAPLE_MCP_TOOLS) {
    lines.push(`- ${tool.name}: ${tool.description}`);
  }
  return lines.join("\n");
}

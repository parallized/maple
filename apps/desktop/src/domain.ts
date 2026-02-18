export type ViewKey = "overview" | "board" | "progress";
export type WorkerKind = "claude" | "codex" | "iflow";
export type TaskStatus = "待办" | "队列中" | "进行中" | "已完成" | "已阻塞";
export type DetailMode = "sidebar" | "modal";

export type Worker = {
  id: string;
  kind: WorkerKind;
  label: string;
  busy: boolean;
  projectId?: string;
};

export type WorkerConfig = {
  executable: string;
  runArgs: string;
  probeArgs: string;
};

export type McpServerConfig = {
  executable: string;
  args: string;
  cwd: string;
  autoStart: boolean;
};

export type WorkerCommandResult = {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
};

export type WorkerLogEvent = {
  workerId: string;
  taskTitle: string;
  stream: "stdout" | "stderr";
  line: string;
};

export type WorkerDoneEvent = {
  workerId: string;
  success: boolean;
  code: number | null;
};

export type McpServerStatus = {
  running: boolean;
  pid: number | null;
  command: string;
};

export type TaskReport = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
};

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  tags: string[];
  version: string;
  createdAt: string;
  updatedAt: string;
  reports: TaskReport[];
};

export type Project = {
  id: string;
  name: string;
  version: string;
  directory: string;
  workerId?: string;
  tasks: Task[];
};

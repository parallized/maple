# Maple

Maple 是一个面向本地工程的 AI 任务工作台：你把任务放进来，选择一个 Worker（Claude / Codex / iFlow），Maple 会在你的项目目录中执行变更、记录验证，并用统一的任务状态把流程收敛起来。

## 快速开始（桌面版）

1. 打开 Maple Desktop，创建项目并选择你的代码目录。
2. 进入「概览 → Worker 配置」，选择一个 Worker。

![Worker 配置](docs/assets/worker-config.png)

### Worker 选择建议

- 国外模型：Claude（Opus 4.6）> GPT‑5.2 > GPT‑5.3 Codex
- 国内模型：建议安装 iFlow 后选择 GLM‑5

### 安装 CLI

在 Worker 卡片点击「安装 CLI」，复制命令到终端执行。
安装完成后，点击按钮右侧的「刷新」重新检测。

### 安装 MCP

当 CLI 已检测到后，点击「安装 MCP」完成注册：

- Maple 会为对应 Worker 写入 skills/commands 配置
- 并注册内置 MCP 服务：`http://localhost:45819/mcp`
- Windows 上若出现系统授权弹窗，请允许继续（仅在需要时触发）

### 执行任务

1. 在看板里新建任务并设为「待办」
2. 点击「执行待办」开始执行
3. 若任务进入「需要更多信息」，补充详情后点击「已补充信息」将其恢复为「待办」

## 常见问题

- **CLI 未检测到**：确认已安装，并在 Worker 卡片点击「刷新」
- **Windows / WSL**：若在 WSL 安装 CLI，请在对应 Worker 的 WSL 行安装 MCP
- **已阻塞需要继续处理**：在任务详情页点击「返工」，将任务标记为「待返工」再继续执行

## 开发（本仓库）

### Workspace layout

- `apps/desktop`: Maple 桌面端（Tauri + React）
- `apps/homepage`: 产品主页（Vite + React + Tailwind）
- `packages/kanban-core`: 任务域模型与状态工具
- `packages/agent-runtime`: 多 Worker 执行接口
- `packages/worker-skills`: Worker Prompt/Skill 模板与解析
- `docs`: 产品与技术文档

### Quick start

1. Install `pnpm` (v9 or newer).
2. Run `pnpm install`.
3. Run `pnpm typecheck`.

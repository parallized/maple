# Maple 竞品对比与商业化判断（2026-02-19）

## 范围

本对比聚焦「AI 驱动的软件研发任务执行」场景，比较对象：

1. Maple（当前项目）
2. NPT + Notion（任务中枢 + 执行辅助）
3. Linear
4. Vibe Kanban
5. Jira

## 结论先行

- Maple 的核心机会不在「通用项目管理」，而在「AI Worker 编排 + 本地执行闭环 + 开发工作台体验」。
- 与 NPT+Notion、Linear、Jira 相比，Maple 更适合做“AI 研发执行层”；这些产品更偏“任务系统/协作系统”。
- 与 Vibe Kanban 相比，Maple 仍有可行商业空间，但要尽快强化差异：
  - 更稳定的本地执行与验证链路
  - 更清晰的 Worker 治理和可观测性
  - 更低学习成本的一键接入体验
- 商业化价值：`有`。前提是明确定位为「AI 工程执行平台」而非通用 PM 工具。

## 对比矩阵（面向 AI 研发执行）

| 维度 | Maple | NPT + Notion | Linear | Vibe Kanban | Jira |
|---|---|---|---|---|---|
| AI Worker 执行闭环 | 强（本地 MCP + Skills + 执行验证） | 中（依赖 Notion 任务流转） | 中（支持 AI/Agent 与集成，但非本地主执行） | 强（多 Agent 编排） | 中（自动化强，但 AI coding 执行非核心） |
| 多 Agent 编排 | 中（已支持多 Worker，待继续增强） | 弱 | 中 | 强（明确主打多 Agent） | 弱-中 |
| 本地隔离执行 | 中-强（桌面端/本地链路） | 弱 | 弱 | 强（文档强调 worktree 隔离） | 弱 |
| PM/流程成熟度 | 中 | 中 | 强 | 中 | 很强 |
| 企业治理/审计 | 中（待补齐） | 中（借 Notion） | 强（高阶计划+安全） | 中（快速迭代中） | 很强（权限/审计/SLA） |
| 上手与速度 | 强（可做一键安装） | 中（组合链路） | 强 | 中 | 弱-中（配置复杂） |
| 市场教育成本 | 中 | 低 | 低 | 中 | 低 |

## 分项对比

### 1) Maple vs NPT + Notion

- Maple 优势：
  - 主链路可独立运行，不依赖外部任务系统。
  - 更靠近开发执行现场（Worker、控制台、验证、结果闭环）。
- NPT + Notion 优势：
  - 协作与信息组织成熟，非研发人员更容易参与。
  - 已有 Notion 生态，跨团队协同成本低。
- 判断：
  - NPT + Notion 适合“任务中枢”。
  - Maple 更应聚焦“执行引擎/研发工作台”。

### 2) Maple vs Linear

- Linear 优势（成熟 PM 与产品团队协同）：
  - Cycles、Triage、Projects、Insights 等产品化程度高。
  - 定价与分层成熟，团队扩展路径清晰。
- Maple 优势：
  - 更贴近 AI coding 实操链路（本地 Worker 执行与验证）。
  - 可在开发者工作环境内完成任务到代码的闭环。
- 判断：
  - Linear 是强协作与规划系统；Maple 应避免正面做“另一个 Linear”。

### 3) Maple vs Vibe Kanban

- Vibe Kanban 优势（直接竞品）：
  - 明确主打 AI agent orchestration。
  - 已覆盖大量 coding agents，并强调 worktree 隔离。
  - 已推进 Cloud 形态与团队协作能力。
- Maple 机会：
  - 以“更轻的一键接入 + 更可控本地链路 + 更清晰执行验收标准”形成差异。
  - 强化面向中文团队与本地化开发习惯的产品体验。
- 判断：
  - 存在直接竞争，但赛道仍在早期，高速演化期可通过执行体验胜出。

### 4) Maple vs Jira

- Jira 优势：
  - 企业级治理、权限、审计、流程模板和生态最成熟。
  - 大型组织标准化流程能力强。
- Maple 优势：
  - 更轻、更快、更接近“AI 代理执行”而非传统流程管理。
- 判断：
  - Jira 适合组织级流程治理；Maple 更适合工程团队的高频执行层。

## 商业化价值判断

结论：`有商业化价值`，但要避免产品定位漂移。

### 推荐定位

- 产品定位：`AI 工程执行平台（AI-native dev execution layer）`
- 核心人群：
  - 10~200 人的产品研发团队
  - 已使用 Claude/Codex/Gemini 等 coding agents 的团队
  - 对“任务到代码落地速度”敏感的团队

### 可收费能力（优先级）

1. 多 Agent 并发编排与策略路由
2. 执行可观测性（日志、决策、重试、失败归因）
3. 团队级治理（权限、审计、策略模板）
4. 企业集成（Git、工单、知识库、IM）

### 风险

1. 与既有 PM 工具重叠导致定位模糊
2. 大模型能力快速变化带来的功能同质化
3. 若缺少可靠执行与验收闭环，容易沦为“又一个看板”

## 参考来源

- Linear Pricing: https://linear.app/pricing
- Linear Docs（Team/Cycle/Workflow/Billing）:
  - https://linear.app/docs/default-views
  - https://linear.app/docs/use-cycles
  - https://linear.app/docs/configuring-workflows
  - https://linear.app/docs/billing-and-plans
- Jira Pricing / Plan:
  - https://www.atlassian.com/software/jira/pricing
  - https://support.atlassian.com/jira-cloud-administration/docs/explore-jira-cloud-plans/
  - https://support.atlassian.com/subscriptions-and-billing/docs/service-level-agreement-for-atlassian-cloud-products/
- Vibe Kanban:
  - https://github.com/BloopAI/vibe-kanban
  - https://www.vibekanban.com/docs
  - https://www.vibekanban.com/docs/supported-coding-agents
  - https://www.vibekanban.com/docs/getting-started
  - https://www.vibekanban.com/blog/introducing-vibe-kanban-cloud
  - https://www.vibekanban.com/docs/integrations/vibe-kanban-mcp-server
- Notion Pricing / Tasks & Dependencies:
  - https://www.notion.com/pricing
  - https://www.notion.com/help/tasks-and-dependencies

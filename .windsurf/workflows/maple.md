# /maple

当用户输入 `/maple` 时，按以下流程执行：

1. 在当前项目根目录执行，使用 Maple MCP + Maple Skills 作为唯一执行链路。
2. 先调用 Maple MCP 查询能力获取任务与上下文：
   - `query_project_todos`：拉取当前项目未完成任务（按更新时间倒序）。
   - `query_recent_context`：拉取近期报告与 Worker 日志上下文（可按关键词过滤）。
3. 对每条任务执行端到端实现：代码修改、类型检查、构建校验。
4. 仅通过 Maple Skills 的 MCP 决策输出决定任务结果：
   - 必须产出 `mcp_decision.status`、`mcp_decision.comment`、`mcp_decision.tags[]`。
   - 缺少 `mcp_decision` 时，不得标记完成，统一标记为阻塞并说明原因。
5. 输出本轮执行汇总（已完成 / 需更多信息 / 已阻塞 / 剩余）。

输出语言默认使用中文，除非用户明确要求其他语言。

# /maple

当用户输入 `/maple` 时，按以下流程执行：

1. 在当前项目根目录执行 NPT 同步（等价于运行 `npt` / `npt sync`）。
2. 仅通过 MCP/Skills 输出决定任务结果：
   - 必须产出 `mcp_decision.status`、`mcp_decision.comment`、`mcp_decision.tags[]`。
   - 缺少 `mcp_decision` 时，不得标记完成，统一标记为阻塞并说明原因。
3. 对每条任务执行端到端实现：代码修改、类型检查、构建校验。
4. 把结果写回 Maple TODO（评论 + 标签 + 状态），并更新会话日志。

输出语言默认使用中文，除非用户明确要求其他语言。

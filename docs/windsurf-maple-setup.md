# Windsurf 接入 Maple MCP/Skills

## 目标

- 在 Windsurf 中接入 Notion MCP。
- 启用仓库内的 `/maple` 工作流命令。
- 让任务完成判定由 `mcp_decision` 输出决定（无兜底自动完成）。

## 1) 配置 Windsurf MCP

在本机创建或更新 `~/.codeium/windsurf/mcp_config.json`：

```json
{
  "mcpServers": {
    "notion": {
      "serverUrl": "https://mcp.notion.com/mcp"
    }
  }
}
```

完成后重启 Windsurf，并在 Windsurf 中完成 Notion 授权登录。

## 2) 启用 /maple 工作流

本仓库已提供工作流文件：

- `.windsurf/workflows/maple.md`

Windsurf 会把 `maple.md` 映射为 `/maple` 命令。重启或刷新工作区后可直接使用。

## 3) 使用方式

在 Windsurf 聊天中输入：

```text
/maple
```

执行过程会触发 NPT 同步流程，自动发现并执行 Maple TODO。

## 4) 判定规则（已生效）

- Worker 输出必须包含 `mcp_decision.status/comment/tags[]`。
- 若缺少 `mcp_decision`，任务会被标记为 `已阻塞`，不会兜底为 `已完成`。
- 标签与结论记录仅采用 `mcp_decision` 结果。

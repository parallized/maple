# Windsurf 接入 Maple MCP/Skills

## 目标

- 在 Windsurf 中接入 Maple MCP（别名）。
- 启用仓库内的 `/maple` 工作流命令。
- 让任务执行与判定统一走 Maple MCP + Maple Skills 链路。

## 1) 配置 Windsurf MCP

在本机创建或更新 `~/.codeium/windsurf/mcp_config.json`：

```json
{
  "mcpServers": {
    "maple": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/ABS/PATH/TO/maple"]
    }
  }
}
```

把 `/ABS/PATH/TO/maple` 替换为你的仓库绝对路径，然后重启 Windsurf。

## 2) 启用 /maple 工作流

本仓库已提供工作流文件：

- `.windsurf/workflows/maple.md`

Windsurf 会把 `maple.md` 映射为 `/maple` 命令。重启或刷新工作区后可直接使用。

## 3) 使用方式

在 Windsurf 聊天中输入：

```text
/maple
```

执行过程会先查询 Maple 项目待办与近期上下文，再按技能链路执行并给出结论。

## 4) 判定规则（已生效）

- Worker 输出必须包含 `mcp_decision.status/comment/tags[]`。
- 若缺少 `mcp_decision`，任务会被标记为 `已阻塞`，不会兜底为 `已完成`。
- 标签与结论记录仅采用 `mcp_decision` 结果。

## 5) 一键安装脚本（Claude / Codex / iFlow）

仓库内提供安装脚本（MCP + Skills）：

```bash
bash scripts/maple-install.sh
```

或按 CLI 单独安装：

```bash
bash scripts/installers/install-maple-codex.sh
bash scripts/installers/install-maple-claude.sh
bash scripts/installers/install-maple-iflow.sh
```

也可以一次性安装全部：

```bash
bash scripts/installers/install-maple-all.sh
```

## 6) 独立执行边界

- `/maple` 默认只使用 Maple MCP 与 Maple Skills。
- 任务执行、验证与结论均在 Maple 链路内完成。
- 不引入外部任务系统依赖，避免执行路径分叉。

## 7) iFlow /skills list 验证

安装后执行 `/skills list`，应能看到：

- `~/.iflow/skills/SKILL.md`
- `~/.iflow/skills/maple/SKILL.md`

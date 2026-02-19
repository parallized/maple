# Maple MCP 与 Skills 指南

## Monorepo 拆分位置

- `packages/mcp-tools`：Maple MCP 工具能力（项目待办查询、最近上下文查询、工具清单）
- `packages/worker-skills`：Maple Skills 能力（任务执行 Prompt、技能定义）

## 与 Notion 的关系（关键）

- `Maple MCP + Maple Skills` 是应用内能力，默认不连接 Notion。
- NPT 是 Maple 的外部辅助工具，仅在任务流转自动化场景下可选接入 Notion。
- Maple App 自身功能不应依赖 Notion。

## 在 Maple 仓库内安装

1. 在仓库根目录执行依赖安装：

```bash
pnpm install
```

2. 验证拆分后的包已被桌面端正确引用：

```bash
pnpm typecheck
pnpm build
```

## 在其他工程中复用这两个包

```bash
pnpm add @maple/mcp-tools @maple/worker-skills
```

## 继续扩展 Maple MCP 与 Skills

- MCP 工具扩展：编辑 `packages/mcp-tools/src/index.ts`，新增工具定义与查询函数。
- Skills 扩展：编辑 `packages/worker-skills/src/index.ts`，新增技能项并调整提示词模板。
- 扩展后统一验证：

```bash
pnpm typecheck
pnpm build
```

## 默认 Maple MCP（本地）

默认建议使用本地 `maple` MCP（stdio）：

```bash
codex mcp add maple -- npx -y @modelcontextprotocol/server-filesystem /ABS/PATH/TO/maple
codex mcp list
```

`/ABS/PATH/TO/maple` 替换为本机路径。

## （可选）Codex 侧安装 Skills

1. 推荐：在 Codex 会话中使用 `$skill-installer`，按技能名安装。
2. 手动：把技能目录放入 `~/.codex/skills/<skill-name>`。
3. 安装后重启 Codex 会话，使新技能生效。

## Windsurf 接入

如果你在 Windsurf 中使用 Maple，请参考：

- `docs/windsurf-maple-setup.md`

## 一键安装脚本

仓库内提供三套 CLI 安装脚本（MCP + Skills）：

```bash
bash scripts/maple-install.sh
```

或按 CLI 单独安装：

```bash
bash scripts/installers/install-maple-codex.sh
bash scripts/installers/install-maple-claude.sh
bash scripts/installers/install-maple-iflow.sh
```

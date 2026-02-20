#!/usr/bin/env bash

MAPLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAPLE_MCP_URL="http://localhost:45819/mcp"

print_step() {
  echo
  echo "[maple-installer] $1"
}

ensure_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[maple-installer] missing command: $cmd" >&2
    return 1
  fi
}

write_codex_skill() {
  local skill_dir="${HOME}/.codex/skills/maple"
  mkdir -p "$skill_dir"
  cat > "${skill_dir}/SKILL.md" <<EOF
---
name: maple
description: "Run /maple workflow for Maple development tasks."
---

# maple

When user asks \`/maple\`:
1. Work in the current working directory (do NOT cd elsewhere).
2. Use Maple MCP tools to query tasks and submit results.
3. Always run typecheck/build verification before marking done.
4. Output \`mcp_decision\` with status, comment, and tags.
EOF
}

write_claude_command() {
  local command_dir="${HOME}/.claude/commands"
  mkdir -p "$command_dir"
  cat > "${command_dir}/maple.md" <<EOF
Run Maple workflow in the current working directory:

1. Use Maple MCP tools (query_project_todos, query_recent_context) to get tasks
2. Implement the requested changes in the current project
3. Run typecheck/build before finishing
4. Output mcp_decision with status, comment, and tags
5. Use submit_task_report to report results, then finish_worker when done
EOF
}

write_iflow_user_assets() {
  local workflow_dir="${HOME}/.iflow/workflows"
  local skill_root_dir="${HOME}/.iflow/skills"
  local skill_dir="${skill_root_dir}/maple"
  mkdir -p "$workflow_dir" "$skill_root_dir" "$skill_dir"
  cat > "${workflow_dir}/maple.md" <<EOF
/maple

Work in the current working directory (do NOT cd elsewhere).
Use Maple MCP tools to query tasks and submit results.
Run typecheck/build before finishing.
Output mcp_decision with status, comment, and tags.
EOF
  cat > "${skill_root_dir}/SKILL.md" <<EOF
---
name: maple
description: "Project-local maple skill index."
---

# maple

Use \`~/.iflow/skills/maple/SKILL.md\` for the full maple execution skill.
EOF
  cat > "${skill_dir}/SKILL.md" <<EOF
---
name: maple
description: "Run maple workflow in this repository."
---

# maple

Maple execution skill:
- execute tasks end-to-end
- use Maple MCP + local skills first
- run typecheck/build before completion
- keep Maple on the standalone execution path
EOF
}

write_windsurf_workflow() {
  local workflow_dir="${MAPLE_ROOT}/.windsurf/workflows"
  mkdir -p "$workflow_dir"
  cat > "${workflow_dir}/maple.md" <<EOF
# /maple

当用户输入 \`/maple\` 时，按以下流程执行：

1. 在当前项目根目录执行，使用 Maple MCP + Maple Skills 作为唯一执行链路。
2. 先调用 Maple MCP 查询能力获取任务与上下文：
   - \`query_project_todos\`：拉取当前项目未完成任务（按更新时间倒序）。
   - \`query_recent_context\`：拉取近期报告与 Worker 日志上下文（可按关键词过滤）。
3. 对每条任务执行端到端实现：代码修改、类型检查、构建校验。
4. 仅通过 Maple Skills 的 MCP 决策输出决定任务结果：
   - 必须产出 \`mcp_decision.status\`、\`mcp_decision.comment\`、\`mcp_decision.tags[]\`。
   - 缺少 \`mcp_decision\` 时，不得标记完成，统一标记为阻塞并说明原因。
5. 输出本轮执行汇总（已完成 / 需更多信息 / 已阻塞 / 剩余）。

输出语言默认使用中文，除非用户明确要求其他语言。
EOF
}

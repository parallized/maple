#!/usr/bin/env bash

MAPLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAPLE_MCP_COMMAND="npx"
MAPLE_MCP_ARGS=(-y @modelcontextprotocol/server-filesystem "$MAPLE_ROOT")

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
1. Work in \`${MAPLE_ROOT}\`.
2. Use Maple MCP + project skills to complete the user request end-to-end.
3. Always run typecheck/build verification before marking done.
4. Keep Maple on its standalone execution path without external task-system dependencies.
EOF
}

write_claude_command() {
  local command_dir="${HOME}/.claude/commands"
  mkdir -p "$command_dir"
  cat > "${command_dir}/maple.md" <<EOF
Run Maple workflow in repository:

1. cd ${MAPLE_ROOT}
2. use Maple MCP + local skills to complete the requested implementation
3. run typecheck/build before finishing
4. keep Maple on the standalone execution path
EOF
}

write_iflow_user_assets() {
  local workflow_dir="${HOME}/.iflow/workflows"
  local skill_root_dir="${HOME}/.iflow/skills"
  local skill_dir="${skill_root_dir}/maple"
  mkdir -p "$workflow_dir" "$skill_root_dir" "$skill_dir"
  cat > "${workflow_dir}/maple.md" <<EOF
/maple

cd ${MAPLE_ROOT}
use Maple MCP + local skills to complete the user request
run typecheck/build before finishing
keep Maple on the standalone execution path
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

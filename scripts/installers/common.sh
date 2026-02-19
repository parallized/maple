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
description: "Run /maple workflow for Maple TODO auto execution."
---

# maple

When user asks \`/maple\`:
1. Run NPT sync in \`${MAPLE_ROOT}\`.
2. Execute TODO end-to-end with typecheck/build verification.
3. Only trust \`mcp_decision.status/comment/tags[]\` for final status.
4. Write result comments and tags back to Maple tasks.
EOF
}

write_claude_command() {
  local command_dir="${HOME}/.claude/commands"
  mkdir -p "$command_dir"
  cat > "${command_dir}/maple.md" <<EOF
Run Maple workflow in repository:

1. cd ${MAPLE_ROOT}
2. execute npt sync
3. enforce mcp_decision as the only completion signal
4. write comments/tags/status back to Maple
EOF
}

write_iflow_local_assets() {
  local workflow_dir="${MAPLE_ROOT}/.iflow/workflows"
  local skill_root_dir="${MAPLE_ROOT}/.iflow/skills"
  local skill_dir="${skill_root_dir}/maple"
  mkdir -p "$workflow_dir" "$skill_root_dir" "$skill_dir"
  cat > "${workflow_dir}/maple.md" <<EOF
/maple

cd ${MAPLE_ROOT}
run npt sync
only accept mcp_decision as completion status
write comment/tags/status back to Maple
EOF
  cat > "${skill_root_dir}/SKILL.md" <<EOF
---
name: maple
description: "Project-local maple skill index."
---

# maple

Use \`.iflow/skills/maple/SKILL.md\` for the full maple execution skill.
EOF
  cat > "${skill_dir}/SKILL.md" <<EOF
---
name: maple
description: "Run maple workflow in this repository."
---

# maple

Maple execution skill:
- execute tasks end-to-end
- require mcp_decision.status/comment/tags[]
- run typecheck/build before completion
EOF
}

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

print_step "Installing Maple MCP for iFlow"
ensure_cmd iflow

iflow mcp remove maple >/dev/null 2>&1 || true
iflow mcp add --scope user --transport stdio maple "${MAPLE_MCP_COMMAND}" "${MAPLE_MCP_ARGS[@]}"

print_step "Installing Maple workflow/skill assets for iFlow (~/.iflow)"
write_iflow_user_assets

echo
echo "[maple-installer] iFlow setup done."
echo "[maple-installer] Assets written to ${HOME}/.iflow/workflows/maple.md and ${HOME}/.iflow/skills/maple/SKILL.md"

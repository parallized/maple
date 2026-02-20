#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

print_step "Installing Maple MCP for iFlow"
ensure_cmd iflow

iflow mcp remove maple >/dev/null 2>&1 || true
iflow mcp add --scope user --transport http maple "${MAPLE_MCP_URL}"

print_step "Installing Maple workflow/skill assets for iFlow (~/.iflow)"
write_iflow_user_assets

echo
echo "[maple-installer] iFlow setup done."
echo "[maple-installer] MCP registered as HTTP server at ${MAPLE_MCP_URL}"
echo "[maple-installer] Assets written to ${HOME}/.iflow/workflows/maple.md and ${HOME}/.iflow/skills/maple/SKILL.md"

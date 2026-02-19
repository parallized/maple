#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

print_step "Installing Maple MCP for Claude Code"
ensure_cmd claude

claude mcp remove maple --scope user >/dev/null 2>&1 || true
claude mcp add --scope user maple -- "${MAPLE_MCP_COMMAND}" "${MAPLE_MCP_ARGS[@]}"

print_step "Installing local /maple command for Claude Code"
write_claude_command

echo
echo "[maple-installer] Claude setup done."
echo "[maple-installer] Open Claude Code and run /maple"

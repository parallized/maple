#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

print_step "Installing Maple MCP for Claude Code"
ensure_cmd claude

claude mcp remove maple --scope user >/dev/null 2>&1 || true
claude mcp add --scope user --transport http maple "${MAPLE_MCP_URL}"

print_step "Installing local /maple command for Claude Code"
write_claude_command

echo
echo "[maple-installer] Claude setup done."
echo "[maple-installer] MCP registered as HTTP server at ${MAPLE_MCP_URL}"
echo "[maple-installer] Open Claude Code and run /maple"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

print_step "Installing Maple MCP for Codex"
ensure_cmd codex

codex mcp remove maple >/dev/null 2>&1 || true
codex mcp add maple --url "${MAPLE_MCP_URL}"

print_step "Installing local Maple skill for Codex"
write_codex_skill

echo
echo "[maple-installer] Codex setup done."
echo "[maple-installer] MCP registered as HTTP server at ${MAPLE_MCP_URL}"
echo "[maple-installer] Restart Codex session to load ~/.codex/skills/maple"

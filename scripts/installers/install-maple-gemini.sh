#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

print_step "Installing Maple MCP for Gemini CLI"
if ! command -v gemini >/dev/null 2>&1; then
  echo "[maple-installer] gemini not found; skipped."
  echo "[maple-installer] Install Gemini CLI with: npm install -g @google/gemini-cli"
  exit 0
fi

gemini mcp remove maple --scope user >/dev/null 2>&1 || true
gemini mcp add --transport http --scope user maple "${MAPLE_MCP_URL}"

print_step "Installing local /maple command for Gemini CLI"
write_gemini_command

echo
echo "[maple-installer] Gemini setup done."
echo "[maple-installer] MCP registered as HTTP server at ${MAPLE_MCP_URL}"
echo "[maple-installer] Command written to ~/.gemini/commands/maple.toml"
echo "[maple-installer] Restart Gemini CLI session and run /maple"


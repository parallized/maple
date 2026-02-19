#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

print_step "Installing Maple MCP for Windsurf"
ensure_cmd node

WINDSURF_CONFIG_DIR="${HOME}/.codeium/windsurf"
WINDSURF_CONFIG_PATH="${WINDSURF_CONFIG_DIR}/mcp_config.json"
mkdir -p "${WINDSURF_CONFIG_DIR}"

node - "${WINDSURF_CONFIG_PATH}" "${MAPLE_ROOT}" <<'NODE'
const fs = require("fs");

const [configPath, mapleRoot] = process.argv.slice(2);
let config = {};

if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (raw) {
    try {
      config = JSON.parse(raw);
    } catch (error) {
      console.error(`[maple-installer] invalid JSON in ${configPath}: ${error.message}`);
      process.exit(1);
    }
  }
}

if (!config || typeof config !== "object" || Array.isArray(config)) {
  config = {};
}
if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
  config.mcpServers = {};
}

config.mcpServers.maple = {
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", mapleRoot]
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE

print_step "Installing local /maple workflow for Windsurf"
write_windsurf_workflow

echo
echo "[maple-installer] Windsurf setup done."
echo "[maple-installer] MCP config written to ${WINDSURF_CONFIG_PATH}"
echo "[maple-installer] Workflow written to ${MAPLE_ROOT}/.windsurf/workflows/maple.md"
echo "[maple-installer] Restart Windsurf to load updated MCP config."

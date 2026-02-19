#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[maple-install] Installing maple MCP + skills for Codex / Claude / iFlow / Windsurf..."
bash "${ROOT_DIR}/scripts/installers/install-maple-all.sh"
echo "[maple-install] Done."

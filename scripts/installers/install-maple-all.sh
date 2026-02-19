#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "${ROOT_DIR}/install-maple-codex.sh"
bash "${ROOT_DIR}/install-maple-claude.sh"
bash "${ROOT_DIR}/install-maple-iflow.sh"

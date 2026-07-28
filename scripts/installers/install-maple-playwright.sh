#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

if [[ "${MAPLE_SKIP_PLAYWRIGHT_INSTALL:-0}" == "1" ]]; then
  echo "[maple-installer] Playwright installation skipped."
  exit 0
fi

if [[ -z "${HOME:-}" ]]; then
  echo "[maple-installer] HOME is unavailable; cannot install the Playwright runtime." >&2
  exit 1
fi

RUNTIME_DIR="${HOME}/.maple/runtime/playwright"
PACKAGE_JSON="${RUNTIME_DIR}/package.json"
RAW_PLAYWRIGHT_BIN="${RUNTIME_DIR}/node_modules/.bin/playwright"
PLAYWRIGHT_BIN="${RUNTIME_DIR}/maple-playwright"
PLAYWRIGHT_VERSION="${MAPLE_PLAYWRIGHT_VERSION:-1.61.1}"

print_step "Installing screenshot runtime (Playwright + Chromium)"
mkdir -p "${RUNTIME_DIR}"

if [[ ! -f "${PACKAGE_JSON}" ]]; then
  printf '%s\n' '{"name":"maple-playwright-runtime","private":true,"version":"1.0.0"}' > "${PACKAGE_JSON}"
fi

if command -v npm >/dev/null 2>&1; then
  npm install \
    --prefix "${RUNTIME_DIR}" \
    --save-exact \
    --no-audit \
    --no-fund \
    "playwright@${PLAYWRIGHT_VERSION}"
elif command -v bun >/dev/null 2>&1; then
  (
    cd "${RUNTIME_DIR}"
    bun add --exact "playwright@${PLAYWRIGHT_VERSION}"
  )
else
  echo "[maple-installer] npm or Bun is required to install Playwright." >&2
  exit 1
fi

if [[ ! -e "${RAW_PLAYWRIGHT_BIN}" ]]; then
  echo "[maple-installer] Playwright executable was not created: ${RAW_PLAYWRIGHT_BIN}" >&2
  exit 1
fi

printf '%s\n' \
  '#!/usr/bin/env sh' \
  'set -eu' \
  'MAPLE_PLAYWRIGHT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"' \
  'export PLAYWRIGHT_BROWSERS_PATH="${MAPLE_PLAYWRIGHT_ROOT}/browsers"' \
  'exec "${MAPLE_PLAYWRIGHT_ROOT}/node_modules/.bin/playwright" "$@"' \
  > "${PLAYWRIGHT_BIN}"
chmod 0755 "${PLAYWRIGHT_BIN}"

printf '%s\r\n' \
  '@echo off' \
  'setlocal' \
  'set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"' \
  'call "%~dp0node_modules\.bin\playwright.cmd" %*' \
  'exit /b %ERRORLEVEL%' \
  > "${RUNTIME_DIR}/maple-playwright.cmd"

"${PLAYWRIGHT_BIN}" install chromium --only-shell

PLAYWRIGHT_VERSION="$("${PLAYWRIGHT_BIN}" --version)"
echo "[maple-installer] Screenshot runtime ready: ${PLAYWRIGHT_VERSION}"
echo "[maple-installer] Runtime: ${RUNTIME_DIR}"
echo "[maple-installer] Browser cache: ${RUNTIME_DIR}/browsers"

#!/usr/bin/env sh
set -eu

maple_download_with_progress() {
  MAPLE_DOWNLOAD_URL="$1"
  MAPLE_DOWNLOAD_TARGET="$2"
  if [ -t 2 ]; then
    curl -fL --retry 3 --show-error --progress-bar "$MAPLE_DOWNLOAD_URL" -o "$MAPLE_DOWNLOAD_TARGET"
  else
    curl -fsSL --retry 3 "$MAPLE_DOWNLOAD_URL" -o "$MAPLE_DOWNLOAD_TARGET"
  fi
}

MAPLE_CURRENT_STAGE="reading installer configuration"
maple_report_exit() {
  MAPLE_EXIT_STATUS="$1"
  if [ "$MAPLE_EXIT_STATUS" -ne 0 ]; then
    echo "[maple] Installation failed during $MAPLE_CURRENT_STAGE." >&2
  fi
}

trap 'maple_report_exit "$?"' EXIT

MAPLE_SERVER_OVERRIDE="${MAPLE_SERVER_URL:-}"
MAPLE_SERVER_URL="__MAPLE_SERVER_URL__"
case "$MAPLE_SERVER_URL" in
  https://*|http://*) ;;
  *) MAPLE_SERVER_URL="${MAPLE_SERVER_URL_OVERRIDE:-${MAPLE_SERVER_OVERRIDE:-http://127.0.0.1:45820}}" ;;
esac
case "$MAPLE_SERVER_URL" in
  https://*|http://127.0.0.1*|http://localhost*) ;;
  *) echo "[maple] HTTPS is required for remote servers." >&2; exit 1 ;;
esac
MAPLE_SERVER_URL="${MAPLE_SERVER_URL%/}"
MAPLE_HOME_DIR="${HOME}/.maple"
MAPLE_BIN_DIR="${MAPLE_HOME_DIR}/bin"
MAPLE_RUNTIME_DIR="${MAPLE_HOME_DIR}/runtime"
MAPLE_CURRENT_STAGE="[1/8] preparing installation directories"
echo "[maple] [1/8] Preparing installation directories..."
mkdir -p "$MAPLE_BIN_DIR" "$MAPLE_RUNTIME_DIR" "${HOME}/.local/bin"
echo "[maple]       Directories ready: $MAPLE_HOME_DIR"

MAPLE_CURRENT_STAGE="[2/8] checking Bun runtime"
echo "[maple] [2/8] Checking Bun runtime..."
if command -v bun >/dev/null 2>&1; then
  MAPLE_BUN_BIN="$(command -v bun)"
else
  echo "[maple]       Bun was not found; installing it now."
  curl -fsSL https://bun.sh/install | bash
  MAPLE_BUN_BIN="${HOME}/.bun/bin/bun"
fi
test -x "$MAPLE_BUN_BIN" || { echo "[maple] Bun installation failed." >&2; exit 1; }
echo "[maple]       Using Bun: $MAPLE_BUN_BIN"

MAPLE_CURRENT_STAGE="[3/8] downloading CUI"
echo "[maple] [3/8] Downloading CUI..."
maple_download_with_progress "$MAPLE_SERVER_URL/downloads/maple-cli.js" "$MAPLE_BIN_DIR/maple-cli.js.download"
test "$(wc -c < "$MAPLE_BIN_DIR/maple-cli.js.download")" -gt 10000 || { echo "[maple] Downloaded CLI is incomplete." >&2; exit 1; }
mv "$MAPLE_BIN_DIR/maple-cli.js.download" "$MAPLE_BIN_DIR/maple-cli.js"
echo "[maple]       CUI downloaded and validated."

MAPLE_CURRENT_STAGE="[4/8] configuring the maple command and user PATH"
echo "[maple] [4/8] Configuring the maple command and user PATH..."
cat > "$MAPLE_BIN_DIR/maple" <<EOF
#!/usr/bin/env sh
exec "$MAPLE_BUN_BIN" "$MAPLE_BIN_DIR/maple-cli.js" "\$@"
EOF
chmod 0755 "$MAPLE_BIN_DIR/maple"
ln -sf "$MAPLE_BIN_DIR/maple" "${HOME}/.local/bin/maple"
echo "[maple]       Command ready: $MAPLE_BIN_DIR/maple"

MAPLE_CURRENT_STAGE="[5/8] initializing and verifying the CUI runtime"
echo "[maple] [5/8] Initializing and verifying the CUI runtime..."
"$MAPLE_BIN_DIR/maple" status >/dev/null
echo "[maple]       CUI runtime verified."

MAPLE_CURRENT_STAGE="[6/8] preparing Playwright screenshot runtime"
echo "[maple] [6/8] Preparing Playwright screenshot runtime..."
if [ "${MAPLE_SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]; then
  MAPLE_PLAYWRIGHT_DIR="$MAPLE_RUNTIME_DIR/playwright"
  mkdir -p "$MAPLE_PLAYWRIGHT_DIR"
  test -f "$MAPLE_PLAYWRIGHT_DIR/package.json" || printf '%s\n' '{"name":"maple-playwright-runtime","private":true}' > "$MAPLE_PLAYWRIGHT_DIR/package.json"
  MAPLE_CURRENT_STAGE="[6/8] installing the Playwright package"
  echo "[maple]       Installing Playwright package..."
  (cd "$MAPLE_PLAYWRIGHT_DIR" && "$MAPLE_BUN_BIN" add --exact playwright@1.61.1)
  MAPLE_CURRENT_STAGE="[6/8] installing the Chromium browser"
  echo "[maple]       Installing Chromium browser..."
  PLAYWRIGHT_BROWSERS_PATH="$MAPLE_PLAYWRIGHT_DIR/browsers" "$MAPLE_BUN_BIN" "$MAPLE_PLAYWRIGHT_DIR/node_modules/playwright/cli.js" install chromium --only-shell
  cat > "$MAPLE_PLAYWRIGHT_DIR/maple-playwright" <<EOF
#!/usr/bin/env sh
export PLAYWRIGHT_BROWSERS_PATH="$MAPLE_PLAYWRIGHT_DIR/browsers"
exec "$MAPLE_BUN_BIN" "$MAPLE_PLAYWRIGHT_DIR/node_modules/playwright/cli.js" "\$@"
EOF
  chmod 0755 "$MAPLE_PLAYWRIGHT_DIR/maple-playwright"
  echo "[maple]       Playwright and Chromium are ready."
else
  echo "[maple]       Skipped by MAPLE_SKIP_PLAYWRIGHT_INSTALL=1."
fi

# Report only after the CLI and optional runtime have been installed successfully.
# The event ID makes curl retries idempotent; statistics failure never breaks installation.
MAPLE_CURRENT_STAGE="[7/8] finalizing installation"
echo "[maple] [7/8] Finalizing installation..."
if [ -r /dev/urandom ] && command -v od >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then
  MAPLE_INSTALL_EVENT_ID="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
else
  MAPLE_INSTALL_EVENT_ID="maple-$(date +%s)-$$-install"
fi
curl -fsS --retry 2 -X POST \
  -H "x-maple-install-id: $MAPLE_INSTALL_EVENT_ID" \
  "$MAPLE_SERVER_URL/api/downloads/install-sh" >/dev/null 2>&1 || true

MAPLE_CURRENT_STAGE="[8/8] completing installation"
echo "[maple] [8/8] Installation complete."
echo "[maple] Installed in $MAPLE_HOME_DIR"
echo "[maple] Connect with: maple connect --server $MAPLE_SERVER_URL"
trap - EXIT

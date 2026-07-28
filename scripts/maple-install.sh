#!/usr/bin/env sh
set -eu

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
mkdir -p "$MAPLE_BIN_DIR" "$MAPLE_RUNTIME_DIR" "${HOME}/.local/bin"

if command -v bun >/dev/null 2>&1; then
  MAPLE_BUN_BIN="$(command -v bun)"
else
  echo "[maple] Installing Bun runtime..."
  curl -fsSL https://bun.sh/install | bash
  MAPLE_BUN_BIN="${HOME}/.bun/bin/bun"
fi
test -x "$MAPLE_BUN_BIN" || { echo "[maple] Bun installation failed." >&2; exit 1; }

echo "[maple] Downloading CLI..."
curl -fsSL "$MAPLE_SERVER_URL/downloads/maple-cli.js" -o "$MAPLE_BIN_DIR/maple-cli.js.download"
test "$(wc -c < "$MAPLE_BIN_DIR/maple-cli.js.download")" -gt 10000 || { echo "[maple] Downloaded CLI is incomplete." >&2; exit 1; }
mv "$MAPLE_BIN_DIR/maple-cli.js.download" "$MAPLE_BIN_DIR/maple-cli.js"
cat > "$MAPLE_BIN_DIR/maple" <<EOF
#!/usr/bin/env sh
exec "$MAPLE_BUN_BIN" "$MAPLE_BIN_DIR/maple-cli.js" "\$@"
EOF
chmod 0755 "$MAPLE_BIN_DIR/maple"
ln -sf "$MAPLE_BIN_DIR/maple" "${HOME}/.local/bin/maple"
"$MAPLE_BIN_DIR/maple" status >/dev/null

if [ "${MAPLE_SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]; then
  echo "[maple] Installing Playwright runtime..."
  MAPLE_PLAYWRIGHT_DIR="$MAPLE_RUNTIME_DIR/playwright"
  mkdir -p "$MAPLE_PLAYWRIGHT_DIR"
  test -f "$MAPLE_PLAYWRIGHT_DIR/package.json" || printf '%s\n' '{"name":"maple-playwright-runtime","private":true}' > "$MAPLE_PLAYWRIGHT_DIR/package.json"
  (cd "$MAPLE_PLAYWRIGHT_DIR" && "$MAPLE_BUN_BIN" add --exact playwright@1.61.1)
  PLAYWRIGHT_BROWSERS_PATH="$MAPLE_PLAYWRIGHT_DIR/browsers" "$MAPLE_BUN_BIN" "$MAPLE_PLAYWRIGHT_DIR/node_modules/playwright/cli.js" install chromium --only-shell
  cat > "$MAPLE_PLAYWRIGHT_DIR/maple-playwright" <<EOF
#!/usr/bin/env sh
export PLAYWRIGHT_BROWSERS_PATH="$MAPLE_PLAYWRIGHT_DIR/browsers"
exec "$MAPLE_BUN_BIN" "$MAPLE_PLAYWRIGHT_DIR/node_modules/playwright/cli.js" "\$@"
EOF
  chmod 0755 "$MAPLE_PLAYWRIGHT_DIR/maple-playwright"
fi

# Report only after the CLI and optional runtime have been installed successfully.
# The event ID makes curl retries idempotent; statistics failure never breaks installation.
if [ -r /dev/urandom ] && command -v od >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then
  MAPLE_INSTALL_EVENT_ID="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
else
  MAPLE_INSTALL_EVENT_ID="maple-$(date +%s)-$$-install"
fi
curl -fsS --retry 2 -X POST \
  -H "x-maple-install-id: $MAPLE_INSTALL_EVENT_ID" \
  "$MAPLE_SERVER_URL/api/downloads/install-sh" >/dev/null 2>&1 || true

echo "[maple] Installed in $MAPLE_HOME_DIR"
echo "[maple] Connect with: maple connect --server $MAPLE_SERVER_URL"

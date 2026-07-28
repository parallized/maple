#!/usr/bin/env sh
set -eu

MAPLE_SOURCE_URL="__MAPLE_SERVER_URL__"
case "$MAPLE_SOURCE_URL" in
  https://*|http://*) ;;
  *) MAPLE_SOURCE_URL="${MAPLE_SERVER_URL:-http://127.0.0.1:45820}" ;;
esac
case "$MAPLE_SOURCE_URL" in
  https://*|http://127.0.0.1*|http://localhost*) ;;
  *) echo "[maple-local] HTTPS is required for remote downloads." >&2; exit 1 ;;
esac
MAPLE_SOURCE_URL="${MAPLE_SOURCE_URL%/}"

MAPLE_HOME_DIR="${MAPLE_HOME_DIR:-${HOME}/.maple}"
MAPLE_BIN_DIR="${MAPLE_HOME_DIR}/bin"
MAPLE_RUNTIME_DIR="${MAPLE_HOME_DIR}/runtime"
MAPLE_LOCAL_APP_DIR="${MAPLE_HOME_DIR}/local-app"
MAPLE_LOCAL_STAGING_DIR="${MAPLE_HOME_DIR}/local-app.installing.$$"
MAPLE_LOCAL_BACKUP_DIR="${MAPLE_HOME_DIR}/local-app.previous.$$"
MAPLE_LOCAL_MANIFEST_URL="${MAPLE_SOURCE_URL}/downloads/maple-local/manifest.txt"

case "$MAPLE_LOCAL_STAGING_DIR" in
  "${MAPLE_HOME_DIR}"/local-app.installing.*) ;;
  *) echo "[maple-local] Invalid staging directory." >&2; exit 1 ;;
esac
case "$MAPLE_LOCAL_BACKUP_DIR" in
  "${MAPLE_HOME_DIR}"/local-app.previous.*) ;;
  *) echo "[maple-local] Invalid backup directory." >&2; exit 1 ;;
esac

cleanup() {
  if [ -d "$MAPLE_LOCAL_STAGING_DIR" ]; then rm -rf "$MAPLE_LOCAL_STAGING_DIR"; fi
}

move_with_retry() {
  MAPLE_MOVE_SOURCE="$1"
  MAPLE_MOVE_TARGET="$2"
  MAPLE_MOVE_ATTEMPT=1
  while ! mv "$MAPLE_MOVE_SOURCE" "$MAPLE_MOVE_TARGET"; do
    if [ "$MAPLE_MOVE_ATTEMPT" -ge 3 ]; then return 1; fi
    MAPLE_MOVE_ATTEMPT=$((MAPLE_MOVE_ATTEMPT + 1))
    sleep 1
  done
}

trap cleanup EXIT HUP INT TERM

mkdir -p "$MAPLE_BIN_DIR" "$MAPLE_RUNTIME_DIR" "${HOME}/.local/bin"
rm -rf "$MAPLE_LOCAL_STAGING_DIR" "$MAPLE_LOCAL_BACKUP_DIR"
mkdir -p "$MAPLE_LOCAL_STAGING_DIR"

if command -v bun >/dev/null 2>&1; then
  MAPLE_BUN_BIN="$(command -v bun)"
else
  echo "[maple-local] Installing Bun runtime..."
  curl -fsSL https://bun.sh/install | bash
  MAPLE_BUN_BIN="${HOME}/.bun/bin/bun"
fi
test -x "$MAPLE_BUN_BIN" || { echo "[maple-local] Bun installation failed." >&2; exit 1; }

echo "[maple-local] Downloading Server, WebUI and CLI..."
curl -fsSL --retry 3 "$MAPLE_LOCAL_MANIFEST_URL" -o "$MAPLE_LOCAL_STAGING_DIR/.manifest"
while IFS= read -r MAPLE_RELATIVE_PATH || [ -n "$MAPLE_RELATIVE_PATH" ]; do
  [ -n "$MAPLE_RELATIVE_PATH" ] || continue
  case "$MAPLE_RELATIVE_PATH" in
    /*|*..*|*\\*) echo "[maple-local] Invalid file in download manifest." >&2; exit 1 ;;
  esac
  MAPLE_TARGET_PATH="${MAPLE_LOCAL_STAGING_DIR}/${MAPLE_RELATIVE_PATH}"
  mkdir -p "$(dirname "$MAPLE_TARGET_PATH")"
  curl -fsSL --retry 3 "${MAPLE_SOURCE_URL}/downloads/maple-local/${MAPLE_RELATIVE_PATH}" -o "$MAPLE_TARGET_PATH"
done < "$MAPLE_LOCAL_STAGING_DIR/.manifest"
rm -f "$MAPLE_LOCAL_STAGING_DIR/.manifest"

printf '%s\n' '{"name":"maple-local-runtime","private":true}' > "$MAPLE_LOCAL_STAGING_DIR/package.json"
printf '%s\n' "$MAPLE_SOURCE_URL" > "$MAPLE_LOCAL_STAGING_DIR/.update-source"
echo "[maple-local] Installing the platform image runtime..."
(
  cd "$MAPLE_LOCAL_STAGING_DIR"
  "$MAPLE_BUN_BIN" add --exact sharp@0.35.3
)

test -s "$MAPLE_LOCAL_STAGING_DIR/maple-local.js" || { echo "[maple-local] CLI payload is incomplete." >&2; exit 1; }
test -s "$MAPLE_LOCAL_STAGING_DIR/web/index.html" || { echo "[maple-local] WebUI payload is incomplete." >&2; exit 1; }
find "$MAPLE_LOCAL_STAGING_DIR/node_modules/@img" -type f -name '*.node' -print -quit | grep -q . \
  || { echo "[maple-local] Platform image runtime is incomplete." >&2; exit 1; }
chmod 0755 "$MAPLE_LOCAL_STAGING_DIR/maple-local.js"
"$MAPLE_BUN_BIN" "$MAPLE_LOCAL_STAGING_DIR/maple-local.js" help >/dev/null

if [ -d "$MAPLE_LOCAL_APP_DIR" ]; then
  move_with_retry "$MAPLE_LOCAL_APP_DIR" "$MAPLE_LOCAL_BACKUP_DIR" \
    || { echo "[maple-local] Close Maple Local before updating." >&2; exit 1; }
fi
if ! move_with_retry "$MAPLE_LOCAL_STAGING_DIR" "$MAPLE_LOCAL_APP_DIR"; then
  if [ -d "$MAPLE_LOCAL_BACKUP_DIR" ]; then
    move_with_retry "$MAPLE_LOCAL_BACKUP_DIR" "$MAPLE_LOCAL_APP_DIR" || true
  fi
  echo "[maple-local] Unable to publish the downloaded version." >&2
  exit 1
fi
if [ -d "$MAPLE_LOCAL_BACKUP_DIR" ]; then rm -rf "$MAPLE_LOCAL_BACKUP_DIR"; fi

if [ "${MAPLE_LAUNCHED_BY_UPDATER:-0}" != "1" ] \
  || [ ! -s "$MAPLE_BIN_DIR/maple-local" ] \
  || [ ! -s "$MAPLE_BIN_DIR/maple-local-update" ]; then
  cat > "$MAPLE_BIN_DIR/maple-local-update" <<'EOF'
#!/usr/bin/env sh
set -eu

MAPLE_UPDATE_BIN_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MAPLE_UPDATE_HOME_DIR="$(dirname "$MAPLE_UPDATE_BIN_DIR")"
MAPLE_UPDATE_SOURCE_FILE="${MAPLE_UPDATE_HOME_DIR}/local-app/.update-source"
test -s "$MAPLE_UPDATE_SOURCE_FILE" \
  || { echo "[maple-local] Update source is unavailable. Re-run the original installer." >&2; exit 1; }
IFS= read -r MAPLE_UPDATE_SOURCE < "$MAPLE_UPDATE_SOURCE_FILE"
MAPLE_UPDATE_SOURCE="${MAPLE_UPDATE_SOURCE%/}"
case "$MAPLE_UPDATE_SOURCE" in
  https://*|http://127.0.0.1*|http://localhost*) ;;
  *) echo "[maple-local] The saved update source is not trusted." >&2; exit 1 ;;
esac

echo "[maple-local] Checking for the latest version..."
curl -fsSL --retry 3 "${MAPLE_UPDATE_SOURCE}/install-local.sh" \
  | env MAPLE_HOME_DIR="$MAPLE_UPDATE_HOME_DIR" MAPLE_LAUNCHED_BY_UPDATER=1 sh
EOF
  chmod 0755 "$MAPLE_BIN_DIR/maple-local-update"

  cat > "$MAPLE_BIN_DIR/maple-local" <<EOF
#!/usr/bin/env sh
if [ "\${1:-}" = "update" ]; then
  exec "$MAPLE_BIN_DIR/maple-local-update"
fi
exec "$MAPLE_BUN_BIN" "$MAPLE_LOCAL_APP_DIR/maple-local.js" "\$@"
EOF
  chmod 0755 "$MAPLE_BIN_DIR/maple-local"
fi
ln -sf "$MAPLE_BIN_DIR/maple-local" "${HOME}/.local/bin/maple-local"

if [ "${MAPLE_SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]; then
  echo "[maple-local] Installing Playwright runtime..."
  MAPLE_PLAYWRIGHT_DIR="$MAPLE_RUNTIME_DIR/playwright"
  mkdir -p "$MAPLE_PLAYWRIGHT_DIR"
  test -f "$MAPLE_PLAYWRIGHT_DIR/package.json" \
    || printf '%s\n' '{"name":"maple-playwright-runtime","private":true}' > "$MAPLE_PLAYWRIGHT_DIR/package.json"
  (cd "$MAPLE_PLAYWRIGHT_DIR" && "$MAPLE_BUN_BIN" add --exact playwright@1.61.1)
  PLAYWRIGHT_BROWSERS_PATH="$MAPLE_PLAYWRIGHT_DIR/browsers" \
    "$MAPLE_BUN_BIN" "$MAPLE_PLAYWRIGHT_DIR/node_modules/playwright/cli.js" install chromium --only-shell
  cat > "$MAPLE_PLAYWRIGHT_DIR/maple-playwright" <<EOF
#!/usr/bin/env sh
export PLAYWRIGHT_BROWSERS_PATH="$MAPLE_PLAYWRIGHT_DIR/browsers"
exec "$MAPLE_BUN_BIN" "$MAPLE_PLAYWRIGHT_DIR/node_modules/playwright/cli.js" "\$@"
EOF
  chmod 0755 "$MAPLE_PLAYWRIGHT_DIR/maple-playwright"
fi

trap - EXIT HUP INT TERM
echo "[maple-local] Installed in $MAPLE_LOCAL_APP_DIR"
echo "[maple-local] Run: maple-local"
echo "[maple-local] Update later: maple-local update"

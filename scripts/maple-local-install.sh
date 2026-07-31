#!/usr/bin/env sh
set -eu

MAPLE_PROGRESS_LAST_REPORTED=-10

maple_format_bytes() {
  MAPLE_FORMAT_BYTES="$1"
  if [ "$MAPLE_FORMAT_BYTES" -ge 1073741824 ]; then
    printf '%d.%d GB' "$((MAPLE_FORMAT_BYTES / 1073741824))" "$(((MAPLE_FORMAT_BYTES % 1073741824) * 10 / 1073741824))"
  elif [ "$MAPLE_FORMAT_BYTES" -ge 1048576 ]; then
    printf '%d.%d MB' "$((MAPLE_FORMAT_BYTES / 1048576))" "$(((MAPLE_FORMAT_BYTES % 1048576) * 10 / 1048576))"
  elif [ "$MAPLE_FORMAT_BYTES" -ge 1024 ]; then
    printf '%d.%d KB' "$((MAPLE_FORMAT_BYTES / 1024))" "$(((MAPLE_FORMAT_BYTES % 1024) * 10 / 1024))"
  else
    printf '%d B' "$MAPLE_FORMAT_BYTES"
  fi
}

maple_show_progress() {
  MAPLE_PROGRESS_BYTES="$1"
  MAPLE_PROGRESS_TOTAL="$2"
  MAPLE_PROGRESS_INDEX="$3"
  MAPLE_PROGRESS_COUNT="$4"
  MAPLE_PROGRESS_LABEL="$5"
  MAPLE_PROGRESS_PERCENT=$((MAPLE_PROGRESS_BYTES * 100 / MAPLE_PROGRESS_TOTAL))
  if [ ! -t 1 ]; then
    MAPLE_PROGRESS_BUCKET=$((MAPLE_PROGRESS_PERCENT / 10 * 10))
    if [ "$MAPLE_PROGRESS_BYTES" -ge "$MAPLE_PROGRESS_TOTAL" ]; then MAPLE_PROGRESS_BUCKET=100; fi
    if [ "$MAPLE_PROGRESS_BUCKET" -le "$MAPLE_PROGRESS_LAST_REPORTED" ]; then return 0; fi
    MAPLE_PROGRESS_LAST_REPORTED="$MAPLE_PROGRESS_BUCKET"
    printf '[maple-local]       Downloading %-12s %3d%%  %s / %s  (%d/%d)\n' \
      "$MAPLE_PROGRESS_LABEL" "$MAPLE_PROGRESS_BUCKET" \
      "$(maple_format_bytes "$MAPLE_PROGRESS_BYTES")" "$(maple_format_bytes "$MAPLE_PROGRESS_TOTAL")" \
      "$MAPLE_PROGRESS_INDEX" "$MAPLE_PROGRESS_COUNT"
    return 0
  fi
  MAPLE_PROGRESS_FILLED=$((MAPLE_PROGRESS_PERCENT * 24 / 100))
  MAPLE_PROGRESS_BAR=""
  MAPLE_PROGRESS_POSITION=0
  while [ "$MAPLE_PROGRESS_POSITION" -lt 24 ]; do
    if [ "$MAPLE_PROGRESS_POSITION" -lt "$MAPLE_PROGRESS_FILLED" ]; then
      MAPLE_PROGRESS_BAR="${MAPLE_PROGRESS_BAR}#"
    else
      MAPLE_PROGRESS_BAR="${MAPLE_PROGRESS_BAR}-"
    fi
    MAPLE_PROGRESS_POSITION=$((MAPLE_PROGRESS_POSITION + 1))
  done
  printf '\r[maple-local] [%s] %3d%%  %-12s  %s / %s  (%d/%d)' \
    "$MAPLE_PROGRESS_BAR" "$MAPLE_PROGRESS_PERCENT" "$MAPLE_PROGRESS_LABEL" \
    "$(maple_format_bytes "$MAPLE_PROGRESS_BYTES")" "$(maple_format_bytes "$MAPLE_PROGRESS_TOTAL")" \
    "$MAPLE_PROGRESS_INDEX" "$MAPLE_PROGRESS_COUNT"
  if [ "$MAPLE_PROGRESS_BYTES" -ge "$MAPLE_PROGRESS_TOTAL" ]; then printf '\n'; fi
}

maple_download_payload() {
  MAPLE_PAYLOAD_URL="$1"
  MAPLE_PAYLOAD_TARGET="$2"
  MAPLE_PAYLOAD_SIZE="$3"
  if [ "$MAPLE_PAYLOAD_SIZE" -ge 1048576 ]; then
    if [ -t 2 ]; then printf '\n'; fi
    curl -fL --retry 3 --show-error --progress-bar "$MAPLE_PAYLOAD_URL" -o "$MAPLE_PAYLOAD_TARGET"
  else
    curl -fsSL --retry 3 "$MAPLE_PAYLOAD_URL" -o "$MAPLE_PAYLOAD_TARGET"
  fi
}

MAPLE_CURRENT_STAGE="reading installer configuration"
maple_report_exit() {
  MAPLE_EXIT_STATUS="$1"
  if command -v cleanup >/dev/null 2>&1; then cleanup; fi
  if [ "$MAPLE_EXIT_STATUS" -ne 0 ]; then
    echo "[maple-local] Installation failed during $MAPLE_CURRENT_STAGE." >&2
  fi
}

trap 'maple_report_exit "$?"' EXIT
trap 'exit 130' HUP INT TERM

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
MAPLE_LOCAL_MANIFEST_URL="${MAPLE_SOURCE_URL}/downloads/maple-local/manifest-v2.txt"

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

MAPLE_CURRENT_STAGE="[1/9] preparing a safe staging directory"
echo "[maple-local] [1/9] Preparing a safe staging directory..."
mkdir -p "$MAPLE_BIN_DIR" "$MAPLE_RUNTIME_DIR" "${HOME}/.local/bin"
rm -rf "$MAPLE_LOCAL_STAGING_DIR" "$MAPLE_LOCAL_BACKUP_DIR"
mkdir -p "$MAPLE_LOCAL_STAGING_DIR"
echo "[maple-local]       Staging directory ready: $MAPLE_LOCAL_STAGING_DIR"

MAPLE_CURRENT_STAGE="[2/9] checking Bun runtime"
echo "[maple-local] [2/9] Checking Bun runtime..."
if command -v bun >/dev/null 2>&1; then
  MAPLE_BUN_BIN="$(command -v bun)"
else
  echo "[maple-local]       Bun was not found; installing it now."
  curl -fsSL https://bun.sh/install | bash
  MAPLE_BUN_BIN="${HOME}/.bun/bin/bun"
fi
test -x "$MAPLE_BUN_BIN" || { echo "[maple-local] Bun installation failed." >&2; exit 1; }
echo "[maple-local]       Using Bun: $MAPLE_BUN_BIN"

MAPLE_CURRENT_STAGE="[3/9] reading the Server, WebUI and CUI download manifest"
echo "[maple-local] [3/9] Downloading Server, WebUI and CUI..."
curl -fsSL --retry 3 "$MAPLE_LOCAL_MANIFEST_URL" -o "$MAPLE_LOCAL_STAGING_DIR/.manifest"
MAPLE_MANIFEST_TAB="$(printf '\t')"
MAPLE_TOTAL_BYTES=0
MAPLE_TOTAL_FILES=0
while IFS="$MAPLE_MANIFEST_TAB" read -r MAPLE_FILE_SIZE MAPLE_RELATIVE_PATH || [ -n "${MAPLE_FILE_SIZE}${MAPLE_RELATIVE_PATH}" ]; do
  [ -n "$MAPLE_RELATIVE_PATH" ] || continue
  case "$MAPLE_FILE_SIZE" in
    ''|*[!0-9]*) echo "[maple-local] Invalid size in download manifest." >&2; exit 1 ;;
  esac
  case "$MAPLE_RELATIVE_PATH" in
    /*|*..*|*\\*) echo "[maple-local] Invalid file in download manifest." >&2; exit 1 ;;
  esac
  MAPLE_TOTAL_BYTES=$((MAPLE_TOTAL_BYTES + MAPLE_FILE_SIZE))
  MAPLE_TOTAL_FILES=$((MAPLE_TOTAL_FILES + 1))
done < "$MAPLE_LOCAL_STAGING_DIR/.manifest"
[ "$MAPLE_TOTAL_FILES" -gt 0 ] && [ "$MAPLE_TOTAL_BYTES" -gt 0 ] \
  || { echo "[maple-local] Download manifest is empty." >&2; exit 1; }
echo "[maple-local]       Payload: $MAPLE_TOTAL_FILES files, $(maple_format_bytes "$MAPLE_TOTAL_BYTES")."

MAPLE_COMPLETED_BYTES=0
MAPLE_FILE_INDEX=0
MAPLE_ACTIVE_COMPONENT=""
while IFS="$MAPLE_MANIFEST_TAB" read -r MAPLE_FILE_SIZE MAPLE_RELATIVE_PATH || [ -n "${MAPLE_FILE_SIZE}${MAPLE_RELATIVE_PATH}" ]; do
  [ -n "$MAPLE_RELATIVE_PATH" ] || continue
  MAPLE_FILE_INDEX=$((MAPLE_FILE_INDEX + 1))
  case "$MAPLE_RELATIVE_PATH" in
    maple-local.js) MAPLE_COMPONENT_LABEL="Server+CUI" ;;
    web/*) MAPLE_COMPONENT_LABEL="WebUI" ;;
    *) MAPLE_COMPONENT_LABEL="Runtime" ;;
  esac
  if [ "$MAPLE_COMPONENT_LABEL" != "$MAPLE_ACTIVE_COMPONENT" ]; then
    if [ -n "$MAPLE_ACTIVE_COMPONENT" ]; then
      if [ -t 1 ]; then printf '\n'; fi
      echo "[maple-local]       $MAPLE_ACTIVE_COMPONENT downloaded."
    fi
    MAPLE_ACTIVE_COMPONENT="$MAPLE_COMPONENT_LABEL"
    echo "[maple-local]       Downloading $MAPLE_ACTIVE_COMPONENT..."
  fi
  MAPLE_CURRENT_STAGE="[3/9] downloading $MAPLE_COMPONENT_LABEL ($MAPLE_FILE_INDEX/$MAPLE_TOTAL_FILES): $MAPLE_RELATIVE_PATH"
  maple_show_progress "$MAPLE_COMPLETED_BYTES" "$MAPLE_TOTAL_BYTES" "$MAPLE_FILE_INDEX" "$MAPLE_TOTAL_FILES" "$MAPLE_COMPONENT_LABEL"
  MAPLE_TARGET_PATH="${MAPLE_LOCAL_STAGING_DIR}/${MAPLE_RELATIVE_PATH}"
  mkdir -p "$(dirname "$MAPLE_TARGET_PATH")"
  maple_download_payload \
    "${MAPLE_SOURCE_URL}/downloads/maple-local/${MAPLE_RELATIVE_PATH}" \
    "$MAPLE_TARGET_PATH" \
    "$MAPLE_FILE_SIZE"
  MAPLE_DOWNLOADED_SIZE="$(wc -c < "$MAPLE_TARGET_PATH" | tr -d ' ')"
  [ "$MAPLE_DOWNLOADED_SIZE" -eq "$MAPLE_FILE_SIZE" ] \
    || { echo "[maple-local] Downloaded payload size mismatch: $MAPLE_RELATIVE_PATH" >&2; exit 1; }
  MAPLE_COMPLETED_BYTES=$((MAPLE_COMPLETED_BYTES + MAPLE_FILE_SIZE))
  maple_show_progress "$MAPLE_COMPLETED_BYTES" "$MAPLE_TOTAL_BYTES" "$MAPLE_FILE_INDEX" "$MAPLE_TOTAL_FILES" "$MAPLE_COMPONENT_LABEL"
done < "$MAPLE_LOCAL_STAGING_DIR/.manifest"
if [ -n "$MAPLE_ACTIVE_COMPONENT" ]; then echo "[maple-local]       $MAPLE_ACTIVE_COMPONENT downloaded."; fi
rm -f "$MAPLE_LOCAL_STAGING_DIR/.manifest"
echo "[maple-local]       Server, WebUI and CUI downloaded and validated."

printf '%s\n' '{"name":"maple-local-runtime","private":true}' > "$MAPLE_LOCAL_STAGING_DIR/package.json"
printf '%s\n' "$MAPLE_SOURCE_URL" > "$MAPLE_LOCAL_STAGING_DIR/.update-source"
MAPLE_CURRENT_STAGE="[4/9] installing the platform image runtime"
echo "[maple-local] [4/9] Installing the platform image runtime..."
(
  cd "$MAPLE_LOCAL_STAGING_DIR"
  "$MAPLE_BUN_BIN" add --exact sharp@0.35.3
)
echo "[maple-local]       Platform image runtime installed."

MAPLE_CURRENT_STAGE="[5/9] verifying the downloaded version"
echo "[maple-local] [5/9] Verifying the downloaded version..."
test -s "$MAPLE_LOCAL_STAGING_DIR/maple-local.js" || { echo "[maple-local] CLI payload is incomplete." >&2; exit 1; }
test -s "$MAPLE_LOCAL_STAGING_DIR/web/index.html" || { echo "[maple-local] WebUI payload is incomplete." >&2; exit 1; }
find "$MAPLE_LOCAL_STAGING_DIR/node_modules/@img" -type f -name '*.node' -print -quit | grep -q . \
  || { echo "[maple-local] Platform image runtime is incomplete." >&2; exit 1; }
chmod 0755 "$MAPLE_LOCAL_STAGING_DIR/maple-local.js"
"$MAPLE_BUN_BIN" "$MAPLE_LOCAL_STAGING_DIR/maple-local.js" help >/dev/null
echo "[maple-local]       Downloaded version verified."

MAPLE_CURRENT_STAGE="[6/9] publishing the downloaded version"
echo "[maple-local] [6/9] Publishing the downloaded version..."
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
echo "[maple-local]       Version published to $MAPLE_LOCAL_APP_DIR"

MAPLE_CURRENT_STAGE="[7/9] configuring commands and user PATH"
echo "[maple-local] [7/9] Configuring commands and user PATH..."
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
echo "[maple-local]       Command ready: $MAPLE_BIN_DIR/maple-local"

MAPLE_CURRENT_STAGE="[8/9] preparing Playwright screenshot runtime"
echo "[maple-local] [8/9] Preparing Playwright screenshot runtime..."
if [ "${MAPLE_SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]; then
  MAPLE_PLAYWRIGHT_DIR="$MAPLE_RUNTIME_DIR/playwright"
  mkdir -p "$MAPLE_PLAYWRIGHT_DIR"
  test -f "$MAPLE_PLAYWRIGHT_DIR/package.json" \
    || printf '%s\n' '{"name":"maple-playwright-runtime","private":true}' > "$MAPLE_PLAYWRIGHT_DIR/package.json"
  MAPLE_CURRENT_STAGE="[8/9] installing the Playwright package"
  echo "[maple-local]       Installing Playwright package..."
  (cd "$MAPLE_PLAYWRIGHT_DIR" && "$MAPLE_BUN_BIN" add --exact playwright@1.61.1)
  MAPLE_CURRENT_STAGE="[8/9] installing the Chromium browser"
  echo "[maple-local]       Installing Chromium browser..."
  PLAYWRIGHT_BROWSERS_PATH="$MAPLE_PLAYWRIGHT_DIR/browsers" \
    "$MAPLE_BUN_BIN" "$MAPLE_PLAYWRIGHT_DIR/node_modules/playwright/cli.js" install chromium --only-shell
  cat > "$MAPLE_PLAYWRIGHT_DIR/maple-playwright" <<EOF
#!/usr/bin/env sh
export PLAYWRIGHT_BROWSERS_PATH="$MAPLE_PLAYWRIGHT_DIR/browsers"
exec "$MAPLE_BUN_BIN" "$MAPLE_PLAYWRIGHT_DIR/node_modules/playwright/cli.js" "\$@"
EOF
  chmod 0755 "$MAPLE_PLAYWRIGHT_DIR/maple-playwright"
  echo "[maple-local]       Playwright and Chromium are ready."
else
  echo "[maple-local]       Skipped by MAPLE_SKIP_PLAYWRIGHT_INSTALL=1."
fi

MAPLE_CURRENT_STAGE="[9/9] completing installation"
echo "[maple-local] [9/9] Installation complete."
echo "[maple-local] Installed in $MAPLE_LOCAL_APP_DIR"
echo "[maple-local] Run: maple-local"
echo "[maple-local] Update later: maple-local update"
trap - EXIT HUP INT TERM

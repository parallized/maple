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
    printf '[maple]       Downloading %-12s %3d%%  %s / %s  (%d/%d)\n' \
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
  printf '\r[maple] [%s] %3d%%  %-12s  %s / %s  (%d/%d)' \
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
    echo "[maple] Installation failed during $MAPLE_CURRENT_STAGE." >&2
  fi
}

trap 'maple_report_exit "$?"' EXIT
trap 'exit 130' HUP INT TERM

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
MAPLE_HOME_DIR="${MAPLE_HOME_DIR:-${HOME}/.maple}"
MAPLE_BIN_DIR="${MAPLE_HOME_DIR}/bin"
MAPLE_RUNTIME_DIR="${MAPLE_HOME_DIR}/runtime"
MAPLE_LOCAL_APP_DIR="${MAPLE_HOME_DIR}/local-app"
MAPLE_LOCAL_STAGING_DIR="${MAPLE_HOME_DIR}/local-app.installing.$$"
MAPLE_LOCAL_BACKUP_DIR="${MAPLE_HOME_DIR}/local-app.previous.$$"
MAPLE_LOCAL_MANIFEST_URL="${MAPLE_SERVER_URL}/downloads/maple-local/manifest-v2.txt"

case "$MAPLE_LOCAL_STAGING_DIR" in
  "${MAPLE_HOME_DIR}"/local-app.installing.*) ;;
  *) echo "[maple] Invalid staging directory." >&2; exit 1 ;;
esac
case "$MAPLE_LOCAL_BACKUP_DIR" in
  "${MAPLE_HOME_DIR}"/local-app.previous.*) ;;
  *) echo "[maple] Invalid backup directory." >&2; exit 1 ;;
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

MAPLE_CURRENT_STAGE="[1/12] preparing installation directories"
echo "[maple] [1/12] Preparing installation directories..."
mkdir -p "$MAPLE_BIN_DIR" "$MAPLE_RUNTIME_DIR" "${HOME}/.local/bin"
rm -rf "$MAPLE_LOCAL_STAGING_DIR" "$MAPLE_LOCAL_BACKUP_DIR"
mkdir -p "$MAPLE_LOCAL_STAGING_DIR"
echo "[maple]       Directories ready: $MAPLE_HOME_DIR"

MAPLE_CURRENT_STAGE="[2/12] checking Bun runtime"
echo "[maple] [2/12] Checking Bun runtime..."
if command -v bun >/dev/null 2>&1; then
  MAPLE_BUN_BIN="$(command -v bun)"
else
  echo "[maple]       Bun was not found; installing it now."
  curl -fsSL https://bun.sh/install | bash
  MAPLE_BUN_BIN="${HOME}/.bun/bin/bun"
fi
test -x "$MAPLE_BUN_BIN" || { echo "[maple] Bun installation failed." >&2; exit 1; }
echo "[maple]       Using Bun: $MAPLE_BUN_BIN"

MAPLE_CURRENT_STAGE="[3/12] asking about the Playwright screenshot runtime"
echo "[maple] [3/12] Asking about the Playwright screenshot runtime..."
if [ "${MAPLE_LAUNCHED_BY_UPDATER:-0}" = "1" ]; then
  echo "[maple]       更新模式：沿用默认安装（跳过请设 MAPLE_SKIP_PLAYWRIGHT_INSTALL=1）。"
elif [ "${MAPLE_SKIP_PLAYWRIGHT_INSTALL:-0}" = "1" ]; then
  echo "[maple]       Playwright 已跳过（MAPLE_SKIP_PLAYWRIGHT_INSTALL=1）。"
elif [ -t 0 ]; then
  printf "[maple]       是否安装 Playwright 截图功能（可选截图验收用）？[Y/n] "
  MAPLE_PLAYWRIGHT_ANSWER=""
  IFS= read -r MAPLE_PLAYWRIGHT_ANSWER || MAPLE_PLAYWRIGHT_ANSWER=""
  case "$MAPLE_PLAYWRIGHT_ANSWER" in
    n|N|no|NO|No)
      echo "[maple]       Playwright 已跳过。"
      MAPLE_SKIP_PLAYWRIGHT_INSTALL=1
      ;;
    *)
      echo "[maple]       将安装 Playwright（截图验收用）。"
      ;;
  esac
else
  echo "[maple]       非交互安装：默认安装 Playwright（跳过请设 MAPLE_SKIP_PLAYWRIGHT_INSTALL=1）。"
fi

MAPLE_CURRENT_STAGE="[4/12] downloading the Maple CLI"
echo "[maple] [4/12] Downloading the Maple CLI..."
maple_download_with_progress "$MAPLE_SERVER_URL/downloads/maple-cli.js" "$MAPLE_BIN_DIR/maple-cli.js.download"
test "$(wc -c < "$MAPLE_BIN_DIR/maple-cli.js.download")" -gt 10000 || { echo "[maple] Downloaded CLI is incomplete." >&2; exit 1; }
mv "$MAPLE_BIN_DIR/maple-cli.js.download" "$MAPLE_BIN_DIR/maple-cli.js"
echo "[maple]       CLI downloaded and validated."

MAPLE_CURRENT_STAGE="[5/12] configuring the maple command and user PATH"
echo "[maple] [5/12] Configuring the maple command and user PATH..."
cat > "$MAPLE_BIN_DIR/maple" <<EOF
#!/usr/bin/env sh
exec "$MAPLE_BUN_BIN" "$MAPLE_BIN_DIR/maple-cli.js" "\$@"
EOF
chmod 0755 "$MAPLE_BIN_DIR/maple"
ln -sf "$MAPLE_BIN_DIR/maple" "${HOME}/.local/bin/maple"
echo "[maple]       Command ready: $MAPLE_BIN_DIR/maple"

MAPLE_CURRENT_STAGE="[6/12] initializing and verifying the CLI runtime"
echo "[maple] [6/12] Initializing and verifying the CLI runtime..."
"$MAPLE_BIN_DIR/maple" status >/dev/null
echo "[maple]       CLI runtime verified."

MAPLE_CURRENT_STAGE="[7/12] downloading the local service payload"
echo "[maple] [7/12] Downloading the local service payload (Server + WebUI + CLI)..."
curl -fsSL --retry 3 "$MAPLE_LOCAL_MANIFEST_URL" -o "$MAPLE_LOCAL_STAGING_DIR/.manifest"
MAPLE_MANIFEST_TAB="$(printf '\t')"
MAPLE_TOTAL_BYTES=0
MAPLE_TOTAL_FILES=0
while IFS="$MAPLE_MANIFEST_TAB" read -r MAPLE_FILE_SIZE MAPLE_RELATIVE_PATH || [ -n "${MAPLE_FILE_SIZE}${MAPLE_RELATIVE_PATH}" ]; do
  [ -n "$MAPLE_RELATIVE_PATH" ] || continue
  case "$MAPLE_FILE_SIZE" in
    ''|*[!0-9]*) echo "[maple] Invalid size in download manifest." >&2; exit 1 ;;
  esac
  case "$MAPLE_RELATIVE_PATH" in
    /*|*..*|*\\*) echo "[maple] Invalid file in download manifest." >&2; exit 1 ;;
  esac
  MAPLE_TOTAL_BYTES=$((MAPLE_TOTAL_BYTES + MAPLE_FILE_SIZE))
  MAPLE_TOTAL_FILES=$((MAPLE_TOTAL_FILES + 1))
done < "$MAPLE_LOCAL_STAGING_DIR/.manifest"
[ "$MAPLE_TOTAL_FILES" -gt 0 ] && [ "$MAPLE_TOTAL_BYTES" -gt 0 ] \
  || { echo "[maple] Download manifest is empty." >&2; exit 1; }
echo "[maple]       Payload: $MAPLE_TOTAL_FILES files, $(maple_format_bytes "$MAPLE_TOTAL_BYTES")."

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
      echo "[maple]       $MAPLE_ACTIVE_COMPONENT downloaded."
    fi
    MAPLE_ACTIVE_COMPONENT="$MAPLE_COMPONENT_LABEL"
    echo "[maple]       Downloading $MAPLE_ACTIVE_COMPONENT..."
  fi
  MAPLE_CURRENT_STAGE="[7/12] downloading $MAPLE_COMPONENT_LABEL ($MAPLE_FILE_INDEX/$MAPLE_TOTAL_FILES): $MAPLE_RELATIVE_PATH"
  maple_show_progress "$MAPLE_COMPLETED_BYTES" "$MAPLE_TOTAL_BYTES" "$MAPLE_FILE_INDEX" "$MAPLE_TOTAL_FILES" "$MAPLE_COMPONENT_LABEL"
  MAPLE_TARGET_PATH="${MAPLE_LOCAL_STAGING_DIR}/${MAPLE_RELATIVE_PATH}"
  mkdir -p "$(dirname "$MAPLE_TARGET_PATH")"
  maple_download_payload \
    "${MAPLE_SERVER_URL}/downloads/maple-local/${MAPLE_RELATIVE_PATH}" \
    "$MAPLE_TARGET_PATH" \
    "$MAPLE_FILE_SIZE"
  MAPLE_DOWNLOADED_SIZE="$(wc -c < "$MAPLE_TARGET_PATH" | tr -d ' ')"
  [ "$MAPLE_DOWNLOADED_SIZE" -eq "$MAPLE_FILE_SIZE" ] \
    || { echo "[maple] Downloaded payload size mismatch: $MAPLE_RELATIVE_PATH" >&2; exit 1; }
  MAPLE_COMPLETED_BYTES=$((MAPLE_COMPLETED_BYTES + MAPLE_FILE_SIZE))
  maple_show_progress "$MAPLE_COMPLETED_BYTES" "$MAPLE_TOTAL_BYTES" "$MAPLE_FILE_INDEX" "$MAPLE_TOTAL_FILES" "$MAPLE_COMPONENT_LABEL"
done < "$MAPLE_LOCAL_STAGING_DIR/.manifest"
if [ -n "$MAPLE_ACTIVE_COMPONENT" ]; then echo "[maple]       $MAPLE_ACTIVE_COMPONENT downloaded."; fi
rm -f "$MAPLE_LOCAL_STAGING_DIR/.manifest"
printf '%s\n' '{"name":"maple-local-runtime","private":true}' > "$MAPLE_LOCAL_STAGING_DIR/package.json"
printf '%s\n' "$MAPLE_SERVER_URL" > "$MAPLE_LOCAL_STAGING_DIR/.update-source"
echo "[maple]       Server, WebUI and CLI downloaded and validated."

MAPLE_CURRENT_STAGE="[8/12] verifying the downloaded local service"
echo "[maple] [8/12] Verifying the downloaded local service..."
test -s "$MAPLE_LOCAL_STAGING_DIR/maple-local.js" || { echo "[maple] CLI payload is incomplete." >&2; exit 1; }
test -s "$MAPLE_LOCAL_STAGING_DIR/web/index.html" || { echo "[maple] WebUI payload is incomplete." >&2; exit 1; }
chmod 0755 "$MAPLE_LOCAL_STAGING_DIR/maple-local.js"
"$MAPLE_BUN_BIN" "$MAPLE_LOCAL_STAGING_DIR/maple-local.js" help >/dev/null
echo "[maple]       Downloaded version verified."

MAPLE_CURRENT_STAGE="[9/12] publishing the local service"
echo "[maple] [9/12] Publishing the local service..."
if [ -d "$MAPLE_LOCAL_APP_DIR" ]; then
  move_with_retry "$MAPLE_LOCAL_APP_DIR" "$MAPLE_LOCAL_BACKUP_DIR" \
    || { echo "[maple] Close Maple Local before updating." >&2; exit 1; }
fi
if ! move_with_retry "$MAPLE_LOCAL_STAGING_DIR" "$MAPLE_LOCAL_APP_DIR"; then
  if [ -d "$MAPLE_LOCAL_BACKUP_DIR" ]; then
    move_with_retry "$MAPLE_LOCAL_BACKUP_DIR" "$MAPLE_LOCAL_APP_DIR" || true
  fi
  echo "[maple] Unable to publish the downloaded version." >&2
  exit 1
fi
if [ -d "$MAPLE_LOCAL_BACKUP_DIR" ]; then rm -rf "$MAPLE_LOCAL_BACKUP_DIR"; fi
echo "[maple]       Version published to $MAPLE_LOCAL_APP_DIR"

MAPLE_CURRENT_STAGE="[10/12] configuring the maple-local command and user PATH"
echo "[maple] [10/12] Configuring the maple-local command and user PATH..."
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
curl -fsSL --retry 3 "${MAPLE_UPDATE_SOURCE}/install.sh" \
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
echo "[maple]       Command ready: $MAPLE_BIN_DIR/maple-local"
echo "[maple]       Update later: maple-local update"

MAPLE_CURRENT_STAGE="[11/12] preparing the Playwright screenshot runtime"
echo "[maple] [11/12] Preparing the Playwright screenshot runtime..."
if [ "${MAPLE_SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]; then
  MAPLE_PLAYWRIGHT_DIR="$MAPLE_RUNTIME_DIR/playwright"
  mkdir -p "$MAPLE_PLAYWRIGHT_DIR"
  test -f "$MAPLE_PLAYWRIGHT_DIR/package.json" || printf '%s\n' '{"name":"maple-playwright-runtime","private":true}' > "$MAPLE_PLAYWRIGHT_DIR/package.json"
  MAPLE_CURRENT_STAGE="[11/12] installing the Playwright package"
  echo "[maple]       Installing Playwright package..."
  (cd "$MAPLE_PLAYWRIGHT_DIR" && "$MAPLE_BUN_BIN" add --exact playwright@1.61.1)
  MAPLE_CURRENT_STAGE="[11/12] installing the Chromium browser"
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

# Report only after the CLI, the local service and the optional runtime have been installed successfully.
# The event ID makes curl retries idempotent; statistics failure never breaks installation.
MAPLE_CURRENT_STAGE="[12/12] finalizing installation"
echo "[maple] [12/12] Finalizing installation..."
if [ -r /dev/urandom ] && command -v od >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then
  MAPLE_INSTALL_EVENT_ID="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
else
  MAPLE_INSTALL_EVENT_ID="maple-$(date +%s)-$$-install"
fi
curl -fsS --retry 2 -X POST \
  -H "x-maple-install-id: $MAPLE_INSTALL_EVENT_ID" \
  "$MAPLE_SERVER_URL/api/downloads/install-sh" >/dev/null 2>&1 || true

MAPLE_CURRENT_STAGE="[12/12] completing installation"
echo "[maple] [12/12] Installation complete."
echo "[maple] Installed in $MAPLE_HOME_DIR"
echo "[maple] Connect with: maple connect --server $MAPLE_SERVER_URL"
echo "[maple] Run local service with: maple-local"
trap - EXIT HUP INT TERM

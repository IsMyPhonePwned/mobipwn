#!/usr/bin/env bash
# One command to run the full local stack (DBs in Docker, app on host).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PID_DIR="$ROOT/.dev"
API_PID="$PID_DIR/api.pid"
JOBS_PID="$PID_DIR/jobs.pid"
WEB_PID="$PID_DIR/web.pid"
WEB_PORT="${MOBIPWN_WEB_PORT:-5173}"
API_PORT=$((WEB_PORT + 1))
MOBIPWN_WEB_PORT_FROM_CLI=0

load_env() {
  local cli_port=""
  local cli_insecure="${MOBIPWN_CARGO_INSECURE_SSL:-0}"
  local cli_logarchive="${MOBIPWN_LOGARCHIVE_DECODE:-0}"
  local cli_wasm_profile="${MOBIPWN_WASM_PROFILE:-}"
  if [[ "${MOBIPWN_WEB_PORT_FROM_CLI:-0}" == 1 ]]; then
    cli_port="$MOBIPWN_WEB_PORT"
  fi
  # shellcheck disable=SC1091
  source "$ROOT/scripts/ensure-env.sh"
  if [[ -f "$PID_DIR/ports.env" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$PID_DIR/ports.env"
    set +a
  fi
  # CLI flags win over persisted ports.env for this invocation.
  [[ "$cli_insecure" == 1 ]] && export MOBIPWN_CARGO_INSECURE_SSL=1
  [[ "$cli_logarchive" == 1 ]] && export MOBIPWN_LOGARCHIVE_DECODE=1
  if [[ -n "$cli_wasm_profile" ]]; then
    export MOBIPWN_WASM_PROFILE="$cli_wasm_profile"
  fi
  export MOBIPWN_WASM_PROFILE="${MOBIPWN_WASM_PROFILE:-release}"
  load_mobipwn_env "$ROOT"
  apply_cargo_network_config "$ROOT"
  if [[ -n "$cli_port" ]]; then
    export MOBIPWN_WEB_PORT="$cli_port"
  fi
  WEB_PORT="${MOBIPWN_WEB_PORT:-5173}"
  API_PORT=$((WEB_PORT + 1))
  export MOBIPWN_WEB_PORT="$WEB_PORT"
  export MOBIPWN_API_BIND="0.0.0.0:${API_PORT}"
  export VITE_API_URL="http://127.0.0.1:${API_PORT}"
}

port_listener_pids() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :"$port" 2>/dev/null || true
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null | sed -n 's/.*: *//p' | tr ' ' '\n' | grep -E '^[0-9]+$' || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true
  fi
}

free_port() {
  local port=$1
  local pids
  pids=$(port_listener_pids "$port")
  if [[ -n "$pids" ]]; then
    echo "    Freeing port $port (was in use)"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
}

port_is_listening() {
  local port=$1
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -qE ":${port}\b"
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -i :"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  return 1
}

cargo_api_features() {
  if [[ "${MOBIPWN_LOGARCHIVE_DECODE:-0}" == 1 ]]; then
    printf '%s\n' --features logarchive-decode
  fi
}

wait_for_db() {
  echo "==> Waiting for Postgres + ClickHouse"
  local pg_ok=0 ch_ok=0
  for i in $(seq 1 90); do
    if docker compose ps postgres --status running -q 2>/dev/null | grep -q . \
      && docker compose exec -T postgres pg_isready -U mobipwn -d mobipwn -q 2>/dev/null; then
      pg_ok=1
    fi
    if docker compose exec -T clickhouse clickhouse-client \
      --user "$MOBIPWN_CLICKHOUSE_USER" --password "$MOBIPWN_CLICKHOUSE_PASSWORD" \
      -q "SELECT 1" >/dev/null 2>&1; then
      ch_ok=1
    fi
    if [[ "$pg_ok" == 1 && "$ch_ok" == 1 ]]; then
      return 0
    fi
    sleep 1
  done
  echo "Databases did not become ready in time." >&2
  docker compose ps postgres clickhouse 2>&1 || true
  if [[ "$pg_ok" == 0 ]]; then
    docker compose logs postgres --tail 15 2>&1 >&2 || true
  fi
  exit 1
}

wait_for_api() {
  echo "==> Waiting for API on :${API_PORT}"
  local code="000"
  for _ in $(seq 1 120); do
    code=$(curl -sS --max-time 2 -o /dev/null -w "%{http_code}" "http://127.0.0.1:${API_PORT}/health" 2>/dev/null || echo "000")
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    if ! kill -0 "$(cat "$API_PID" 2>/dev/null)" 2>/dev/null; then
      echo "mobipwn-api exited. Last log lines:" >&2
      tail -20 "$PID_DIR/api.log" >&2 || true
      return 1
    fi
    sleep 1
  done
  echo "API did not become ready (last /health HTTP $code). See $PID_DIR/api.log" >&2
  if [[ "$code" == "401" ]]; then
    echo "Hint: /health must stay on the public router when MOBIPWN_REQUIRE_AUTH is enabled." >&2
  fi
  tail -15 "$PID_DIR/api.log" >&2 || true
  return 1
}

detect_web_url() {
  if [[ -f "$PID_DIR/web.log" ]]; then
    local url
    url=$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$PID_DIR/web.log" | tail -1 || true)
    if [[ -z "$url" ]]; then
      url=$(grep -oE 'http://localhost:[0-9]+' "$PID_DIR/web.log" | tail -1 | sed 's/localhost/127.0.0.1/' || true)
    fi
    if [[ -n "$url" ]]; then
      echo "$url"
      return
    fi
  fi
  echo "http://127.0.0.1:${WEB_PORT}"
}

stop_app() {
  load_env
  mkdir -p "$PID_DIR"
  for f in "$WEB_PID" "$JOBS_PID" "$API_PID"; do
    if [[ -f "$f" ]]; then
      kill "$(cat "$f")" 2>/dev/null || true
      rm -f "$f"
    fi
  done
  pkill -f "target/debug/mobipwn-api" 2>/dev/null || true
  pkill -f "target/debug/mobipwn-jobs" 2>/dev/null || true
  pkill -f "target/debug/mobipwn-mcp" 2>/dev/null || true
  pkill -f "vite.*mobipwn-web" 2>/dev/null || true
  free_port "$WEB_PORT"
  free_port "$API_PORT"
}

cmd_down() {
  stop_app
  echo "==> Stopping Docker services"
  docker compose down
  echo "Stopped."
}

# Wipe Postgres + ClickHouse Docker volumes (all events, cases, migrations state in DB).
cleanup_database() {
  stop_app
  echo "==> Removing database volumes (Postgres pgdata, ClickHouse chdata)"
  docker compose down -v
  echo "    Fresh databases on next start (ClickHouse init.sql + API migrations re-applied)."
}

cmd_clean() {
  command -v docker >/dev/null || { echo "Docker required" >&2; exit 1; }
  cleanup_database
  echo "Done. Start stack: ./dev.sh"
}

cmd_restart() {
  cmd_down
  cmd_up
}

cmd_up() {
  command -v docker >/dev/null || { echo "Docker required" >&2; exit 1; }
  command -v cargo >/dev/null || { echo "Rust/cargo required" >&2; exit 1; }
  command -v npm >/dev/null || { echo "Node/npm required" >&2; exit 1; }

  load_env
  mkdir -p "$PID_DIR"
  {
    echo "MOBIPWN_WEB_PORT=$WEB_PORT"
    echo "MOBIPWN_LOGARCHIVE_DECODE=${MOBIPWN_LOGARCHIVE_DECODE:-0}"
    echo "MOBIPWN_CARGO_INSECURE_SSL=${MOBIPWN_CARGO_INSECURE_SSL:-0}"
    echo "MOBIPWN_WASM_PROFILE=${MOBIPWN_WASM_PROFILE:-release}"
  } >"$PID_DIR/ports.env"
  stop_app

  if [[ "${CLEAN_DB:-0}" == 1 ]]; then
    cleanup_database
  fi

  echo "==> Docker: Postgres + ClickHouse"
  docker compose up -d postgres clickhouse
  sleep 2
  if ! docker compose ps postgres --status running -q 2>/dev/null | grep -q .; then
    echo "Postgres failed to start. Try: docker compose down && docker volume rm mobipwn_pgdata && ./dev.sh" >&2
    docker compose logs postgres --tail 12 2>&1 >&2 || true
    exit 1
  fi
  wait_for_db

  echo "==> ClickHouse schema"
  "$ROOT/scripts/ch-migrate.sh"

  if command -v docker >/dev/null && docker compose ps clickhouse --status running -q 2>/dev/null | grep -q .; then
    ch_count=$(docker compose exec -T clickhouse clickhouse-client --user "$MOBIPWN_CLICKHOUSE_USER" --password "$MOBIPWN_CLICKHOUSE_PASSWORD" -q "SELECT count() FROM ${MOBIPWN_CLICKHOUSE_DB}.events" 2>/dev/null || echo "?")
    echo "    ClickHouse events on disk: ${ch_count}"
  fi

  free_port "$API_PORT"
  free_port "$WEB_PORT"

  echo "==> mobipwn-api :${API_PORT}"
  if [[ "${MOBIPWN_LOGARCHIVE_DECODE:-0}" == 1 ]]; then
    echo "    (logarchive unified-log decode enabled)"
  fi
  if [[ "${MOBIPWN_CARGO_INSECURE_SSL:-0}" == 1 ]]; then
    echo "    (cargo SSL workarounds enabled — .cargo/config.toml + CA bundle)"
  elif [[ -n "${HTTP_PROXY:-}" ]]; then
    echo "    (cargo proxy fixes enabled — sparse index + git CLI via HTTP_PROXY)"
  fi
  # shellcheck disable=SC2046
  cargo build -p mobipwn-api -p mobipwn-mcp $(cargo_api_features)
  # shellcheck disable=SC2046
  cargo run -p mobipwn-api $(cargo_api_features) >"$PID_DIR/api.log" 2>&1 &
  echo $! >"$API_PID"
  wait_for_api

  if [[ "${MOBIPWN_JOBS_ENABLED}" != "0" ]]; then
    echo "==> mobipwn-jobs"
    cargo run -p mobipwn-jobs >"$PID_DIR/jobs.log" 2>&1 &
    echo $! >"$JOBS_PID"
  fi

  if [[ "${MOBIPWN_REBUILD_WASM:-0}" == "1" ]]; then
    echo "==> WebUSB wasm (webadb + idevice-rs) [${MOBIPWN_WASM_PROFILE:-release}]"
    wasm_profile="${MOBIPWN_WASM_PROFILE:-release}"
    if [[ "$wasm_profile" != "dev" && "$wasm_profile" != "release" ]]; then
      echo "Invalid MOBIPWN_WASM_PROFILE=$wasm_profile (use dev or release)" >&2
      exit 1
    fi
    if ! command -v wasm-pack >/dev/null 2>&1; then
      echo "    WARN: wasm-pack missing — skip WebUSB wasm rebuild (cargo install wasm-pack)" >&2
    else
      echo "    building webadb-wasm ($wasm_profile)…"
      bash "$ROOT/scripts/build-webadb-wasm.sh" "$wasm_profile" \
        || echo "    WARN: webadb-wasm build failed — /collect Android WebUSB may be stale" >&2
      echo "    building idevice-wasm ($wasm_profile)…"
      bash "$ROOT/scripts/build-idevice-wasm.sh" "$wasm_profile" \
        || echo "    WARN: idevice-wasm build failed — iOS WebUSB needs LLVM clang (brew install llvm) + sibling idevice-rs" >&2
    fi
  fi

  if [[ ! -f "$ROOT/mobipwn-web/public/vendor/rusty-magpie/rusty_magpie" ]]; then
    echo "==> mobi-android-collector (Rusty Magpie)"
    if [[ -x "$ROOT/scripts/ensure-rusty-magpie.sh" ]]; then
      "$ROOT/scripts/ensure-rusty-magpie.sh" || echo "    (skipped — fetch prebuilt or set ANDROID_NDK_HOME; see mobi-android-collector/README.mobipwn.md)"
    fi
  fi

  echo "==> mobipwn-web :${WEB_PORT}"
  node_major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$node_major" -lt 20 ]]; then
    echo "WARN: Node $(node -v) is older than mobipwn-web requires (>=20); Tailwind may need scripts/ensure-tailwind-oxide.sh" >&2
  fi
  ensure_npmrc "$ROOT"
  if [[ ! -d mobipwn-web/node_modules ]]; then
    (cd mobipwn-web && npm install)
  fi
  bash "$ROOT/scripts/ensure-tailwind-oxide.sh"
  (cd mobipwn-web && MOBIPWN_WEB_PORT="$WEB_PORT" VITE_API_URL="$VITE_API_URL" npm run dev) >"$PID_DIR/web.log" 2>&1 &
  echo $! >"$WEB_PID"

  sleep 3
  if ! kill -0 "$(cat "$WEB_PID")" 2>/dev/null; then
    echo "mobipwn-web exited. See $PID_DIR/web.log" >&2
    tail -15 "$PID_DIR/web.log" >&2 || true
    exit 1
  fi

  WEB_URL=$(detect_web_url)
  echo ""
  echo "mobipwn is running:"
  echo "  Web UI   $WEB_URL"
  echo "  API      http://127.0.0.1:${API_PORT}/health"
  echo "  Logs     $PID_DIR/*.log"
  echo ""
  echo "Stop:     ./dev.sh stop"
  echo "Restart:  ./dev.sh restart"
  echo "Reset DB: ./dev.sh --clean   (or: ./dev.sh clean && ./dev.sh)"
  echo ""
}

cmd_status() {
  load_env
  docker compose ps 2>/dev/null || true
  for name in api jobs web; do
    local f="$PID_DIR/${name}.pid"
    if [[ -f "$f" ]] && kill -0 "$(cat "$f")" 2>/dev/null; then
      echo "$name: running (pid $(cat "$f"))"
    else
      echo "$name: stopped"
    fi
  done
  if port_is_listening "$WEB_PORT"; then
    echo "web port: $WEB_PORT (listening)"
  fi
  if port_is_listening "$API_PORT"; then
    echo "api port: $API_PORT (listening)"
  fi
  if [[ "${MOBIPWN_LOGARCHIVE_DECODE:-0}" == 1 ]]; then
    echo "logarchive decode: enabled"
  else
    echo "logarchive decode: off (enable: ./dev.sh --logarchive-decode)"
  fi
  if [[ "${MOBIPWN_REBUILD_WASM:-0}" == 1 ]]; then
    echo "webusb wasm: rebuild on up (${MOBIPWN_WASM_PROFILE:-release})"
  fi
  if [[ -n "${HTTP_PROXY:-}" ]]; then
    echo "cargo proxy fixes: enabled (sparse index, git CLI — from HTTP_PROXY in .env)"
  fi
  if [[ "${MOBIPWN_CARGO_INSECURE_SSL:-0}" == 1 ]]; then
    echo "cargo ssl workarounds: enabled (CRL + git SSL relaxed — see docs/PROXY.md)"
  else
    echo "cargo ssl workarounds: off (enable: ./dev.sh --insecure-cargo-ssl)"
  fi
  curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && echo "api: healthy" || echo "api: not responding"
  if docker compose ps clickhouse --status running -q 2>/dev/null | grep -q .; then
    load_env 2>/dev/null || true
    ch_count=$(docker compose exec -T clickhouse clickhouse-client --user "${MOBIPWN_CLICKHOUSE_USER:-default}" --password "${MOBIPWN_CLICKHOUSE_PASSWORD:-mobipwn}" -q "SELECT count() FROM ${MOBIPWN_CLICKHOUSE_DB:-mobipwn}.events" 2>/dev/null || echo "?")
    echo "clickhouse events: ${ch_count} (persisted in volume mobipwn_chdata)"
  fi
}

CLEAN_DB=0
MOBIPWN_LOGARCHIVE_DECODE="${MOBIPWN_LOGARCHIVE_DECODE:-0}"
MOBIPWN_CARGO_INSECURE_SSL="${MOBIPWN_CARGO_INSECURE_SSL:-0}"
MOBIPWN_WASM_PROFILE="${MOBIPWN_WASM_PROFILE:-release}"
MOBIPWN_REBUILD_WASM="${MOBIPWN_REBUILD_WASM:-0}"
CMD_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean|--reset-db|-c)
      CLEAN_DB=1
      shift
      ;;
    --logarchive-decode)
      MOBIPWN_LOGARCHIVE_DECODE=1
      export MOBIPWN_LOGARCHIVE_DECODE
      shift
      ;;
    --insecure-cargo-ssl)
      MOBIPWN_CARGO_INSECURE_SSL=1
      export MOBIPWN_CARGO_INSECURE_SSL
      shift
      ;;
    --rebuild-wasm)
      MOBIPWN_REBUILD_WASM=1
      export MOBIPWN_REBUILD_WASM
      shift
      ;;
    --wasm-dev)
      MOBIPWN_WASM_PROFILE=dev
      MOBIPWN_REBUILD_WASM=1
      export MOBIPWN_WASM_PROFILE MOBIPWN_REBUILD_WASM
      shift
      ;;
    --wasm-release)
      MOBIPWN_WASM_PROFILE=release
      MOBIPWN_REBUILD_WASM=1
      export MOBIPWN_WASM_PROFILE MOBIPWN_REBUILD_WASM
      shift
      ;;
    --port|-p)
      if [[ -z "${2:-}" ]]; then
        echo "Usage: $0 [--port PORT] …" >&2
        echo "  --port / -p requires a port number (e.g. 5180)" >&2
        exit 1
      fi
      if ! [[ "$2" =~ ^[0-9]+$ ]] || (( "$2" < 1 || "$2" > 65535 )); then
        echo "Invalid port: $2 (use 1–65535)" >&2
        exit 1
      fi
      MOBIPWN_WEB_PORT="$2"
      export MOBIPWN_WEB_PORT
      MOBIPWN_WEB_PORT_FROM_CLI=1
      export MOBIPWN_WEB_PORT_FROM_CLI
      shift 2
      ;;
    *)
      CMD_ARGS+=("$1")
      shift
      ;;
  esac
done
CMD="${CMD_ARGS[0]:-up}"
if [[ "$CMD" == clean && "${CMD_ARGS[1]:-}" =~ ^(up|start)$ ]]; then
  CLEAN_DB=1
  CMD=up
fi

case "$CMD" in
  up|start) cmd_up ;;
  down|stop) cmd_down ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  clean|reset-db) cmd_clean ;;
  *)
    echo "Usage: $0 [up|stop|restart|status|clean] [options]" >&2
    echo "  up          Start Docker DBs + API + web (default)" >&2
    echo "  up --clean  Wipe Postgres/ClickHouse volumes, then start fresh" >&2
    echo "  restart     Stop then start (same as: $0 stop && $0)" >&2
    echo "  clean       Only remove DB volumes (same as stop + docker compose down -v)" >&2
    echo "  stop        Stop app processes and Docker" >&2
    echo "" >&2
    echo "Options:" >&2
    echo "  --port, -p PORT       Web UI port (default 5173; API uses PORT+1, e.g. 5174)" >&2
    echo "  --logarchive-decode   Build API/ingest with unified log decode (macos-unifiedlogs)" >&2
    echo "  --insecure-cargo-ssl  Cargo/git SSL workarounds for corporate TLS interception" >&2
    echo "  --rebuild-wasm        Rebuild webadb + idevice-wasm on this up (off by default)" >&2
    echo "  --wasm-release        Same as --rebuild-wasm with release profile" >&2
    echo "  --wasm-dev            Same as --rebuild-wasm with fast/dev profile" >&2
    echo "  --clean, -c           Wipe database volumes on start (with up)" >&2
    echo "" >&2
    echo "Environment:" >&2
    echo "  MOBIPWN_LOGARCHIVE_DECODE=1   Same as --logarchive-decode (persisted in .dev/ports.env)" >&2
    echo "  MOBIPWN_CARGO_INSECURE_SSL=1  Same as --insecure-cargo-ssl (persisted in .dev/ports.env)" >&2
    echo "  MOBIPWN_REBUILD_WASM=1        Rebuild WebUSB wasm on up (off by default)" >&2
    echo "  MOBIPWN_WASM_PROFILE=dev|release  Profile used when rebuilding wasm" >&2
    echo "" >&2
    echo "Examples:" >&2
    echo "  $0 --port 5180" >&2
    echo "  $0 --logarchive-decode" >&2
    echo "  $0 --rebuild-wasm" >&2
    echo "  $0 --wasm-dev" >&2
    echo "  $0 up -p 3001 --clean" >&2
    exit 1
    ;;
esac

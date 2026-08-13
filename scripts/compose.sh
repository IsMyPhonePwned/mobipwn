#!/usr/bin/env bash
# Run the full MobiPwn stack in Docker or Podman (API, jobs, web, Postgres, ClickHouse).
# Host-based dev workflow remains: ./dev.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/scripts/compose-lib.sh"
# shellcheck disable=SC1091
source "$ROOT/scripts/ensure-env.sh"

# Export proxy (+ npm/cargo) from .env for compose interpolation and builds.
load_mobipwn_env "$ROOT"
apply_cargo_network_config "$ROOT"

COMPOSE_FILE="${MOBIPWN_COMPOSE_FILE:-$ROOT/docker-compose.stack.yml}"
export MOBIPWN_COMPOSE_FILE="$COMPOSE_FILE"

STACK_WEB_PORT="${MOBIPWN_STACK_WEB_PORT:-8080}"
API_PORT="${MOBIPWN_API_PORT:-3000}"

wait_for_databases() {
  echo "==> Waiting for Postgres + ClickHouse"
  local i
  for i in $(seq 1 90); do
    if compose_cmd -f "$COMPOSE_FILE" ps -q --status running postgres 2>/dev/null | grep -q . \
      && compose_cmd -f "$COMPOSE_FILE" exec -T postgres pg_isready -U mobipwn -d mobipwn -q 2>/dev/null; then
      if compose_cmd -f "$COMPOSE_FILE" exec -T clickhouse \
        clickhouse-client --user "${MOBIPWN_CLICKHOUSE_USER:-default}" \
        --password "${MOBIPWN_CLICKHOUSE_PASSWORD:-mobipwn}" -q "SELECT 1" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "Databases did not become ready in time." >&2
  compose_cmd -f "$COMPOSE_FILE" ps postgres clickhouse 2>&1 || true
  exit 1
}

wait_for_api_or_hint() {
  echo "==> Waiting for API"
  local i
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
      echo "API healthy on :${API_PORT}"
      return 0
    fi
    sleep 2
  done
  if compose_cmd -f "$COMPOSE_FILE" logs mobipwn-api --tail 30 2>&1 | grep -q "missing in the resolved migrations"; then
    echo "" >&2
    echo "API failed: Postgres has old migration history (pre-consolidated schema)." >&2
    echo "Reset volumes and restart:" >&2
    echo "  ./compose.sh up --clean --no-build" >&2
    echo "" >&2
  else
    echo "API not healthy yet — check: ./compose.sh logs mobipwn-api" >&2
  fi
}

cmd_up() {
  local clean=0
  local build=1
  local extra_args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --clean|-c) clean=1; shift ;;
      --no-build) build=0; shift ;;
      *) extra_args+=("$1"); shift ;;
    esac
  done

  if [[ "$clean" == 1 ]]; then
    echo "==> Removing stack volumes"
    compose_cmd -f "$COMPOSE_FILE" down -v
  fi

  echo "==> Starting databases ($(compose_engine))"
  compose_cmd -f "$COMPOSE_FILE" up -d postgres clickhouse
  wait_for_databases

  echo "==> ClickHouse schema + dictionaries"
  MOBIPWN_COMPOSE_FILE="$COMPOSE_FILE" "$ROOT/scripts/ch-migrate.sh"

  echo "==> Building and starting application services"
  "$ROOT/scripts/prepare-docker-deps.sh" || true
  if [[ "$build" == 1 ]]; then
    if ((${#extra_args[@]} > 0)); then
      compose_cmd -f "$COMPOSE_FILE" up -d --build "${extra_args[@]}"
    else
      compose_cmd -f "$COMPOSE_FILE" up -d --build
    fi
  elif ((${#extra_args[@]} > 0)); then
    compose_cmd -f "$COMPOSE_FILE" up -d "${extra_args[@]}"
  else
    compose_cmd -f "$COMPOSE_FILE" up -d
  fi

  wait_for_api_or_hint

  echo ""
  echo "MobiPwn stack is running:"
  echo "  Web UI   http://127.0.0.1:${STACK_WEB_PORT}/"
  echo "  API      http://127.0.0.1:${API_PORT}/health"
  echo "  Swagger  http://127.0.0.1:${API_PORT}/swagger-ui"
  echo "  Login    ${MOBIPWN_ADMIN_USER:-admin} / (see MOBIPWN_ADMIN_PASSWORD in .env)"
  echo ""
  echo "Stop:    ./compose.sh down"
  echo "Logs:    ./compose.sh logs"
  echo "Reset:   ./compose.sh up --clean   (wipe DB volumes, keep images)"
  echo "Remove:  ./compose.sh clean        (tear down stack + volumes + images)"
  echo ""
  echo "Optional profiles:"
  echo "  ./compose.sh up --profile search   # standalone mobipwn-search on :3002"
  echo "  ./compose.sh up --profile ingest   # Vector ingest agent"
  echo ""
  echo "Host dev (Rust + Vite): ./dev.sh"
}

cmd_down() {
  local wipe=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -v|--volumes) wipe=1; shift ;;
      *) shift ;;
    esac
  done
  if [[ "$wipe" == 1 ]]; then
    compose_cmd -f "$COMPOSE_FILE" down -v
  else
    compose_cmd -f "$COMPOSE_FILE" down
  fi
}

cmd_logs() {
  compose_cmd -f "$COMPOSE_FILE" logs -f --tail=200 "$@"
}

cmd_status() {
  compose_cmd -f "$COMPOSE_FILE" ps
  if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
    echo "api: healthy"
  else
    echo "api: not responding on :${API_PORT}"
  fi
}

cmd_build() {
  "$ROOT/scripts/prepare-docker-deps.sh" || true
  compose_cmd -f "$COMPOSE_FILE" build "$@"
}

cmd_clean() {
  local all=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --all|-a) all=1; shift ;;
      -y|--yes) shift ;;
      *) shift ;;
    esac
  done

  echo "==> Stopping MobiPwn stack and removing containers, networks, volumes"
  if [[ "$all" == 1 ]]; then
    echo "    (including pulled images: postgres, clickhouse, …)"
    compose_cmd -f "$COMPOSE_FILE" --profile '*' down -v --remove-orphans --rmi all
  else
    echo "    (local mobipwn images only; use --all to remove postgres/clickhouse images too)"
    compose_cmd -f "$COMPOSE_FILE" --profile '*' down -v --remove-orphans --rmi local
  fi

  if [[ -d "$ROOT/docker/deps" ]]; then
    find "$ROOT/docker/deps" -mindepth 1 ! -name '.gitkeep' -print0 2>/dev/null \
      | xargs -0 rm -rf 2>/dev/null || true
    echo "==> Cleared docker/deps build staging"
  fi

  echo ""
  echo "MobiPwn stack removed (pgdata, chdata, collect_blobs volumes deleted)."
  echo "Start fresh: ./compose.sh up"
}

CMD="${1:-up}"
shift || true

case "$CMD" in
  up|start) cmd_up "$@" ;;
  down|stop) cmd_down "$@" ;;
  clean|reset) cmd_clean "$@" ;;
  logs) cmd_logs "$@" ;;
  status|ps) cmd_status ;;
  build) cmd_build "$@" ;;
  *)
    echo "Usage: $0 [up|down|clean|logs|status|build] [options]" >&2
    echo "" >&2
    echo "  up [--clean] [--no-build]   Start full stack (default)" >&2
    echo "  down [-v]                   Stop stack (--volumes wipes DB data)" >&2
    echo "  clean [--all]               Remove stack: containers, volumes, networks," >&2
    echo "                              local images (pgdata/chdata/collect_blobs);" >&2
    echo "                              --all also removes postgres/clickhouse images" >&2
    echo "  logs [service...]           Follow logs" >&2
    echo "  status                      Service list + API health" >&2
    echo "  build [service...]          Rebuild images" >&2
    echo "" >&2
    echo "Uses docker compose or podman compose. Configure via .env (auto-created from .env.example)." >&2
    echo "Host dev workflow unchanged: ./dev.sh" >&2
    exit 1
    ;;
esac

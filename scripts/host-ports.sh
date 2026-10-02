#!/usr/bin/env bash
# Host TCP port helpers for MobiPwn compose / deploy.
# Sourced by scripts/compose.sh, scripts/dev.sh, and deploy/run.sh (as lib-host-ports.sh).
#
# Does not use `set -e` so it is safe to source from callers that already set it.

# True if something on the host is listening on TCP $1 (excluding our own mobipwn stack).
mobipwn_host_port_busy() {
  local port="$1"

  # Port already published by this project's containers → not a foreign conflict.
  if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null \
      | grep -E '(^|[/ ])mobipwn-' \
      | grep -qE "([0-9.:]|\[::\]):${port}->|:[[:space:]]*${port}->|0\.0\.0\.0:${port}->|\[::\]:${port}->"; then
      return 1
    fi
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    return 1
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE "[\\.:]${port}[[:space:]]" && return 0
    return 1
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && return 0
    return 1
  fi
  # Last resort (bash /dev/tcp)
  if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# Print a free port starting at $1 (tries up to 40 candidates).
mobipwn_pick_free_port() {
  local start="${1:?}"
  local max_tries="${2:-40}"
  local p="$start"
  local i=0
  while (( i < max_tries )); do
    if ! mobipwn_host_port_busy "$p"; then
      echo "$p"
      return 0
    fi
    p=$((p + 1))
    i=$((i + 1))
  done
  echo "mobipwn: no free TCP port near $start" >&2
  return 1
}

# Upsert KEY=VALUE in an .env-style file.
mobipwn_upsert_env() {
  local file="$1"
  local key="$2"
  local val="$3"
  local tmp
  tmp="$(mktemp)"
  if [[ -f "$file" ]]; then
    awk -v k="$key" -v v="$val" '
      BEGIN { done = 0 }
      index($0, k "=") == 1 { print k "=" v; done = 1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "$file" >"$tmp"
  else
    printf '%s=%s\n' "$key" "$val" >"$tmp"
  fi
  mv "$tmp" "$file"
}

# Resolve ClickHouse (and optionally Postgres/API/web) host publish ports.
# Prefers existing env values; if busy, picks the next free ports and exports them.
# If env_file is set, persists the chosen ports there.
#
# Usage: mobipwn_resolve_host_ports [env_file] [--with-app-ports]
mobipwn_resolve_host_ports() {
  local env_file=""
  local with_app=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --with-app-ports) with_app=1; shift ;;
      *)
        env_file="$1"
        shift
        ;;
    esac
  done

  local ch_http ch_native pg api web
  local changed=0

  ch_http="${MOBIPWN_CLICKHOUSE_HTTP_PORT:-8123}"
  ch_native="${MOBIPWN_CLICKHOUSE_NATIVE_PORT:-9000}"
  pg="${MOBIPWN_POSTGRES_PORT:-5432}"
  api="${MOBIPWN_API_PORT:-3000}"
  web="${MOBIPWN_STACK_WEB_PORT:-8080}"

  if mobipwn_host_port_busy "$ch_http"; then
    ch_http="$(mobipwn_pick_free_port "$ch_http")" || return 1
    echo "==> Host port busy: ClickHouse HTTP → ${ch_http}"
    changed=1
  fi
  if mobipwn_host_port_busy "$ch_native" || [[ "$ch_native" == "$ch_http" ]]; then
    local try="$ch_native"
    [[ "$try" == "9000" ]] && try=9001
    [[ "$try" == "$ch_http" ]] && try=$((try + 1))
    while mobipwn_host_port_busy "$try" || [[ "$try" == "$ch_http" ]]; do
      try=$((try + 1))
    done
    ch_native="$try"
    echo "==> Host port busy: ClickHouse native → ${ch_native}"
    changed=1
  fi

  if [[ "$with_app" == 1 ]]; then
    if mobipwn_host_port_busy "$pg"; then
      pg="$(mobipwn_pick_free_port "$pg")" || return 1
      echo "==> Host port busy: Postgres → ${pg}"
      changed=1
    fi
    if mobipwn_host_port_busy "$api"; then
      api="$(mobipwn_pick_free_port "$api")" || return 1
      echo "==> Host port busy: API → ${api}"
      changed=1
    fi
    if mobipwn_host_port_busy "$web"; then
      web="$(mobipwn_pick_free_port "$web")" || return 1
      echo "==> Host port busy: Web UI → ${web}"
      changed=1
    fi
  fi

  export MOBIPWN_CLICKHOUSE_HTTP_PORT="$ch_http"
  export MOBIPWN_CLICKHOUSE_NATIVE_PORT="$ch_native"
  # Host-side tools (dev.sh API) talk to ClickHouse via published HTTP port.
  if [[ "${MOBIPWN_CLICKHOUSE_URL:-}" == *"127.0.0.1:8123"* ]] \
    || [[ "${MOBIPWN_CLICKHOUSE_URL:-}" == *"localhost:8123"* ]] \
    || [[ -z "${MOBIPWN_CLICKHOUSE_URL:-}" ]]; then
    export MOBIPWN_CLICKHOUSE_URL="http://127.0.0.1:${ch_http}"
  fi

  if [[ "$with_app" == 1 ]]; then
    export MOBIPWN_POSTGRES_PORT="$pg"
    export MOBIPWN_API_PORT="$api"
    export MOBIPWN_STACK_WEB_PORT="$web"
  fi

  if [[ -n "$env_file" && "$changed" == 1 ]]; then
    mobipwn_upsert_env "$env_file" MOBIPWN_CLICKHOUSE_HTTP_PORT "$ch_http"
    mobipwn_upsert_env "$env_file" MOBIPWN_CLICKHOUSE_NATIVE_PORT "$ch_native"
    mobipwn_upsert_env "$env_file" MOBIPWN_CLICKHOUSE_URL "http://127.0.0.1:${ch_http}"
    if [[ "$with_app" == 1 ]]; then
      mobipwn_upsert_env "$env_file" MOBIPWN_POSTGRES_PORT "$pg"
      mobipwn_upsert_env "$env_file" MOBIPWN_API_PORT "$api"
      mobipwn_upsert_env "$env_file" MOBIPWN_STACK_WEB_PORT "$web"
    fi
    echo "==> Wrote remapped ports to $env_file"
  fi

  return 0
}

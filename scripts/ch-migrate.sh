#!/usr/bin/env bash
# Apply ClickHouse schema (clickhouse/init.sql) and enrichment dictionaries.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CH_URL="${MOBIPWN_CLICKHOUSE_URL:-http://127.0.0.1:8123}"
CH_USER="${MOBIPWN_CLICKHOUSE_USER:-default}"
CH_PASSWORD="${MOBIPWN_CLICKHOUSE_PASSWORD:-mobipwn}"
DB="${MOBIPWN_CLICKHOUSE_DB:-mobipwn}"
COMPOSE_FILE="${MOBIPWN_COMPOSE_FILE:-$ROOT/docker-compose.yml}"

# shellcheck disable=SC1091
source "$ROOT/scripts/compose-lib.sh"

ch_curl() {
  local sql="$1"
  local args=(
    -fsS
    "${CH_URL}/?database=${DB}"
    -H "X-ClickHouse-User: ${CH_USER}"
    --data-binary "$sql"
  )
  if [[ -n "$CH_PASSWORD" ]]; then
    args+=(-H "X-ClickHouse-Key: ${CH_PASSWORD}")
  fi
  curl "${args[@]}"
}

use_docker_client() {
  compose_engine >/dev/null 2>&1 \
    && compose_cmd -f "$COMPOSE_FILE" ps -q --status running clickhouse 2>/dev/null | grep -q .
}

run_file_docker() {
  local f="$1"
  compose_cmd -f "$COMPOSE_FILE" exec -T clickhouse \
    clickhouse-client --user "$CH_USER" --password "$CH_PASSWORD" --multiquery <"$f"
}

run_file_http() {
  local f="$1"
  grep -vE '^\s*(--|$)' "$f" | awk 'BEGIN{RS=";"} {gsub(/\n/," "); gsub(/^ +| +$/,""); if(length($0)>2) print $0}' | while read -r stmt; do
    [[ -z "$stmt" ]] && continue
    ch_curl "$stmt" >/dev/null
  done
}

run_file() {
  local f="$1"
  if use_docker_client; then
    run_file_docker "$f"
  else
    run_file_http "$f"
  fi
}

if use_docker_client; then
  compose_cmd -f "$COMPOSE_FILE" exec -T clickhouse \
    clickhouse-client --user "$CH_USER" --password "$CH_PASSWORD" -q "SELECT 1" >/dev/null
elif ! ch_curl "SELECT 1" >/dev/null 2>&1; then
  echo "ClickHouse not reachable. For Docker/Podman stack:" >&2
  echo "  ./compose.sh up" >&2
  echo "For host dev (DBs only):" >&2
  echo "  docker compose up -d clickhouse   # or podman compose" >&2
  echo "  export MOBIPWN_CLICKHOUSE_USER=default MOBIPWN_CLICKHOUSE_PASSWORD=mobipwn" >&2
  echo "Note: CH 24.8 has no default-password.xml; compose sets CLICKHOUSE_PASSWORD." >&2
  echo "Inspect: docker compose exec clickhouse cat /etc/clickhouse-server/users.d/default-user.xml" >&2
  exit 1
fi

INIT_SQL="$ROOT/clickhouse/init.sql"
echo "==> $INIT_SQL"
run_file "$INIT_SQL"

count="$(ch_curl "SELECT count() FROM ${DB}.events" 2>/dev/null || echo 0)"
echo "ClickHouse schema OK (db=$DB user=$CH_USER, events=${count})"

apply_enrichment_dictionaries() {
  local pw_esc="${CH_PASSWORD//\'/\'\'}"
  local sql
  sql=$(cat <<EOF
DROP DICTIONARY IF EXISTS ${DB}.ip_enrichment_dict;
CREATE DICTIONARY ${DB}.ip_enrichment_dict
(
    \`ip\` String,
    \`country\` String,
    \`city\` String
)
PRIMARY KEY ip
SOURCE(CLICKHOUSE(
    HOST 'localhost'
    PORT 9000
    USER '${CH_USER}'
    PASSWORD '${pw_esc}'
    DB '${DB}'
    TABLE 'ip_enrichments'
))
LIFETIME(MIN 300 MAX 600)
LAYOUT(HASHED());

DROP DICTIONARY IF EXISTS ${DB}.ioc_enrichment_dict;
CREATE DICTIONARY ${DB}.ioc_enrichment_dict
(
    \`indicator\` String,
    \`malware_family\` String,
    \`score\` Float32,
    \`vt_malicious\` UInt16,
    \`vt_harmless\` UInt16,
    \`vt_undetected\` UInt16,
    \`vt_suspicious\` UInt16,
    \`vt_reputation\` Int32
)
PRIMARY KEY indicator
SOURCE(CLICKHOUSE(
    HOST 'localhost'
    PORT 9000
    USER '${CH_USER}'
    PASSWORD '${pw_esc}'
    DB '${DB}'
    TABLE 'ioc_enrichments'
))
LIFETIME(MIN 300 MAX 600)
LAYOUT(HASHED());

DROP DICTIONARY IF EXISTS ${DB}.package_enrichment_dict;
CREATE DICTIONARY ${DB}.package_enrichment_dict
(
    \`package_id\` String,
    \`on_play_store\` UInt8,
    \`play_store_url\` String,
    \`app_title\` String
)
PRIMARY KEY package_id
SOURCE(CLICKHOUSE(
    HOST 'localhost'
    PORT 9000
    USER '${CH_USER}'
    PASSWORD '${pw_esc}'
    DB '${DB}'
    TABLE 'package_enrichments'
))
LIFETIME(MIN 300 MAX 600)
LAYOUT(HASHED());
EOF
)
  if use_docker_client; then
    echo "$sql" | compose_cmd -f "$COMPOSE_FILE" exec -T clickhouse \
      clickhouse-client --user "$CH_USER" --password "$CH_PASSWORD" --multiquery
  else
    echo "$sql" | awk 'BEGIN{RS=";"} {gsub(/\n/," "); gsub(/^ +| +$/,""); if(length($0)>2) print $0}' | while read -r stmt; do
      [[ -z "$stmt" ]] && continue
      ch_curl "$stmt" >/dev/null
    done
  fi
}

echo "==> enrichment dictionaries (with ClickHouse credentials)"
apply_enrichment_dictionaries

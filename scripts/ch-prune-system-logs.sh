#!/usr/bin/env bash
# Drop bloated ClickHouse *system* log tables (dev only). User data in mobipwn.* is untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

load_env() {
  if [[ -f .env ]]; then set -a; source .env; set +a; fi
}
load_env

CH_USER="${MOBIPWN_CLICKHOUSE_USER:-default}"
CH_PASS="${MOBIPWN_CLICKHOUSE_PASSWORD:-mobipwn}"

if ! docker compose ps clickhouse --status running -q 2>/dev/null | grep -q .; then
  echo "ClickHouse is not running. Start with: ./scripts/dev.sh" >&2
  exit 1
fi

echo "==> Dropping ClickHouse system log tables (mobipwn.* data is kept)"
TABLES=(
  asynchronous_metric_log
  text_log
  processors_profile_log
  trace_log
  query_log
  metric_log
  part_log
  query_views_log
  error_log
  session_log
  opentelemetry_span_log
  crash_log
)

for t in "${TABLES[@]}"; do
  docker compose exec -T clickhouse clickhouse-client --user "$CH_USER" --password "$CH_PASS" \
    -q "DROP TABLE IF EXISTS system.${t}" 2>/dev/null && echo "  dropped system.${t}" || true
done

echo "==> Recreate ClickHouse (applies dev-low-cpu.xml; mobipwn.* data kept in volume)"
docker compose up -d clickhouse
sleep 4

if ! docker compose ps clickhouse --status running -q 2>/dev/null | grep -q .; then
  echo "ClickHouse failed to start — check: docker compose logs clickhouse --tail 30" >&2
  exit 1
fi

echo "==> Remaining disk usage (top tables)"
docker compose exec -T clickhouse clickhouse-client --user "$CH_USER" --password "$CH_PASS" -q "
SELECT database, table, sum(rows) rows, formatReadableSize(sum(bytes_on_disk)) disk
FROM system.parts WHERE active
GROUP BY database, table ORDER BY sum(bytes_on_disk) DESC LIMIT 10
" 2>/dev/null || true

echo ""
echo "Done. Check CPU: docker stats --no-stream mobipwn-clickhouse-1"

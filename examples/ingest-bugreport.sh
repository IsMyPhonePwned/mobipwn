#!/usr/bin/env bash
# Parse an Android bugreport and send events to mobipwn SIEM.
#
# Prereqs:
#   - docker compose up -d postgres clickhouse
#   - sibling repo: ../bugreport-extractor-library
#   - MOBIPWN_CLICKHOUSE_URL (default http://127.0.0.1:8123)
#
# Usage:
#   ./examples/ingest-bugreport.sh /path/to/bugreport.zip case-2024-001
#   ./examples/ingest-bugreport.sh /path/to/bugreport.txt lab-phone --api

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INPUT="${1:?usage: ingest-bugreport.sh <bugreport.txt|zip> <source-label> [--api]}"
SOURCE="${2:?usage: ingest-bugreport.sh <file> <source-label>}"
USE_API="${3:-}"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export MOBIPWN_CLICKHOUSE_URL="${MOBIPWN_CLICKHOUSE_URL:-http://127.0.0.1:8123}"
export MOBIPWN_CLICKHOUSE_USER="${MOBIPWN_CLICKHOUSE_USER:-default}"
export MOBIPWN_CLICKHOUSE_PASSWORD="${MOBIPWN_CLICKHOUSE_PASSWORD:-mobipwn}"
export MOBIPWN_CLICKHOUSE_DB="${MOBIPWN_CLICKHOUSE_DB:-mobipwn}"

ARGS=(bugreport -i "$INPUT" -s "$SOURCE")
if [[ "$USE_API" == "--api" ]]; then
  ARGS+=(--api "${MOBIPWN_API_URL:-http://127.0.0.1:3000}")
fi

echo "==> mobipwn-ingest ${ARGS[*]}"
cargo run --release -p mobipwn-ingest -- "${ARGS[@]}"

echo "==> sample search (requires mobipwn-api running)"
echo 'curl -s -X POST http://127.0.0.1:3000/v1/search/run -H "Content-Type: application/json" \'
echo '  -d "{\"query\":\"platform=\\\"android\\\" source=\\\"'"$SOURCE"'\\\" | head 5\"}" | jq .row_count'

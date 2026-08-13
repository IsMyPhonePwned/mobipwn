#!/usr/bin/env bash
# Parse an iOS sysdiagnose .tar.gz and send events to mobipwn SIEM.
#
# Prereqs:
#   - docker compose up -d postgres clickhouse
#   - sibling repo: ../sysdiagnose-extractor-library
#
# Usage:
#   ./examples/ingest-sysdiagnose.sh /path/to/sysdiagnose_2024.tar.gz case-2024-001
#   ./examples/ingest-sysdiagnose.sh /path/to/archive.tar.gz lab-iphone --api

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INPUT="${1:?usage: ingest-sysdiagnose.sh <sysdiagnose.tar.gz> <source-label> [--api]}"
SOURCE="${2:?usage: ingest-sysdiagnose.sh <file> <source-label>}"
USE_API="${3:-}"

export MOBIPWN_CLICKHOUSE_URL="${MOBIPWN_CLICKHOUSE_URL:-http://127.0.0.1:8123}"
export MOBIPWN_CLICKHOUSE_DB="${MOBIPWN_CLICKHOUSE_DB:-mobipwn}"

ARGS=(sysdiagnose -i "$INPUT" -s "$SOURCE")
if [[ "$USE_API" == "--api" ]]; then
  ARGS+=(--api "${MOBIPWN_API_URL:-http://127.0.0.1:3000}")
fi

echo "==> mobipwn-ingest ${ARGS[*]}"
cargo run --release -p mobipwn-ingest -- "${ARGS[@]}"

echo "==> sample search"
echo 'curl -s -X POST http://127.0.0.1:3000/v1/search/run -H "Content-Type: application/json" \'
echo '  -d "{\"query\":\"platform=\\\"ios\\\" source=\\\"'"$SOURCE"'\\\" | head 5\"}" | jq .row_count'

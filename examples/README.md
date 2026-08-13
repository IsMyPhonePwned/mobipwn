# mobipwn ingest examples

These examples parse forensic archives with the IsMyPhonePwn extractor libraries and load normalized **MUDM** events into ClickHouse (or via the HTTP API).

## Prerequisites

```bash
cd /path/to/mobipwn
./dev.sh          # Postgres + ClickHouse + API + web UI
# ./dev.sh stop   # when finished

# Sibling repos (required for native CLI parse):
#   ../bugreport-extractor-library
#   ../sysdiagnose-extractor-library
```

## 1. CLI (recommended) — `mobipwn-ingest`

Build once:

```bash
cargo build --release -p mobipwn-ingest
```

### Android bugreport

```bash
# .txt or .zip (dumpstate inside zip)
./examples/ingest-bugreport.sh /path/to/bugreport.zip my-case-001

# Same, but POST through mobipwn-api (start API first: cargo run -p mobipwn-api)
./examples/ingest-bugreport.sh /path/to/bugreport.txt my-case-001 --api
```

Direct `cargo` invocation:

```bash
cargo run --release -p mobipwn-ingest -- \
  bugreport \
  -i /path/to/bugreport.zip \
  -s my-case-001
```

### iOS sysdiagnose

By default, log archives are indexed as **inventory only** (file list + metadata). To decode unified logs into searchable events, enable the `logarchive-decode` feature — **[docs/LOGARCHIVE_DECODE.md](../docs/LOGARCHIVE_DECODE.md)** (`./dev.sh --logarchive-decode` for host dev).

```bash
./examples/ingest-sysdiagnose.sh /path/to/sysdiagnose_2024-06-01.tar.gz my-case-001

# Via API
./examples/ingest-sysdiagnose.sh /path/to/sysdiagnose.tar.gz my-case-001 --api
```

```bash
cargo run --release -p mobipwn-ingest -- \
  sysdiagnose \
  -i /path/to/sysdiagnose.tar.gz \
  -s my-case-001

# With decode:
cargo run --release -p mobipwn-ingest --features logarchive-decode -- \
  sysdiagnose -i /path/to/sysdiagnose.tar.gz -s my-case-001
```

### Timeline JSONL (bel-cli / manual export)

If you already produced JSONL with [bugreport-extractor-library](https://github.com/ismyphonepwned/bugreport-extractor-library):

```bash
# bel-cli (from bugreport-extractor-library repo)
cargo run --release --bin bel-cli -- \
  -f /path/to/bugreport.txt \
  --timeline-jsonl /tmp/timeline.jsonl

cargo run --release -p mobipwn-ingest -- \
  jsonl -i /tmp/timeline.jsonl -s my-case-001 --platform android
```

## 2. HTTP API (no local extractors on client)

Start the API:

```bash
cargo run -p mobipwn-api
```

### Upload raw bugreport bytes

```bash
curl -s -X POST "http://127.0.0.1:3000/v1/ingest/bugreport?source=my-case-001" \
  --data-binary @/path/to/bugreport.zip
```

### Upload raw sysdiagnose archive

```bash
curl -s -X POST "http://127.0.0.1:3000/v1/ingest/sysdiagnose?source=my-case-001" \
  --data-binary @/path/to/sysdiagnose.tar.gz
```

### Upload timeline JSONL

```bash
curl -s -X POST http://127.0.0.1:3000/v1/ingest/jsonl \
  -H 'Content-Type: application/json' \
  -d "$(jq -n \
    --arg platform android \
    --arg source my-case-001 \
    --rawfile jsonl /tmp/timeline.jsonl \
    '{platform:$platform, source:$source, jsonl:$jsonl}')"
```

## 3. Verify in SIEM

```bash
# Hunt ingested events for this case
curl -s -X POST http://127.0.0.1:3000/v1/search/run \
  -H 'Content-Type: application/json' \
  -d '{"query":"platform=\"android\" | head 10","limit":10}' | jq '.row_count, .rows[0]'

curl -s -X POST http://127.0.0.1:3000/v1/search/run \
  -H 'Content-Type: application/json' \
  -d '{"query":"platform=\"ios\" | stats count by parser | head 10"}' | jq .
```

Or open http://localhost:5173 → **Search** (with `mobipwn-web` dev server and API running).

Use the **Examples** chips under the search bar for common hunts (replace `case-001` with your source). Full copy-paste catalog: [docs/ANDROID_SEARCH.md](../docs/ANDROID_SEARCH.md).

- **All package names** — `stats count by bundle_id` on Package parser rows
- **All processes** — `stats count by process_name` on Process parser rows
- **Crash / tombstones / ANR** — `parser="Crash"` (tombstones, `anr_file`, `anr_trace`, backtrace frames)
- **Network sockets (IPs + ports)** — socket events; ports in `local_port` / `remote_port` (ext)
- **Top src → dest IP pairs** / **IPs with ports (stats)**

## 4. Delete ingested data

Remove all events for a `source` label (ClickHouse), **investigation case(s)** with matching `ingest_source` / title / description (Postgres), and ingest-job rows.

**Web UI:** http://127.0.0.1:5173/data → select a source → **Delete ingest** (or trash icon on the row).

**API:**

```bash
curl -s -X POST http://127.0.0.1:3000/v1/data/sources/delete \
  -H 'Content-Type: application/json' \
  -d '{"source":"my-case-001"}' | jq .
```

**CLI** (API or direct ClickHouse + Postgres):

```bash
cargo run -p mobipwn-ingest -- delete -s my-case-001
cargo run -p mobipwn-ingest -- delete -s my-case-001 --api http://127.0.0.1:3000
```

## Environment

| Variable | Default | Used by |
|----------|---------|---------|
| `MOBIPWN_CLICKHOUSE_URL` | `http://127.0.0.1:8123` | Direct CLI ingest |
| `MOBIPWN_CLICKHOUSE_USER` | `default` | ClickHouse HTTP user |
| `MOBIPWN_CLICKHOUSE_PASSWORD` | `mobipwn` | Set by `CLICKHOUSE_PASSWORD` in `docker-compose.yml` |
| `MOBIPWN_CLICKHOUSE_DB` | `mobipwn` | Direct CLI ingest |
| `MOBIPWN_API_URL` | — | `mobipwn-ingest --api …` |

The `source` label is stored on every event (`source` column) so you can filter per case: `source="my-case-001"`.

Per-parser field export (Package → `bundle_id`, Network → `src_ip`, …) is documented in [docs/BUGREPORT_PARSER_FIELDS.md](../docs/BUGREPORT_PARSER_FIELDS.md). Implementation: `mobipwn-core/src/mudm/bugreport_parser_fields.rs`.

## Detection rules (bugreport crashes)

Example scheduled rules (live) under `mobipwn-queries/rules/`:

| File | What it matches |
|------|-----------------|
| `bugreport_native_crash.yaml` | `parser="Crash"` tombstones (`android:bugreport:tombstone`) |
| `bugreport_anr.yaml` | ANR files and traces from the Crash parser |

Deploy after ingest:

```bash
cargo run -p mobipwn-dac -- deploy examples/mobipwn-queries
```

Then open **Rules** → validate → **Run now** (or set `lifecycle: live`). Replace `case-001` in each rule query with your `source` label.

**Package / installer rule:** `rules/mobile/sideload_package_install.yaml` — *Package installed outside default installer* (seeded on API start; shows on the Rules page as **live**).

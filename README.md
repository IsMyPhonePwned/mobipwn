<p align="center">
  <img src="mobipwn-web/public/logo.png" alt="MobiPwn — mobile SIEM and threat analytics" width="480" />
</p>

# MobiPwn

Mobile SIEM in Rust — hunt and detect on **Android bugreports** and **iOS sysdiagnose** archives.

Independent MIT implementation for [IsMyPhonePwned](https://github.com/ismyphonepwned). The **event index and metadata stores** follow the [nano](https://github.com/nano-rs/nano) dual-store model: **ClickHouse** for hot events, **PostgreSQL** for rules/alerts/cases metadata.

## Contents

- [Architecture](#architecture)
- [Workspace crates](#workspace-crates)
- [Prerequisites & quick start](#prerequisites--quick-start)
- [Configuration](#configuration)
- [Data stores](#data-stores)
- [MUDM (Mobile UDM)](#mudm-mobile-udm)
- [Search (mPL)](#search-mpl)
- [REST API](#rest-api)
- [Detection & alerts](#detection--alerts)
- [Cases & ingest](#cases--ingest)
- [Ingestion](#ingestion)
- [Amnesty investigation rules](#amnesty-investigation-rules)
- [Marketplace & jobs](#marketplace--jobs)
- [Web UI](#web-ui)
- [Troubleshooting](#troubleshooting)
- [Production & develop](#production--develop)

## Architecture

**In the UI:** sidebar → **How it works** (`/guide/architecture`) — readable technical tour with diagrams. Canonical doc: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Agents & LLM:** sidebar → **Help** → **Agents & LLM** (`/guide/agents`) — in-app Assistant, **`mobipwn-mcp`** for external LLMs (Cursor/Claude), and `mobipwn-dac` GitOps. Setup: [docs/MCP.md](docs/MCP.md). Canonical: [docs/AGENTS.md](docs/AGENTS.md), [docs/AGENTS_CRAFTING_SEARCHES.md](docs/AGENTS_CRAFTING_SEARCHES.md).

### System overview

MobiPwn splits **hot analytics** (ClickHouse events) from **investigation metadata** (PostgreSQL rules, alerts, cases). Rust services ingest and query; React is the analyst UI.

```mermaid
flowchart TB
  subgraph sources["Data sources"]
    BR["Android bugreport<br/>.zip / .txt"]
    SD["iOS sysdiagnose<br/>.tar.gz"]
    JL["Timeline JSONL"]
    VEC["Vector / VRL<br/>endpoint zip"]
    COL["Collector<br/>WebUSB + blobs"]
  end

  subgraph ingest["Ingest path"]
    CLI["mobipwn-ingest CLI"]
    API["mobipwn-api<br/>/v1/ingest/*"]
    EXT["Extractor libraries<br/>bugreport + sysdiagnose"]
    MUDM["MUDM normalize<br/>mobipwn-core"]
  end

  subgraph stores["Stores"]
    CH[("ClickHouse<br/>events · signals · enrichments")]
    PG[("PostgreSQL<br/>rules · alerts · cases · jobs")]
  end

  subgraph compute["Compute"]
    SEARCH["mobipwn-search<br/>mPL → SQL · detections"]
    JOBS["mobipwn-jobs<br/>cron · enrichment · rollup"]
  end

  subgraph ui["Interfaces"]
    WEB["mobipwn-web<br/>Search · Alerts · Cases"]
    MCP["mobipwn-mcp<br/>external LLM agents"]
    DAC["mobipwn-dac<br/>GitOps rules/queries"]
  end

  BR --> CLI & API
  SD --> CLI & API
  JL --> CLI & API
  VEC --> API
  COL --> API

  CLI --> EXT
  API --> EXT
  EXT --> MUDM
  MUDM --> CH

  API --> PG
  CH --> SEARCH
  PG --> SEARCH
  SEARCH --> JOBS
  JOBS --> PG
  JOBS --> CH

  API --> WEB
  SEARCH --> API
  MCP --> API
  DAC --> API
```

### Deploy modes

| Mode | Command | What runs where |
|------|---------|-----------------|
| **Container stack** | `./compose.sh up` | Postgres, ClickHouse, API, jobs, nginx web — all in Docker/Podman |
| **Host dev** | `./dev.sh` | Postgres + ClickHouse in Docker; API, jobs, Vite web on the host (hot reload) |

Both use the same `.env`, schema (`migrations/001_schema.sql`, `clickhouse/init.sql`), and data flow below.

### Life of ingested data

From upload to alert — what happens at each step. **Ingest does not run detection rules**; rules fire on schedule or **Run now**.

```mermaid
sequenceDiagram
  participant Analyst
  participant API as mobipwn-api
  participant PG as PostgreSQL
  participant Parse as Extractors + MUDM
  participant CH as ClickHouse
  participant Jobs as mobipwn-jobs
  participant UI as mobipwn-web

  Analyst->>API: Upload archive (source=case-001)
  API->>PG: ingest_jobs row (SHA-256 dedup)
  alt duplicate + events still in CH
    API-->>Analyst: deduplicated (case synced)
  else new or CH empty after wipe
    API->>Parse: parsing → parsed
    Parse->>CH: batched INSERT mobipwn.events
    API->>CH: verifying (count by source)
    API->>PG: case + tags (syncing)
    API->>PG: ingest_jobs status=done
  end

  Note over CH,Jobs: Rules do NOT run on ingest

  Jobs->>CH: mPL search (scheduled rule)
  Jobs->>PG: alerts upsert + detection_runs
  Jobs->>CH: enrichment sync → dictionaries
  Jobs->>CH: prevalence rollup · realtime signals

  Analyst->>UI: Search mPL / triage alerts
  UI->>API: /v1/search · /v1/alerts
  API->>CH: compiled SQL + lookup enrichments
```

| Stage | Where | What happens |
|-------|--------|----------------|
| **1. Intake** | API / CLI | Bugreport, sysdiagnose, JSONL, endpoint zip, or collector blob. `source=` labels the investigation (case id). |
| **2. Dedup** | Postgres `ingest_jobs` | SHA-256 of file per `source`. Skip re-parse if job `done` and ClickHouse still has events for that source. Re-ingest if CH was wiped (`./dev.sh --clean`). |
| **3. Parse** | `mobipwn-ingest` + extractor libs | Android: dumpstate parsers + optional Rusty Magpie. iOS: sysdiagnose archive extraction. iOS logarchive decode is opt-in — [LOGARCHIVE_DECODE.md](docs/LOGARCHIVE_DECODE.md). Progress: `parsing` → `parsed`. |
| **4. Normalize** | `mobipwn-core` MUDM | Timeline rows → stable columns (`bundle_id`, `process_name`, IPs, …) + parser-specific `ext` JSON. |
| **5. Index** | ClickHouse | Batched insert into `mobipwn.events` (daily partitions). Stages: `inserting` → `verifying`. |
| **6. Case link** | Postgres `cases` | Auto-create/update case for `source`, optional `user=` and ingest tags. Stage: `syncing`. |
| **7. Hunt** | `mobipwn-search` | Analyst runs mPL in UI; admission applies time bounds and row limits; `lookup` adds VT/geo/Play Store at query time. |
| **8. Detect** | `mobipwn-jobs` + API | Per-rule cron → `execute_detection_rule` → hits become Postgres `alerts` (deduped by rule + facets). Staging rules: **Run now** only. |
| **9. Enrich** | Jobs + Marketplace | Provider cron syncs IoCs into ClickHouse tables/dictionaries (not mutating raw events). |
| **10. Realtime** | ClickHouse MVs | Filter-only rules can write `detection_signals` on insert; jobs promote to alerts every ~2 min. |

Collector **store-only** blobs (`POST /v1/collect/blobs`, `analyzed=false`) skip parse until **re-ingest** from the blob library.

### Runtime processes

| Process | Default bind | Role |
|---------|--------------|------|
| **mobipwn-api** | `:3000` (`:5174` in `./dev.sh`) | REST, Swagger, ingest, search, rules, alerts, collect |
| **mobipwn-jobs** | — | Per-rule detection cron, per-provider enrichment cron, prevalence rollup, realtime signals |
| **mobipwn-web** | `:5173` dev / `:8080` compose | React SPA (`/api` → API) |
| **mobipwn-search** | `:3002` | Optional standalone search (API embeds same libs) |
| **Postgres** | `:5432` | Metadata; `migrations/001_schema.sql` on API/jobs startup |
| **ClickHouse** | `:8123` | Events + signals; `clickhouse/init.sql` + `scripts/ch-migrate.sh` |

Shared detection execution: **`mobipwn-search::execute_detection_rule`** (API **Run now** and **mobipwn-jobs**).

## Workspace crates

| Crate | Type | Role |
|-------|------|------|
| **mobipwn-core** | Library | MUDM schema & normalization, `DualPool`, alerts/cases/dashboards stores, Sigma→mPL, enrichment sync, prevalence, ClickHouse helpers, platform settings |
| **mobipwn-search** | Library + bin | mPL parser, ClickHouse SQL generator, query admission, `run_search`, **`execute_detection_rule`** (hits → alert upsert) |
| **mobipwn-ingest** | Library + bin | Bugreport/sysdiagnose via extractor libs, JSONL import, batched CH insert, Amnesty `import-rules`, CLI `mobipwn-ingest` |
| **mobipwn-api** | Binary | Axum REST + OpenAPI (`/swagger-ui`), auth, ingest jobs, collect blobs, LLM/MCP hooks |
| **mobipwn-jobs** | Binary | Background scheduler: detection cron, enrichment cron, prevalence, realtime MV sync |
| **mobipwn-dac** | Binary | GitOps CLI — deploy detection rules and saved queries from `examples/mobipwn-queries` to the API |
| **mobipwn-mcp** | Binary | MCP server for Cursor/Claude — search, triage, rules over stdio ([docs/MCP.md](docs/MCP.md)) |
| **mobipwn-web** | Frontend | React + Vite SPA: Search, Data, Detections, Alerts, Cases/Inbox, Collector, Marketplace, Settings |
| **mobipwn-webadb** | WASM (excluded) | WebUSB ADB source; **prebuilt wasm is vendored** in `mobipwn-web/src/vendor/webadb/` |
| **mobi-android-collector** | WASM (excluded) | Rusty Magpie Android artifact collector (bundled into web where enabled) |

**External extractor / anonymizer libs** (sibling clones for host dev; cloned in Docker image build for `./compose.sh`):

- [bugreport-extractor-library](https://github.com/ismyphonepwned/bugreport-extractor-library) — Android dumpstate parsers → timeline JSONL  
- [sysdiagnose-extractor-library](https://github.com/ismyphonepwned/sysdiagnose-extractor-library) — iOS sysdiagnose → timeline JSONL  
- [fakeMustache](https://github.com/ismyphonepwned/fakeMustache) — optional anonymize step during ingest (pseudonymize identifiers before indexing)

## Prerequisites & quick start

- **Rust** stable (**≥ 1.91** for Docker image builds; matches extractor-lib deps), **Node 20+**, **Docker** or **Podman** with Compose (Postgres 18 + ClickHouse 24+)
- Sibling clones (for native CLI ingest):
  - `../bugreport-extractor-library`
  - `../sysdiagnose-extractor-library`
  - `../fakeMustache` (linked into `mobipwn-ingest` for anonymize-on-ingest)

### Option A — Docker/Podman full stack (simplest install)

Runs Postgres, ClickHouse, API, jobs, and the production web UI (nginx) in containers. No local Rust/Node toolchain required. Image builds clone [bugreport-extractor-library](https://github.com/ismyphonepwned/bugreport-extractor-library) and [sysdiagnose-extractor-library](https://github.com/ismyphonepwned/sysdiagnose-extractor-library) automatically; set `HTTP_PROXY` / `HTTPS_PROXY` in `.env` for corporate proxies.

```bash
chmod +x compose.sh
./compose.sh up
```

On first run, **`.env`** is created from `.env.example`. **Web UI:** http://127.0.0.1:8080 · **API:** http://127.0.0.1:3000/health · default login `admin` / `admin` (change `MOBIPWN_ADMIN_PASSWORD` before exposing).

| Command | Effect |
|---------|--------|
| `./compose.sh up` | Build (if needed), migrate CH, start full stack |
| `./compose.sh up --clean` | Wipe DB volumes, then fresh start (keeps images) |
| `./compose.sh clean` | Remove stack: containers, volumes, networks, mobipwn images |
| `./compose.sh clean --all` | Same + remove postgres/clickhouse base images |
| `./compose.sh up --no-build` | Restart without rebuilding images |
| `./compose.sh down` | Stop containers (keep data) |
| `./compose.sh down -v` | Stop and remove volumes |
| `./compose.sh logs` | Tail service logs |
| `./compose.sh status` | Container status + API health |

**Share images externally** (USB / scp / registry):

```bash
./scripts/build-share-image.sh --platform linux/amd64 --tag 1.0.0
# → dist/share/mobipwn-images-1.0.0.tar.gz
# On target: ./scripts/load-docker-images.sh ./dist/share && ./compose.sh up --no-build
```

See [docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md).

Optional profiles: `./compose.sh up --profile search` (standalone search on :3002), `./compose.sh up --profile ingest` (Vector agent).

**Share images to another machine** (build once, run without compiling on the target): see **[docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md)**.

```bash
# Offline: build machine → tarball → target
./scripts/build-docker-images.sh --platform linux/amd64 --export ./dist/mobipwn-images
./scripts/load-docker-images.sh ./dist/mobipwn-images   # on target
./compose.sh up --no-build

# Public registry: publish then anyone can pull (see docs/DOCKER_DEPLOY.md)
./scripts/build-docker-images.sh --registry ghcr.io/YOU/mobipwn --tag 1.0.0 --push
./scripts/pull-docker-images.sh --registry ghcr.io/YOU/mobipwn --tag 1.0.0
```

Change default passwords and use HTTPS before exposing on the public internet — [docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md#public-internet-deployment-expose-the-stack).

Uses `docker compose` when available, otherwise `podman compose`. Same as `./scripts/install.sh`.

### Option B — Host dev (Rust + Vite, DBs in Docker)

Best for backend/frontend development with hot reload.

```bash
chmod +x dev.sh
./dev.sh
```

On first run, `./dev.sh` creates **`.env`** from `.env.example` (Postgres/ClickHouse URLs, dev auth `admin`/`admin`, blob storage under `.dev/`). Edit `.env` for your environment; it is gitignored. (`./compose.sh` uses the same file.)

**Corporate proxy:** set `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` in `.env` — see [docs/PROXY.md](docs/PROXY.md). For Cargo SSL errors behind TLS interception, use `./dev.sh --insecure-cargo-ssl` or `MOBIPWN_CARGO_INSECURE_SSL=1`.

Starts Postgres + ClickHouse (Docker), ClickHouse init + `scripts/ch-migrate.sh`, Postgres migrations, builds and runs **API** (web port + 1, default `:5174`), **jobs**, **web** (`:5173`).

| Command | Effect |
|---------|--------|
| `./dev.sh` | Start host dev stack (DBs in Docker) |
| `./dev.sh --port 5180` | Web on 5180, API on 5181 (or set `MOBIPWN_WEB_PORT` in `.env`) |
| `./dev.sh stop` | Stop app processes + Docker (keeps volumes) |
| `./dev.sh status` | PIDs, health, ClickHouse event count |
| `./dev.sh --clean` | Wipe `pgdata` / `chdata` volumes, then start fresh |
| `./dev.sh clean` | Wipe volumes only |
| `./dev.sh --logarchive-decode` | Build API with unified log decode (off by default; persisted in `.dev/ports.env`) |
| `./dev.sh --rebuild-wasm` | Rebuild webadb + idevice-wasm on this up (**off by default**) |
| `./dev.sh --wasm-release` | Same as `--rebuild-wasm` with **release** profile |
| `./dev.sh --wasm-dev` | Same as `--rebuild-wasm` with fast/dev profile |
| `./dev.sh --insecure-cargo-ssl` | Cargo/git SSL workarounds for corporate TLS interception (see [docs/PROXY.md](docs/PROXY.md)) |

Manual cargo with SSL workarounds: `./scripts/cargo.sh build -p mobipwn-api`

Verify default builds do not pull `macos-unifiedlogs`: `./scripts/verify-logarchive-deps.sh` (no compile).

iOS unified-log decode is opt-in — see **[docs/LOGARCHIVE_DECODE.md](docs/LOGARCHIVE_DECODE.md)**.

Logs: `.dev/api.log`, `.dev/jobs.log`, `.dev/web.log` — tail via UI dev console or `GET /v1/dev/logs` when `MOBIPWN_EXPOSE_DEV_LOGS=1`.

**Open:** http://127.0.0.1:5173 · **API health:** http://127.0.0.1:5174/health · **Swagger:** http://127.0.0.1:5174/swagger-ui

After changing Rust code, restart the API (Vite does not reload the backend):

```bash
./dev.sh stop && ./dev.sh
# With logarchive decode (if enabled via ./dev.sh --logarchive-decode):
# ./dev.sh stop && ./dev.sh --logarchive-decode
# or: cargo build -p mobipwn-api --features logarchive-decode && kill "$(cat .dev/api.pid)"; cargo run -p mobipwn-api --features logarchive-decode > .dev/api.log 2>&1 &
```

## Configuration

Environment variables (see `.env.example`; auto-copied to `.env` on first `./dev.sh`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `MOBIPWN_POSTGRES_URL` | `postgres://mobipwn:mobipwn@127.0.0.1:5432/mobipwn` | Postgres DSN |
| `MOBIPWN_CLICKHOUSE_URL` | `http://127.0.0.1:8123` | ClickHouse HTTP |
| `MOBIPWN_CLICKHOUSE_USER` / `PASSWORD` / `DB` | `default` / `mobipwn` / `mobipwn` | CH auth + database |
| `MOBIPWN_COLLECT_BLOB_DIR` | `.dev/collect-blobs` | Stored collect / device-pull archives |
| `MOBIPWN_API_BIND` | `0.0.0.0:3000` | API listen address |
| `MOBIPWN_SEARCH_BIND` | `0.0.0.0:3002` | Standalone search service |
| `MOBIPWN_JOBS_ENABLED` | `1` | Set `0` to skip `mobipwn-jobs` |
| `MOBIPWN_SEARCH_MAX_LIMIT` | `10000` | Max rows per search |
| `MOBIPWN_SEARCH_DEFAULT_HOURS` | `24` | Default wall-clock window when admission applies |
| `MOBIPWN_SEARCH_REQUIRE_TIME_RANGE` | `1` | Broad queries must have time bounds or IoC/source filters |
| `MOBIPWN_SEARCH_MAX_QUERY_LEN` | `8192` | Query string cap |
| `MOBIPWN_SEARCH_MAX_JOINS` | `2` | Max `\| join` commands |
| `MOBIPWN_REQUIRE_AUTH` | `1` | Set `0` to disable auth in dev; create **Settings → API keys** for MCP/scripts |
| `MOBIPWN_WEB_PORT` | `5173` | Dev web port |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | — | Optional outbound proxy ([docs/PROXY.md](docs/PROXY.md)) |
| `MOBIPWN_RUSTY_MAGPIE_MODE` | `auto` | `/collect` device binary: `auto`, `fetch`, `build`, or `skip` (Docker web defaults to `fetch`) |
| `RUSTY_MAGPIE_PREBUILT_URL` | — | Direct URL for prebuilt `rusty_magpie` ([mobi-android-collector/README.mobipwn.md](mobi-android-collector/README.mobipwn.md)) |
| `MOBIPWN_LLM_*` | — | Optional **bootstrap only** — copied into `siem_settings.llm_config` on first start; configure in **Settings → LLM assistant** |
| `RUST_LOG` | `info,mobipwn=debug` | Tracing filter |

## Data stores

Index layout is based on nano’s dual-store SIEM pattern: ClickHouse for the searchable event index, PostgreSQL for operational metadata.

### ClickHouse (`clickhouse/init.sql`)

| Table / object | Purpose |
|----------------|---------|
| `mobipwn.events` | Primary event store (MergeTree, partition `toYYYYMMDD(timestamp)`). Token/bloom indexes on `message`, `bundle_id`, `parser`. No row TTL on events (dev). |
| `mobipwn.detection_signals` | Signal log for rule matches / builtin high-severity MV |
| `mobipwn.mv_high_severity_events` | MV: `severity IN ('high','critical')` → signals |
| `mobipwn.field_prevalence_agg` | Prevalence sidebar / noise reduction |
| `mobipwn.ip_enrichments`, `ioc_enrichments`, `package_enrichments`, … | Marketplace enrichment storage |

Schema: `clickhouse/init.sql`. Dictionaries: `./scripts/ch-migrate.sh` (run automatically by `./dev.sh`).

### PostgreSQL (`migrations/`)

Single fresh-install migration applied on API/jobs startup via `mobipwn_core::run_migrations`:

| File | Contents |
|------|----------|
| `001_schema.sql` | Full Postgres schema: rules, alerts, cases, ingest (incl. source tombstones), SIEM forward audit log, auth, collect blobs, platform settings seeds, bundled detection rules (live) |

Wipe Postgres volumes when consolidating or resetting (`./scripts/dev.sh` clean / compose `--clean`) so sqlx history matches this single migration.

## MUDM (Mobile UDM)

Events are normalized to **MUDM** before insert. Core columns in ClickHouse `events` match `mobipwn-core/src/mudm/fields.rs` (sidebar + SQL).

| Column | Examples / notes |
|--------|------------------|
| `id`, `timestamp`, `message`, `ingest_time` | UUIDv7, event time vs ingest time |
| `source`, `source_type`, `platform` | Case label (`case-001`), `android` / `ios` |
| `device_id`, `device_model`, `os_version` | Device context |
| `bundle_id`, `app_name`, `parser`, `data_type` | App / parser lineage |
| `process_name`, `process_id`, `user` | Process / UID |
| `src_ip`, `dest_ip`, `ssid` | Network |
| `permission`, `file_hash`, `severity`, `action` | Mobile-specific |
| `ext` | JSON string: Sigma/timeline extras (`event_type`, `destination_domain`, `function`, `file_path`, `email`, …) |

Investigation IoCs in `ext` are searchable in mPL (mapped in `sigma_fields` / `sql_gen` to `JSONExtractString(ext, …)`).

## Search (mPL)

Pipe-oriented query language. Parser: `mobipwn-search/src/mpl.rs`. SQL: `mobipwn-search/src/sql_gen.rs`.

**Language reference:** [docs/MPL_LANGUAGE.md](docs/MPL_LANGUAGE.md) — syntax, commands, time bounds, wildcards. In the UI: Search → **mPL language reference** (`/search/mpl`).

### Time bounds (admission)

`resolve_time_bounds` (`admission.rs`) picks the window:

1. API `time_from` / `time_to` if set  
2. Query prefix `last 15m` / `24h` / `7d` / `90d` / …  
3. **No wall-clock cap** if the query filters `source=` (ingest case hunts) or investigation IoC fields (`process_name`, `bundle_id`, `destination_domain`, `dest_ip`, `email`, …) without `last`  
4. Else default `MOBIPWN_SEARCH_DEFAULT_HOURS` (24h)

Broad platform-only queries require an explicit time range when `MOBIPWN_SEARCH_REQUIRE_TIME_RANGE=1`.

### Field matching

| Syntax | SQL |
|--------|-----|
| `field="exact"` | `field = 'exact'` |
| `field="com.foo.*"` | `LIKE 'com.foo.%'` (`*` → `%`, `?` → `_`) |
| `field=*substring*` | `LIKE '%substring%'` |
| `!field="x"` | Same as `field!="x"` |
| `message=*error*` | Token/bloom-friendly message search |

Prefer `bundle_id` for Android packages; `process_name` for process/cmd lines.

### Commands

```
last 24h platform="android" error | head 20
platform="ios" | stats count by parser | head 10
platform="android" | timechart span=1h count by parser limit=8
platform="android" | eval severity="high" | dedup bundle_id
| rex ip=(\d+\.\d+\.\d+\.\d+) field=message
| join device_id [ platform="ios" | head 100 ]
```

### Row limits

- Search uses `apply_row_limit(sql, limit)`: if the compiled SQL already contains `LIMIT` (e.g. `| head 200`), wraps as `SELECT * FROM (<sql>) LIMIT <n>` to avoid invalid `LIMIT … LIMIT …` syntax.
- Detection runs cap at **100** hits per execution the same way.

### Examples (UI + mPL)

The Search page has one-click **Examples** chips (packages, processes, network IPs/ports, timechart). Replace `case-001` with your ingest `source`.

**Android analyst guide:** [docs/ANDROID_SEARCH.md](docs/ANDROID_SEARCH.md) — packages, installers, cross-case timecharts, crashes, network.

**iOS logarchive decode:** [docs/LOGARCHIVE_DECODE.md](docs/LOGARCHIVE_DECODE.md) — opt-in unified-log parsing (`./dev.sh --logarchive-decode`).

```text
# All package names (distinct)
source="case-001" parser="Package" bundle_id=* | stats count by bundle_id | head 100

# Cross-case package hunt (comma-separated `fields` list)
bundle_id=*bitchat* | fields timestamp, source, bundle_id, parser, action, message | sort -timestamp | head 100

# All processes
source="case-001" parser="Process" process_name=* | stats count by process_name | head 100

# Crashes (tombstones, ANR files, backtrace frames — Crash parser from bugreport-extractor-library)
source="case-001" parser="Crash" data_type="android:bugreport:tombstone" | head 100
source="case-001" parser="Crash" process_name=* | stats count by process_name | head 50

# Socket rows — IPs in columns; ports in ext (local_port, remote_port) or message (ip:port)
source="case-001" parser="Network" data_type="android:bugreport:network_socket" | head 200

# Top src → dest pairs
source="case-001" parser="Network" dest_ip=* | stats count by src_ip, dest_ip | head 50

# IPs grouped with ports (ext fields)
source="case-001" parser="Network" remote_port=* | stats count by src_ip, dest_ip, local_port, remote_port | head 50
```

```bash
# Case-scoped hunt (no default 90d wall-clock exclusion)
source="case-001" process_name="com.google.android.gms" | head 50

# Amnesty-style IoC on ext-backed fields
source="case-001" destination_domain="evil.com" | head 50

curl -s -X POST http://127.0.0.1:3000/v1/search/run \
  -H 'Content-Type: application/json' \
  -d '{"query":"source=\"case-001\" platform=\"android\" | head 5"}'
```

## REST API

Base URL: `http://127.0.0.1:3000`. Web dev server proxies `/api/*` → API (strip `/api` prefix).

When `MOBIPWN_REQUIRE_AUTH=1`, send `X-Api-Key: <key>` or `Authorization: Bearer <key>`.

### Health & overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness; ClickHouse up/degraded |
| GET | `/ready` | Ready only if ClickHouse + Postgres |
| GET | `/v1/health/detail` | Component-level health |
| GET | `/v1/overview` | `events_24h`, `alerts_new`, `rules_total`, … |

### Search

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/search/compile` | mPL → SQL only |
| POST | `/v1/search/run` | Execute search (`query`, `time_from`, `time_to`, `limit`) |
| POST | `/v1/search/export` | CSV export (higher default limit) |
| GET | `/v1/search/fields` | MUDM field catalog |
| POST | `/v1/search/field-stats` | Top values for a field under current filter |
| POST | `/v1/search/histogram` | Time buckets |
| GET/POST/DELETE | `/v1/search/history` | Analyst search history |
| GET | `/v1/events/{id}` | Single event by UUID |

### Ingest & data

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/ingest/jsonl` | Body: `{ "source", "platform", "jsonl" }` |
| POST | `/v1/ingest/bugreport?source=case-001&user=alice` | Raw bugreport bytes (zip/txt). Optional `user` → case owner. Dedup by file hash; re-ingests if CH empty. |
| POST | `/v1/ingest/sysdiagnose?source=case-001&user=alice` | Raw `.tar.gz` sysdiagnose |
| GET | `/v1/ingest/jobs` | Ingest job status per source |
| GET | `/v1/data/summary` | Sources, event counts |
| POST | `/v1/data/sources/delete` | Delete a source’s events |

### Detection rules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/rules` | List rules |
| POST | `/v1/rules` | Create rule (`name`, `query`, `lifecycle`, `cron`, `severity`, …) |
| GET | `/v1/rules/{id}` | Get rule |
| POST | `/v1/rules/{id}` | Update rule (partial body) |
| POST | `/v1/rules/{id}/delete` | Delete |
| POST | `/v1/rules/{id}/validate` | Plan: SQL, cost tier, explain lines, sample rows (up to 10) |
| POST | `/v1/rules/{id}/run` | **Run now**: full detection, up to 100 hits, upsert alerts (any lifecycle) |
| GET | `/v1/rules/{id}/versions` | Version history (diff, author, MITRE snapshot) |
| POST | `/v1/rules/import-sigma` | Convert Sigma YAML → staging rule (`sigma_yaml` stored) |
| POST | `/v1/rules/{id}/mute` | Mute window (`minutes` or `muted_until`; omit to clear) |
| POST | `/v1/rules/{id}/enabled` | Enable/disable rule |
| GET | `/v1/rules/{id}/runs` | Detection run history |

### Alerts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/alerts` | List (`?status=new\|triaged\|verified`) |
| GET | `/v1/alerts/{id}` | Get alert |
| POST | `/v1/alerts/{id}` | `{"status":"triaged"}` — lifecycle: `new → triaged → verified` |
| DELETE | `/v1/alerts/{id}` | Permanently delete alert |
| POST | `/v1/alerts/bulk-delete` | `{"ids":["…"]}` — delete multiple alerts |
| GET | `/v1/alerts/groups` | Alert groups |
| POST | `/v1/alerts/bulk` | Bulk triage |
| GET/POST | `/v1/alerts/{id}/events` | Timeline / comments |

Dedup: `UNIQUE (rule_id, dedup_key)` on facets (`platform`, `bundle_id`, `parser`, `device_id`). Re-runs bump `event_count` and `last_seen`.

Each alert stores a **`context`** JSON snapshot (`source`, `platform`, `parser`, `process_name` / `bundle_id`, event `timestamp`) from the matching row. The **Alerts** UI shows **Where**, links **Hunt** (scoped search), and **Event** (sample event inspector).

### Cases, dashboards, LLM assistant

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/v1/cases` | Case inbox |
| GET/POST | `/v1/cases/{id}` | Case detail (`user`, `status`, `priority`, tags) |
| POST | `/v1/cases/{id}/alerts/{alert_id}` | Link alert to case |
| GET/PUT | `/v1/dashboards/default` | Grid dashboard layout |
| POST | `/v1/llm/chat` | OpenAI-compatible chat (`/chat/completions`) — Ollama, LM Studio, or hosted API |
| GET | `/v1/llm/status` | LLM configured or not (`local` flag for localhost endpoints) |

### Marketplace & settings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/marketplace/providers` | Provider catalog |
| POST | `/v1/marketplace/providers/{id}` | Enable/disable |
| POST | `/v1/marketplace/providers/{id}/config` | Update `config` JSON |
| GET | `/v1/marketplace/coverage` | MUDM field coverage % |
| POST | `/v1/marketplace/sync` | Trigger enrichment sync (incremental by default) |
| POST | `/v1/marketplace/sync/stream` | Stream sync progress (NDJSON); optional body `{"full_resync": true}` |
| POST | `/v1/marketplace/clean` | Clear all enrichment data (optional body `{"slug": "virustotal"}`) |
| POST | `/v1/marketplace/providers/{id}/clean` | Clear one provider's enrichment data |
| GET/POST | `/v1/settings/{key}` | Tenant settings |
| GET/POST | `/v1/notifications/channels` | Webhooks |
| GET/POST | `/v1/suppressions` | Maintenance windows (active + upcoming) |
| DELETE | `/v1/suppressions/{id}` | Remove a maintenance window |
| GET/POST | `/v1/saved-queries` | Saved hunts |

## Detection & alerts

### Rule lifecycle

| Lifecycle | Scheduled (`mobipwn-jobs`) | Alerts |
|-----------|---------------------------|--------|
| **staging** | Not run | Only via **Run now** (API) |
| **live** | Cron when due | Yes |
| **alerting** | Cron when due | Yes |

Jobs loads `lifecycle IN ('live', 'alerting')` and `mode = 'scheduled'`. Default cron example: `0 */6 * * *` (every 6 hours at :00). First run after create often fires within ~60s (no `last_run_at` → 48h lookback anchor).

**Ingest does not run rules.** Use **Run now** on Detections or wait for jobs.

### Run now vs validate

| Action | Behavior |
|--------|----------|
| **Validate** | `POST /v1/rules/{id}/validate` — compiled SQL, cost tier (`low`/`medium`/`high`), explain lines, up to 10 sample rows; no alerts |
| **Run now** | `POST /v1/rules/{id}/run` — `execute_detection_rule(..., manual: true)`, writes `detection_runs`, upserts up to `max_alerts_per_run` (default 50), optional signal log + webhooks |

**Realtime rules** (`mode=realtime`, lifecycle `live`/`alerting`, `enabled=true`): API/jobs sync a ClickHouse materialized view `mv_rule_<id>` → `detection_signals` on each matching insert. Query must be **filter-only** (no `\|` pipes). **Scheduled** rules use `mobipwn-jobs` cron.

**Disable / mute:** `POST /v1/rules/{id}/enabled` with `{"enabled":false}`; `POST /v1/rules/{id}/mute` with `{"minutes":60}` or `{"muted_until":"2026-06-05T12:00:00Z"}`. Send `{}` to clear mute.

**Maintenance windows:** Settings UI or `POST /v1/suppressions` — optional `rule_id` (omit for all rules), `starts_at` / `ends_at` ISO timestamps. Active windows block alerts and webhooks for scheduled, manual, and realtime detection paths.

UI: **Run now** saves unsaved rules first, then calls `/run`. On success with alerts, offers navigation to **Alerts**.

### Jobs loop (`mobipwn-jobs`)

**Per-rule detection cron** and **per-provider enrichment cron** are registered from Postgres (`tokio-cron-scheduler`); schedulers reconcile every **~2 minutes**.

The main loop ticks every **60s** and also runs:

| Interval | Task |
|----------|------|
| ~2 min | Process realtime `detection_signals` → alert upsert |
| ~10 min | Sync realtime rule materialized views |
| ~15 min | Field prevalence rollup into ClickHouse |

Logs: `.dev/jobs.log` (host dev) or `./compose.sh logs mobipwn-jobs`.

### Alerts UI

`/alerts` polls every 10s and refreshes on tab focus; manual **Refresh** button. Filter by status; triage/resolve/delete (per-row or bulk select). User actions are recorded in the **Logs** activity panel (API + app entries).

## Cases & ingest

- Each ingest `source=` (e.g. `case-001`) syncs a **case** row (`006`, `009`).
- Query param `user=` on bugreport/sysdiagnose sets `cases.case_user` (JSON `user`).
- **Ingest dedup:** SHA-256 of upload; if job `done` but ClickHouse count for source is **0**, API re-ingests (common after `./dev.sh --clean`).

## Ingestion

Full walkthrough: **[examples/README.md](examples/README.md)**.

### CLI — parse bugreport / sysdiagnose → SIEM

```bash
docker compose up -d clickhouse postgres

# Android (bugreport-extractor-library)
cargo run --release -p mobipwn-ingest -- \
  bugreport -i /path/to/bugreport.zip -s case-2024-001

# iOS (sysdiagnose-extractor-library)
cargo run --release -p mobipwn-ingest -- \
  sysdiagnose -i /path/to/sysdiagnose.tar.gz -s case-2024-001

# iOS with unified-log decode (optional; off by default)
cargo run --release -p mobipwn-ingest --features logarchive-decode -- \
  sysdiagnose -i /path/to/sysdiagnose.tar.gz -s case-2024-001
# Or: ./dev.sh --logarchive-decode then ingest via API — see docs/LOGARCHIVE_DECODE.md

chmod +x examples/ingest-*.sh
./examples/ingest-bugreport.sh /path/to/bugreport.zip case-2024-001
./examples/ingest-sysdiagnose.sh /path/to/sysdiagnose.tar.gz case-2024-001

# Via API (mobipwn-api must be running)
cargo run --release -p mobipwn-ingest -- \
  bugreport -i /path/to/bugreport.txt -s case-001 --api http://127.0.0.1:3000
```

### HTTP — upload archives

```bash
curl -s -X POST "http://127.0.0.1:3000/v1/ingest/bugreport?source=case-001&user=alice" \
  --data-binary @/path/to/bugreport.zip

curl -s -X POST "http://127.0.0.1:3000/v1/ingest/sysdiagnose?source=case-001" \
  --data-binary @/path/to/sysdiagnose.tar.gz
```

### Timeline JSONL

```bash
cargo run --release -p mobipwn-ingest -- \
  jsonl -i timeline.jsonl -s case-001 --platform android
```

### Vector + VRL

`vector/vector.toml` and `vector/vrl/mudm_mobile.vrl` — optional path; Vector can POST normalized batches to the API.

## Amnesty investigation rules

All **19** rules from `../website/rules` → mPL:

- `examples/mobipwn-queries/rules/amnesty/*.yaml` — Amnesty IoC rules (SQL seed + dac subfolder)
- `examples/mobipwn-queries/rules/mvt/` — MVT indicator packs (e.g. Spyrtacus / SIO from [mvt-indicators#49](https://github.com/mvt-project/mvt-indicators/pull/49) / [#51](https://github.com/mvt-project/mvt-indicators/pull/51))
- `examples/mobipwn-queries/rules/cve/android/spyrtacus.yaml` — Spyrtacus package-name detection (critical)
- `examples/mobipwn-queries/rules/bugreport_native_crash.yaml` — bugreport tombstone detection (live)
- `examples/mobipwn-queries/rules/bugreport_anr.yaml` — bugreport ANR detection (live)
- Deploy top-level rules: `cargo run -p mobipwn-dac -- deploy examples/mobipwn-queries`
- `migrations/001_schema.sql` — Amnesty rules seeded on fresh install (lifecycle **live**)

Re-convert after editing website rules:

```bash
cargo run -p mobipwn-ingest -- import-rules \
  --input ../website/rules \
  --output examples/mobipwn-queries/rules/amnesty \
  --sql migrations/amnesty_rules.sql
```

Hunt: `source="case-001" destination_domain="evil.com" | head 50`  
**Re-ingest** bugreports after parser/`ext` field changes so IoCs populate.

## Marketplace & jobs

- Postgres `enrichment_providers` + sync into ClickHouse dictionaries (`clickhouse/init.sql` + `scripts/ch-migrate.sh`).
- Enable providers in **Marketplace**, configure API keys/paths, then **Sync enrichments**. Search with **Enrichments** enabled adds lookup columns from the dictionaries.
- **Ingest does not trigger sync automatically.** New events are enriched after the next jobs tick (~5 minutes with `./dev.sh`) or a manual Marketplace sync.
- While sync runs, status appears in **Logs** (`GET /v1/dev/logs` → `enrichment_sync`, and a `[enrichment] RUNNING …` line in the log tail).

### How enrichment sync works

| Sync type | Behavior |
|-----------|----------|
| **Automatic** (`mobipwn-jobs`, per-provider cron) | **Incremental** — only indicators **not yet** in ClickHouse enrichment tables are fetched (e.g. VirusTotal skips rows already in `ioc_enrichments` with a `VT …` label) |
| **Marketplace → Sync enrichments** | **Incremental** — same as the jobs tick; picks up **new** IPs/domains/hashes after ingest without re-querying old ones |
| **Marketplace → Resync all** | **Full resync** — re-queries everything, including already enriched indicators (confirmation dialog; uses API quota) |

VirusTotal scans distinct values from recent events (per field, up to `max_indicators_per_type` in provider config), normalizes them, and on incremental sync skips any `indicator_type:indicator` key already stored. Use **Resync all** when you explicitly want to refresh all VT data (e.g. after clearing enrichments or when reports may have changed).

API body for full resync:

```json
POST /v1/marketplace/sync/stream
{ "full_resync": true }
```

(Omit the body or set `"full_resync": false` for incremental sync — the default.)

- **Prevalence gate:** rules with `prevalence_threshold` (0–1 rarity) skip alerts when `bundle_id`, `process_name`, or `parser` is too common in `field_prevalence_agg` (7-day window).
- **Thresholds:** `min_hits` (default 1) requires at least N CH matches before alerting; `max_alerts_per_run` caps alerts per run (default 50).
- **Webhooks:** `notification_channels` POST on new alert facets (jobs + manual run).

## Web UI

| Route | Page |
|-------|------|
| `/` | Overview stats |
| `/search` | mPL search, histogram, field stats, export |
| `/data` | Sources, delete, ingest status |
| `/detections` | Rules CRUD, Validate, **Run now** |
| `/alerts` | Triage workflow |
| `/inbox` | Cases |
| `/dashboards` | Grid widgets |
| `/marketplace` | Providers, coverage |
| `/settings` | Settings, webhooks |

## Troubleshooting

### 502 Bad Gateway on `:8080` (compose stack)

nginx serves the UI but proxies `/api/` to **mobipwn-api**. A 502 usually means the API container is not running.

Check:

```bash
./compose.sh logs mobipwn-api
```

If you see `migration 2 was previously applied but is missing in the resolved migrations`, the Postgres volume still has **old incremental migration history** while the repo now ships a single `migrations/001_schema.sql`. Wipe volumes and restart:

```bash
./compose.sh up --clean --no-build
```

### 413 Request Entity Too Large on ingest (`:8080`)

The compose **nginx** front-end defaulted to a **1 MB** upload cap. Ingest allows up to **512 MB** (chunked 4 MB uploads). Rebuild the web image after pulling this fix:

```bash
./compose.sh build mobipwn-web
./compose.sh up --no-build
```

### Search empty but data was ingested

- **Event time vs wall clock:** Bugreport timestamps are often months old. Use `source="case-001"` (no default 24h/90d cap) or explicit `last 3650d`.
- Do not rely on `last 90d` unless events fall in the last 90 days of *now*.

### Sources / events disappeared

- **`./dev.sh --clean`** or `docker compose down -v` wipes ClickHouse volume.
- **Stale ingest dedup:** Postgres `ingest_jobs` shows `done` while CH is empty — re-upload; API re-ingests when count is 0.
- **Old TTL schema:** If events vanish after minutes, run `./scripts/ch-migrate.sh` (`002_remove_events_ttl.sql`) and restart.

### Run now → 400 ClickHouse

- Usually **invalid SQL** (historically: double `LIMIT` on `| head N` rules). Fixed via `apply_row_limit` — rebuild and **restart API**.
- Error body should include `ClickHouse: Syntax error…` in UI / API response.

### Validate matches but no alerts

- **Validate** does not create alerts.
- Scheduled rules need **`live` or `alerting`**, `mobipwn-jobs` running, and cron due (or use **Run now**).
- Check **Alerts** with filter **All statuses**; dedup may update one row instead of many new rows.

### Postgres upgrade issues

If Postgres container exits after image bump: `./dev.sh --clean` once to reset `pgdata`.

## Production & develop

```bash
./compose.sh up
# or: ./scripts/install.sh
# Web :8080, API :3000; optional Vector:
# ./compose.sh up --profile ingest
```

```bash
MOBIPWN_REQUIRE_AUTH=1 ./compose.sh up
cargo run -p mobipwn-dac -- deploy examples/mobipwn-queries
```

**External LLM (MCP):** build `mobipwn-mcp` and wire it into Cursor or Claude — see [docs/MCP.md](docs/MCP.md).

```bash
cargo build --release -p mobipwn-mcp
export MOBIPWN_API_URL=http://127.0.0.1:3000
export MOBIPWN_API_KEY=mpwn_…   # token from Settings → API keys (per client)
./target/release/mobipwn-mcp   # stdio — configured in MCP client, not run manually
```

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
```

## Further docs

| Doc | Content |
|-----|---------|
| [docs/DOCKER_DEPLOY.md](docs/DOCKER_DEPLOY.md) | Build, export, share, and publish Docker images (offline, registry, public deploy) |
| [docs/PROXY.md](docs/PROXY.md) | HTTP proxy for npm, cargo, and Docker builds |
| [docs/LOGARCHIVE_DECODE.md](docs/LOGARCHIVE_DECODE.md) | Opt-in iOS unified-log decode |
| [docs/MPL_LANGUAGE.md](docs/MPL_LANGUAGE.md) | mPL query language reference |

## Related projects

- [nano-rs/nano](https://github.com/nano-rs/nano) — dual-store index model (ClickHouse events + Postgres metadata) that MobiPwn’s data layer follows
- [bugreport-extractor-library](https://github.com/ismyphonepwned/bugreport-extractor-library)
- [sysdiagnose-extractor-library](https://github.com/ismyphonepwned/sysdiagnose-extractor-library)
- [fakeMustache](https://github.com/ismyphonepwned/fakeMustache) — anonymize-on-ingest component

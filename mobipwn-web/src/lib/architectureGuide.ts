import type { MplGuideCallout, MplGuideTable } from "./mplLanguageGuide";

export type ArchGuideGroup = {
  id: string;
  title: string;
  description: string;
};

export type ArchGuideLink = {
  href: string;
  label: string;
};

export type ArchGuideSection = {
  id: string;
  group: string;
  title: string;
  lead?: string;
  paragraphs?: string[];
  callouts?: MplGuideCallout[];
  list?: string[];
  links?: ArchGuideLink[];
  table?: MplGuideTable;
  diagram?: string;
  code?: { title?: string; body: string };
};

export const ARCH_GUIDE_GROUPS: ArchGuideGroup[] = [
  {
    id: "overview",
    title: "Big picture",
    description: "What MobiPwn is and how data moves through the stack.",
  },
  {
    id: "lifecycle",
    title: "Data lifecycle",
    description: "From upload to indexed events, detections, and alerts.",
  },
  {
    id: "runtime",
    title: "Runtime",
    description: "Processes, ports, deploy modes, and workspace crates.",
  },
  {
    id: "data",
    title: "Data layer",
    description: "ClickHouse events, Postgres metadata, and MUDM normalization.",
  },
  {
    id: "engines",
    title: "Engines",
    description: "Search, detection, enrichment, and background jobs.",
  },
  {
    id: "interfaces",
    title: "Interfaces",
    description: "REST API, web UI, MCP, and analyst workflows.",
  },
];

export const ARCH_GUIDE_SECTIONS: ArchGuideSection[] = [
  {
    id: "what",
    group: "overview",
    title: "What is MobiPwn?",
    lead: "A mobile SIEM in Rust for hunting and detecting on Android bugreports and iOS sysdiagnose.",
    paragraphs: [
      "Analysts ingest device extractions, search normalized events with mPL, author detection rules, triage alerts, and link findings to cases. Enrichment providers (geo, VirusTotal, Play Store) attach context at search time via `lookup`.",
      "The stack splits **hot analytics** (ClickHouse) from **operational metadata** (PostgreSQL). One API process serves the React UI; a jobs process runs scheduled detections and sync tasks.",
    ],
  },
  {
    id: "index",
    group: "overview",
    title: "Index & database",
    lead: "The event index and metadata stores follow the nano dual-store model.",
    paragraphs: [
      "Hot events live in ClickHouse (searchable index, detection signals, enrichment dictionaries). Rules, alerts, cases, ingest jobs, and auth live in PostgreSQL.",
      "That ClickHouse + Postgres split is the same dual-store layout used by nano; MobiPwn implements it for mobile forensics (Android bugreport + iOS sysdiagnose).",
    ],
    links: [
      { href: "https://github.com/nano-rs/nano", label: "nano-rs/nano (dual-store reference)" },
    ],
  },
  {
    id: "pipeline",
    group: "overview",
    title: "End-to-end pipeline",
    lead: "From archive upload to alert triage — the path every investigation follows.",
    diagram: `  Sources                Ingest                    Stores
 ┌─────────────┐      ┌──────────────┐         ┌─────────────────┐
 │ bugreport   │─────▶│ mobipwn-api  │────────▶│ ClickHouse      │
 │ sysdiagnose │      │ + ingest lib │    ┌───▶│ mobipwn.events  │
 │ JSONL       │      │ + extractors │    │    └────────┬────────┘
 │ Vector zip  │      │ + MUDM       │    │             │
 │ Collector   │      └──────┬───────┘    │    ┌────────▼────────┐
 └─────────────┘             │            └───▶│ PostgreSQL      │
                             │                 │ cases · alerts  │
                             └────────────────▶│ rules · jobs    │
                                               └────────┬────────┘
                                                        │
         ┌──────────────────────────────────────────────┼──────────────┐
         ▼                      ▼                       ▼              ▼
   mPL search            Detection cron          Enrichment sync   Realtime MVs
   (mobipwn-search)       (mobipwn-jobs)          (marketplace)     → signals
         │                      │                       │              │
         └──────────────────────┴───────────────────────┴──────────────┘
                                        │
                                        ▼
                              mobipwn-web · mobipwn-mcp · mobipwn-dac`,
    list: [
      "Ingest does not run rules — detections fire on per-rule cron or Run now.",
      "Search and rules share the same mPL compiler (mobipwn-search).",
      "Alerts dedupe on rule + facets; re-runs bump event_count and last_seen.",
      "Container install: ./compose.sh up · host dev: ./dev.sh (see Runtime).",
    ],
  },
  {
    id: "ingest-lifecycle",
    group: "lifecycle",
    title: "Life of ingested data",
    lead: "What happens from upload to hunt-ready events — and what waits until later.",
    diagram: ` Analyst          API              Postgres           Parse/MUDM        ClickHouse
    │               │                   │                    │                  │
    │── upload ────▶│── ingest_jobs ───▶│ (SHA-256 dedup)    │                  │
    │               │                   │                    │                  │
    │               │── if new ────────▶│                    │── parsing ──────▶│
    │               │                   │                    │── parsed         │
    │               │                   │                    │── inserting ────▶│ events
    │               │── verifying ──────────────────────────────────────────────▶│ count
    │               │── syncing ───────▶│ cases + tags       │                  │
    │◀── done ──────│                   │ job status=done    │                  │
    │               │                   │                    │                  │
    │  (later)      │                   │◀── alerts ─────────│◀── mPL rule ─────│
    │               │                   │    detection_runs  │    (jobs cron)   │`,
    table: {
      headers: ["Stage", "Where", "What"],
      rows: [
        ["Intake", "API / CLI / Collector", "bugreport, sysdiagnose, JSONL, endpoint zip, blobs; source= case label"],
        ["Dedup", "ingest_jobs", "Skip if same hash + CH still has events; re-ingest after DB wipe"],
        ["Parse", "mobipwn-ingest", "Extractor libs → timeline rows; job stage parsing → parsed"],
        ["Normalize", "mobipwn-core MUDM", "Columns + ext JSON; tags stamped on events"],
        ["Index", "ClickHouse", "Batched insert; inserting → verifying"],
        ["Case link", "cases", "Auto case per source; optional user= and tags; syncing"],
        ["Hunt", "mobipwn-search", "Analyst mPL; lookup enrichments at query time"],
        ["Detect", "mobipwn-jobs", "Per-rule cron → alerts (staging = Run now only)"],
        ["Enrich", "Marketplace + jobs", "Provider cron → CH dictionaries (events unchanged)"],
        ["Realtime", "ClickHouse MVs", "Filter-only rules → signals → alerts ~2 min"],
      ],
    },
    callouts: [
      {
        variant: "important",
        title: "Ingest ≠ detection",
        body: "Uploading data does not run rules. Scheduled detections and enrichment sync happen in mobipwn-jobs after events are indexed.",
      },
      {
        variant: "tip",
        body: "Store-only collector blobs (analyzed=false) skip parse until you re-ingest from the blob library.",
      },
    ],
  },
  {
    id: "ingest-stages",
    group: "lifecycle",
    title: "Ingest job stages",
    lead: "HTTP archive uploads expose progress via ingest_jobs.stage (UI ingest panel).",
    table: {
      headers: ["Stage", "Meaning"],
      rows: [
        ["parsing", "Running bugreport or sysdiagnose extractors"],
        ["parsed", "MUDM event count known; parser summary in stage_detail"],
        ["inserting", "Batched ClickHouse insert (progress_json)"],
        ["verifying", "count() by source matches inserted rows"],
        ["syncing", "Linking investigation case and tags"],
        ["done", "Temp archive removed; events searchable"],
      ],
    },
  },
  {
    id: "deploy-modes",
    group: "runtime",
    title: "Deploy modes",
    lead: "Same data model — two ways to run the stack.",
    table: {
      headers: ["Mode", "Command", "What runs where"],
      rows: [
        ["Container stack", "./compose.sh up", "Postgres, ClickHouse, API, jobs, nginx web (Docker/Podman)"],
        ["Host dev", "./dev.sh", "DBs in Docker; API, jobs, Vite on host (hot reload)"],
      ],
    },
    callouts: [
      {
        variant: "tip",
        body: "compose.sh clones extractor libs during image build. dev.sh expects sibling repos ../bugreport-extractor-library and ../sysdiagnose-extractor-library for CLI ingest.",
      },
    ],
  },
  {
    id: "processes",
    group: "runtime",
    title: "Processes & ports",
    lead: "`./dev.sh` starts the full local stack: Docker data stores, API, jobs, and Vite web.",
    table: {
      headers: ["Process", "Default", "Role"],
      rows: [
        ["mobipwn-api", ":3000 / :5174 dev", "REST, Swagger, ingest, search, rules, alerts, collect"],
        ["mobipwn-jobs", "—", "Per-rule detection cron, per-provider enrichment, prevalence, realtime signals"],
        ["mobipwn-web", ":5173 dev / :8080 compose", "React SPA — /api proxied to API"],
        ["mobipwn-search", ":3002", "Optional standalone (API embeds same libs)"],
        ["PostgreSQL", ":5432", "Rules, alerts, cases, jobs, marketplace"],
        ["ClickHouse", ":8123", "Events, signals, enrichment dictionaries"],
      ],
    },
    code: {
      title: "Quick start",
      body: "# Container stack (simplest)\nchmod +x compose.sh\n./compose.sh up\n# Web http://127.0.0.1:8080\n\n# Host dev (Rust + Vite)\nchmod +x dev.sh\n./dev.sh\n# Web http://127.0.0.1:5173 · API :5174",
    },
    callouts: [
      {
        variant: "tip",
        body: "After Rust changes, restart the API: `./dev.sh stop && ./dev.sh`. Vite hot-reloads only the frontend.",
      },
    ],
  },
  {
    id: "crates",
    group: "runtime",
    title: "Workspace crates",
    lead: "Rust workspace members and what each owns.",
    table: {
      headers: ["Crate", "Type", "Responsibility"],
      rows: [
        ["mobipwn-core", "Library", "MUDM, DualPool, alerts, cases, Sigma→mPL, enrichment, prevalence"],
        ["mobipwn-search", "Lib + bin", "mPL parser, SQL gen, admission, run_search, execute_detection_rule"],
        ["mobipwn-ingest", "Lib + bin", "Extractors, JSONL, CH insert, import-rules, mobipwn-ingest CLI"],
        ["mobipwn-api", "Binary", "Axum REST, OpenAPI, auth, ingest jobs, collect blobs, LLM/MCP"],
        ["mobipwn-jobs", "Binary", "Detection cron, enrichment cron, prevalence, realtime MVs, IronSift"],
        ["mobipwn-ironsift", "Library", "Endpoint baselines & temporal anomaly runs"],
        ["mobipwn-dac", "Binary", "GitOps deploy rules/queries from examples/mobipwn-queries"],
        ["mobipwn-mcp", "Binary", "MCP server for Cursor/Claude (stdio)"],
        ["mobipwn-web", "Frontend", "React UI (this app)"],
        ["mobipwn-webadb", "WASM", "WebUSB ADB + optional bugreport parsers"],
        ["mobi-android-collector", "WASM", "Rusty Magpie device artifact collector"],
      ],
    },
    list: [
      "External: bugreport-extractor-library, sysdiagnose-extractor-library (cloned in compose image build).",
    ],
  },
  {
    id: "mudm",
    group: "data",
    title: "MUDM normalization",
    lead: "Mobile UDM — a stable event schema so Android and iOS extractions search the same way.",
    paragraphs: [
      "Extractors (bugreport-extractor-library, sysdiagnose-extractor-library) emit timeline rows. `mobipwn-ingest` maps them to MUDM columns and packs parser-specific keys into `ext` JSON.",
      "Promoted fields (`bundle_id`, `process_name`, `dest_ip`, `destination_domain`, …) are first-class in mPL. Others stay in `ext` and are reachable via JSONExtract in SQL.",
    ],
    table: {
      headers: ["Column", "Typical content"],
      rows: [
        ["source", "Case / ingest label (your investigation id)"],
        ["platform", "android or ios"],
        ["parser", "Package, Process, Network, Crash, …"],
        ["bundle_id", "APK package name"],
        ["process_name", "Process or cmdline"],
        ["src_ip / dest_ip", "Socket endpoints"],
        ["ext", "JSON: installer, ports, domains, backtrace symbols, …"],
      ],
    },
    callouts: [
      {
        variant: "tip",
        body: "Full field catalog: /mudm in the UI or GET /v1/search/fields.",
      },
    ],
  },
  {
    id: "clickhouse",
    group: "data",
    title: "ClickHouse",
    lead: "Hot path for events and analytics — partitioned by day, indexed for hunt fields.",
    table: {
      headers: ["Object", "Purpose"],
      rows: [
        ["mobipwn.events", "Primary event store (MergeTree, daily partitions)"],
        ["mobipwn.detection_signals", "Rule matches and builtin high-severity MV output"],
        ["mobipwn.field_prevalence_agg", "Noise / rarity sidebar in Search"],
        ["ip_enrichment_dict / ioc_enrichment_dict", "lookup geo, VT, IoC columns"],
        ["package_enrichment_dict", "Play Store metadata for bundle_id"],
      ],
    },
    list: [
      "Schema: clickhouse/init.sql (enrichment tables + dictionaries via scripts/ch-migrate.sh)",
      "Apply migrations: ./scripts/ch-migrate.sh (dev.sh runs this)",
    ],
  },
  {
    id: "postgres",
    group: "data",
    title: "PostgreSQL",
    lead: "System of record for anything that changes during an investigation.",
    table: {
      headers: ["Domain", "Examples"],
      rows: [
        ["Detection", "rules, versions, runs, suppressions"],
        ["Alerts", "alerts, groups, timeline events, assignees"],
        ["Cases", "cases, ingest linkage, tags, priority"],
        ["Analyst", "search history, saved queries, dashboards"],
        ["Marketplace", "enrichment providers, sync state"],
        ["Platform", "users, settings, webhooks, ingest jobs"],
      ],
    },
    list: ["Migrations: migrations/ — applied on API/jobs startup via sqlx"],
  },
  {
    id: "search-engine",
    group: "engines",
    title: "Search engine",
    lead: "mPL queries compile to ClickHouse SQL with admission guards before execution.",
    paragraphs: [
      "Parser: mobipwn-search/src/mpl/. SQL generator: sql_gen.rs. Time bounds: admission.rs resolves API picker, `last` prefix, or smart defaults for case/IoC hunts.",
      "Row limits wrap SQL with apply_row_limit — pipe `head` in the query and API cap work together without double-LIMIT syntax errors.",
    ],
    callouts: [
      {
        variant: "tip",
        body: "Language reference: /search/mpl. Android recipes: /search/guide.",
      },
    ],
  },
  {
    id: "detection",
    group: "engines",
    title: "Detection & alerts",
    lead: "Rules share mPL. Scheduled runs use mobipwn-jobs; staging rules only fire on Run now.",
    table: {
      headers: ["Lifecycle", "Scheduled jobs", "Alerts"],
      rows: [
        ["staging", "Skipped", "Run now only (API)"],
        ["live", "Cron when due", "Yes"],
        ["alerting", "Cron when due", "Yes"],
      ],
    },
    list: [
      "execute_detection_rule in mobipwn-search — shared by API Run now and jobs",
      "Up to 100 hits per run; max_alerts_per_run caps alert upserts (default 50)",
      "Realtime rules: filter-only mPL → ClickHouse MV on insert → detection_signals",
      "Dedup key: rule_id + platform, bundle_id, parser, device_id facets",
    ],
  },
  {
    id: "jobs-loop",
    group: "engines",
    title: "Jobs process",
    lead: "mobipwn-jobs: per-rule and per-provider crons plus a 60s housekeeping loop.",
    table: {
      headers: ["Interval", "Task"],
      rows: [
        ["Per-rule cron", "execute_detection_rule for live/alerting rules (from DB schedule)"],
        ["Per-provider cron", "Incremental marketplace enrichment sync"],
        ["~2 min", "Reconcile schedulers; realtime signals → alert upsert"],
        ["~10 min", "Sync realtime rule materialized views"],
        ["~15 min", "Field prevalence rollup"],
        ["~24 h", "IronSift scheduled fleet baselines"],
      ],
    },
    code: {
      title: "Logs",
      body: "tail -f .dev/jobs.log\n# or MOBIPWN_EXPOSE_DEV_LOGS=1 → GET /v1/dev/logs",
    },
  },
  {
    id: "enrichment",
    group: "engines",
    title: "Marketplace & enrichment",
    lead: "Providers sync indicators into ClickHouse dictionaries; mPL lookup attaches columns at query time.",
    paragraphs: [
      "Configure providers on Marketplace. Sync runs from the UI or jobs (incremental by default). `lookup vt dest_ip` and `lookup play bundle_id` add columns without mutating raw events.",
    ],
    list: [
      "POST /v1/marketplace/sync — trigger sync",
      "GET /v1/marketplace/coverage — MUDM field coverage %",
    ],
  },
  {
    id: "api",
    group: "interfaces",
    title: "REST API",
    lead: "Axum API on :3000 — OpenAPI at /swagger-ui. Web dev server proxies /api → API.",
    table: {
      headers: ["Area", "Key paths"],
      rows: [
        ["Health", "GET /health, /ready, /v1/health/detail"],
        ["Search", "POST /v1/search/run, /compile, /export"],
        ["Ingest", "POST /v1/ingest/bugreport, /sysdiagnose, /jsonl"],
        ["Rules", "CRUD /v1/rules, POST …/validate, …/run"],
        ["Alerts", "GET /v1/alerts, POST …/bulk, timeline events"],
        ["Cases", "GET/POST /v1/cases, link alerts"],
      ],
    },
    callouts: [
      {
        variant: "note",
        body: "MOBIPWN_REQUIRE_AUTH=1 enables X-Api-Key / Bearer on all routes.",
      },
    ],
  },
  {
    id: "ui",
    group: "interfaces",
    title: "Web UI",
    lead: "React + Vite SPA — lazy routes, shared layout, activity log, optional OpenAI-compatible LLM assistant.",
    table: {
      headers: ["Page", "Backend touchpoints"],
      rows: [
        ["Search", "mPL bar, timeline, field sidebar, enrichment toolbar"],
        ["Detections", "Rule editor, validate, Run now, version history"],
        ["Alerts", "Triage queue, assignee, hunt link → Search"],
        ["Inbox / Cases", "Case workflow, alert linkage"],
        ["Data", "Source summary, delete ingest label"],
        ["Marketplace", "Provider enable, sync stream"],
      ],
    },
  },
  {
    id: "config",
    group: "interfaces",
    title: "Key configuration",
    lead: "Environment variables from .env.example — search limits, auth, datastore URLs.",
    table: {
      headers: ["Variable", "Default", "Effect"],
      rows: [
        ["MOBIPWN_POSTGRES_URL", "local DSN", "Postgres connection"],
        ["MOBIPWN_CLICKHOUSE_URL", "http://127.0.0.1:8123", "ClickHouse HTTP"],
        ["MOBIPWN_SEARCH_MAX_LIMIT", "10000", "Max rows per search"],
        ["MOBIPWN_SEARCH_DEFAULT_HOURS", "24", "Default wall-clock window"],
        ["MOBIPWN_SEARCH_REQUIRE_TIME_RANGE", "1", "Broad queries need time or IoC filter"],
        ["MOBIPWN_JOBS_ENABLED", "1", "Set 0 to disable jobs process"],
        ["MOBIPWN_REQUIRE_AUTH", "0", "API key auth when 1"],
      ],
    },
  },
];

export function archSectionsForGroup(groupId: string): ArchGuideSection[] {
  return ARCH_GUIDE_SECTIONS.filter((s) => s.group === groupId);
}

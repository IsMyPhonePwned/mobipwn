# Bugreport parser → MUDM field export

How Android bugreport timeline rows become searchable ClickHouse columns.

## Pipeline (where each step lives)

| Step | Location | What happens |
|------|----------|--------------|
| 1. Parse sections | `bugreport-extractor-library/src/parsers/*.rs` | Each parser (`PackageParser`, `ProcessParser`, …) reads dumpstate text → JSON |
| 2. Timeline rows | `bugreport-extractor-library/src/timeline.rs` | `flatten_*` per parser calls `push_event()` — merges parser JSON into each row (`pkg`, `cmd`, `local_address`, …) |
| 2b. UID enrichment | `bugreport-extractor-library/src/uid_package.rs` | `enrich_parser_results()` maps socket `uid` → `package_name` or `process_cmd` / `process_pid` from Package + Process parsers |
| 3. JSONL export | `bugreport-extractor-library/src/timeline.rs` | `export_timeline()` → `TimelineExport.jsonl` |
| 4. mobipwn ingest | `mobipwn-ingest/src/extractors.rs` | `parse_android_bugreport()` → `ingest_jsonl()` |
| 5. JSONL → MUDM | `mobipwn-ingest/src/timeline.rs` | `normalize_timeline_line()` per line |
| 6. **Per-parser columns** | **`mobipwn-core/src/mudm/bugreport_parser_fields.rs`** | **`apply_bugreport_parser_fields()`** promotes parser-specific keys |
| 7. Generic columns | `mobipwn-core/src/mudm/normalize.rs` | Shared picks (`bundle_id`, `process_name`, …) + `extract_ext()` for leftovers |
| 8. Storage | `mobipwn-core/src/ch/event_row.rs` + `clickhouse/init.sql` | Top-level columns + `ext` JSON string |

## MUDM columns per parser

Defined in code: `mobipwn-core/src/mudm/bugreport_parser_fields.rs` (`PARSER_FIELD_MAP` + `apply_*` functions).

| Parser | Top-level MUDM fields (from timeline JSON) |
|--------|---------------------------------------------|
| **Package** | `bundle_id` ← `pkg`, `package_name`; `action` ← `event_type`; `app_name` ← `label`, `versionName` |
| **Process** | `process_name` ← `cmd`; `process_id` ← `pid`; `user` |
| **Network** | `dest_ip` ← `peer_ip` (enriched peer) then remote addresses; listeners omit wildcard `dest_ip`; `owner` when `owner_type` is `package`/`process` — skip `unattributed`/`unknown`; stale sockets keep peer IP only |
| **Battery** | `bundle_id` ← `package_name`; `action` ← `status`, `level` |
| **Crash** | `process_name`, `process_id` ← `pid`; `action` ← `signal`, `filename`, `abort_message`; `file_hash`; `file_path` via `ext` (sigma); backtrace rows use `tombstone_process` |
| **Power** | `action` ← `event_type`, `reason` |
| **Usb** | `action` ← `product_name`, `id`; `app_name` ← `manufacturer` |
| **Bluetooth** | `app_name` ← `name`; `device_id` ← `address` |
| **Header** | `device_model`, `os_version`, `device_id` (device metadata) |
| **Memory** | (snapshot rows — mostly `message` + `ext`) |
| **DevicePolicy, Adb, Authentication, Vpn, Privacy** | `bundle_id`, `permission`, `action`, `user` when present in parser JSON |
| **Account** | `user` ← `user_name` / `owner_name` / `user_id`; `action` ← `account_type` / `event_type`; `app_name` ← owner/user/account name; `ext.email` when account name looks like an email |

Unmapped keys stay in **`ext`** (searchable via `JSONExtractString(ext, 'field')` in mPL).

### Sigma / Amnesty investigation fields (`sigma_fields.rs`)

After ingest, these are filled for website/Sigma rule parity:

| Field | Source |
|-------|--------|
| `event_type` | Timeline `event_type` or short suffix of `data_type` (`network_socket`, `tombstone_backtrace`, …) |
| `destination_domain` | Hostname from `remote_address` / socket rows (not bare IPs) |
| `remote_ip` | `remote_ip` on network sockets |
| `function` | Crash backtrace `function` / `symbol` |
| `file_path` | `path`, `filename`, `resourcePath`, … |
| `email` | Auth / message email-like fields |

Converted Amnesty rules live under `examples/mobipwn-queries/rules/amnesty/` (from `website/rules`).

## Hunt examples

```text
source="case-001" parser="Crash" data_type="android:bugreport:tombstone" | head 50
source="case-001" parser="Crash" | stats count by process_name | head 30
platform="android" parser="Package" bundle_id="com.example.app"
platform="android" parser="Network" dest_ip="8.8.8.8"
platform="android" parser="Process" process_name="system_server"
```

Re-ingest a bugreport after changing mappings so existing ClickHouse rows pick up new column values.

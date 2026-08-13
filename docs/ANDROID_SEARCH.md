# Android search guide (mPL)

Mobipwn search uses **mPL** (pipe-oriented queries). This guide focuses on **Android bugreport** data normalized to MUDM and stored in the ClickHouse `events` index.

**mPL syntax and commands:** [MPL_LANGUAGE.md](./MPL_LANGUAGE.md). **Platform architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md). In the UI: Search → **mPL language reference** (`/search/mpl`).

**Where to run queries:** Search page (`/search`) or `POST /v1/search/run`. The UI **Examples** chips mirror many queries below (replace `case-001` with your ingest label).

---

## Cases and `source`

Every ingest is tagged with a **`source`** label (your “case number”):

```bash
# Bugreport ingest
curl -X POST "http://127.0.0.1:3000/v1/ingest/bugreport?source=my-case-001" \
  --data-binary @bugreport.zip
```

In mPL, scope one case:

```text
source="my-case-001" …
```

- List labels: **Data** page or `GET /v1/data/summary`
- Open Search pre-scoped: **Cases → Search events**, or `/search?source=my-case-001`
- Cross-case hunts: omit `source=` (see [Cross-case hunts](#cross-case-hunts))

---

## Android fields (quick reference)

| Field | Use for |
|-------|---------|
| `source` | Case / ingest label |
| `platform` | `platform="android"` |
| `parser` | Module: `Package`, `Process`, `Crash`, `Network`, … |
| `bundle_id` | **Package name** (e.g. `com.example.app`) |
| `process_name` | Process / command line |
| `action` | Normalized action (often `INSTALL` on package rows) |
| `installer` | **Who installed the app** (in `ext`; e.g. `com.android.vending`) |
| `data_type` | Timeline type (`android:bugreport:network_socket`, tombstone, …) |
| `message` | Raw / human text (wildcards, bloom-friendly) |
| `src_ip`, `dest_ip` | Network endpoints |
| `local_port`, `remote_port` | Socket ports (in `ext`, Network parser) |
| `destination_domain` | Hostname IoCs (in `ext`) |
| `function` | Crash backtrace symbols (in `ext`) |

Full catalog: sidebar on Search, `GET /v1/search/fields`, [BUGREPORT_PARSER_FIELDS.md](./BUGREPORT_PARSER_FIELDS.md).

### Matching syntax

| Syntax | Meaning |
|--------|---------|
| `field="exact"` | Equality |
| `field="com.foo.*"` | Prefix glob (`*` → `%`) |
| `field=*substring*` | Contains |
| `field=*` | Field has a value (non-empty) |
| `!field="x"` | Same as `field!="x"` (exclusion) |
| `field!="x"` | Not equal / not matching |

### Time windows

1. Toolbar **date range** on Search  
2. Prefix: `last 24h`, `last 7d`, `now-90d`, …  
3. **No default 24h cap** when the query includes `source="…"` or IoC-style filters (`bundle_id`, `process_name`, `installer`, `dest_ip`, …) without `last`  
4. Broad queries (`platform="android"` only) may require an explicit range if `MOBIPWN_SEARCH_REQUIRE_TIME_RANGE=1`

Always end exploratory hunts with `| head N` (or `| stats … | head N`).

---

## Packages (`bundle_id`)

### One app in one case

```text
source="case-001" bundle_id="com.example.app" | head 100
source="case-001" bundle_id=*bitchat* | head 100
source="case-001" bundle_id="com.google.*" | head 100
```

### All packages in a case

```text
source="case-001" parser="Package" bundle_id=* | stats count by bundle_id | head 100
```

### Process vs package

Use `bundle_id` for APK package id; use `process_name` for cmdline / process:

```text
source="case-001" process_name=*com.google.android.gms* | head 50
```

---

## Installers (who installed an app)

`installer` searches `ext.installer`, and (for bugreport package metadata) **`installerPackageName`** / **`initiatingPackageName`** — no re-ingest required for existing data.

Typical values:

| `installer` | Meaning |
|-------------|---------|
| `com.android.vending` | Google Play Store |
| `com.google.android.packageinstaller` | System package installer UI |
| `com.android.packageinstaller` | Older system installer |
| *(empty)* | Often ADB / unknown / not in log |
| *other package* | Sideload, enterprise store, another app |

### All installers for one package (one case)

```text
source="case-001" bundle_id=*bitchat* parser="Package" installer=* | stats count by installer | head 50
```

Exact package id:

```text
source="case-001" bundle_id="com.example.bitchat" parser="Package" installer=* | stats count by installer | head 50
```

### Install events only

```text
source="case-001" bundle_id=*bitchat* parser="Package" (action="INSTALL" OR event_type="INSTALL") installer=* | stats count by installer | head 50
```

### Raw rows (case + time + installer)

```text
bundle_id=*bitchat* parser="Package" installer=* | fields timestamp, source, bundle_id, installer, action, message | sort -timestamp | head 100
```

**`fields` lists:** use commas (`timestamp, source, bundle_id`) or spaces (`timestamp source bundle_id`).

### Non–Play Store installs (hunt)

```text
parser="Package" platform="android" data_type=*package_metadata* installer=* installer NOT IN ("com.android.vending", "com.google.android.packageinstaller", "com.android.packageinstaller", "null", "com.facebook.system", "com.samsung.android.app.updatecenter", "com.sec.android.app.samsungapps", "com.android.managedprovisioning", "android") !file_path=*/system/* installer!=bundle_id | head 100
```

Or with exclusions (spaces = AND):

```text
parser="Package" installer=* !installer="com.android.vending" !installer="com.google.android.packageinstaller" !installer="null" installer!=bundle_id | stats count by bundle_id, installer | head 100
```

`installer!=bundle_id` compares two fields — it drops self-updates (e.g. `com.facebook.system` updating itself).

Bundled detection rule: **Package installed outside default installer** — seeded in `migrations/001_schema.sql` and `examples/mobipwn-queries/rules/mobile/sideload_package_install.yaml` (also: `mobipwn-dac deploy examples/mobipwn-queries`). Excludes common OEM updaters (Facebook system installer, Samsung Update Center, Galaxy Store, MDM provisioning). Appears on the **Rules** page after API migrations run.

---

## Cross-case hunts

Search **all ingested cases** (no `source=`). IoC filters like `bundle_id=*…*` usually skip the default 24h wall clock; add `last 90d` if you want an explicit cap.

### Package across cases + which case

```text
bundle_id=*bitchat* | stats count by source, bundle_id | head 100
```

### When it showed up, per case (timeline)

Open the **Timeline** tab after running:

```text
bundle_id=*bitchat* | timechart span=1d count by source limit=20
```

Finer buckets: `span=1h`.

### First hit per case

```text
bundle_id=*bitchat* parser="Package" action=*INSTALL* | stats min timestamp by source | head 50
```

### Installers across all cases

```text
bundle_id=*bitchat* parser="Package" installer=* | stats count by source, installer | head 100
```

**Note:** Bugreport timestamps reflect **when the event was recorded in the dump**, not always the real on-device install time.

---

## Processes

```text
source="case-001" parser="Process" process_name=* | stats count by process_name | head 100
source="case-001" process_name="com.google.android.gms" | head 50
```

---

## Crashes and ANRs

```text
source="case-001" parser="Crash" data_type="android:bugreport:tombstone" | head 100
source="case-001" parser="Crash" data_type="android:bugreport:anr_file" | head 50
source="case-001" parser="Crash" data_type="android:bugreport:anr_trace" | head 50
source="case-001" parser="Crash" process_name=* | stats count by process_name | head 50
```

Native crash IoC (example):

```text
(data_type=*tombstone_backtrace* AND function=*SomeSymbol*) | head 500
```

---

## Network

Sockets (IPs in columns; ports in `ext` or `message`):

```text
source="case-001" parser="Network" data_type="android:bugreport:network_socket" | head 200
source="case-001" parser="Network" dest_ip=* | stats count by src_ip, dest_ip | head 50
source="case-001" parser="Network" remote_port=* | stats count by src_ip, dest_ip, local_port, remote_port | head 50
```

Domain IoC:

```text
source="case-001" destination_domain="evil.com" | head 50
source="case-001" destination_domain=*evil* | head 50
```

---

## Overview and timelines

```text
source="case-001" | stats count by parser | head 30
source="case-001" | timechart span=1h count by parser limit=8
last 7d platform="android" | stats count by source | head 50
```

---

## Useful pipe commands

| Command | Example |
|---------|---------|
| `head` | `\| head 100` |
| `sort` | `\| sort -timestamp` |
| `stats` | `\| stats count by bundle_id \| head 50` |
| `stats` (first seen) | `\| stats min timestamp by source` |
| `timechart` | `\| timechart span=1d count by source limit=20` |
| `fields` | `\| fields timestamp, source, bundle_id, installer` |
| `dedup` | `\| dedup bundle_id` |

---

## API (optional)

```bash
curl -s -X POST http://127.0.0.1:3000/v1/search/run \
  -H 'Content-Type: application/json' \
  -d '{"query":"source=\"case-001\" parser=\"Package\" bundle_id=* | stats count by bundle_id | head 20"}'
```

Compile only (no run):

```bash
curl -s -X POST http://127.0.0.1:3000/v1/search/compile \
  -H 'Content-Type: application/json' \
  -d '{"query":"bundle_id=*bitchat* | head 10"}'
```

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| No results | Confirm **Data** shows events for your `source`; match ingest label in query |
| `parse error: trailing input: , …` | Use fixed web build; `fields` supports commas (`a, b, c`) |
| Validate / search fails on `\| head` | Remove stray comma before `\|` (`foo, \| head` → invalid) |
| `installer` always empty | Widen to `parser="Package" \| stats count by action, installer`; bugreport may lack install log |
| Slow / blocked query | Add `source=` or `last 7d`; narrow with `parser=` |

---

## See also

- [AGENTS_CRAFTING_SEARCHES.md](./AGENTS_CRAFTING_SEARCHES.md) — agent hunt workflow
- UI: `/guide/agents/search`
- [examples/README.md](../examples/README.md) — ingest and query packs  
- [BUGREPORT_PARSER_FIELDS.md](./BUGREPORT_PARSER_FIELDS.md) — parser → field mapping  
- Search UI **Examples** chips (scoped to active case)

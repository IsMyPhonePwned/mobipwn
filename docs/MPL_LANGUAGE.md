# mPL language reference

**mPL** (Mobipwn Pipe Language) is how analysts search device events and author detection rules in Mobipwn. It is pipe-oriented (Splunk SPL–style) and compiles to ClickHouse SQL against the event index.

> **In the UI:** Search → **mPL language reference** (`/search/mpl`) for an interactive guide with copy/run examples. For Android hunt recipes, see [ANDROID_SEARCH.md](./ANDROID_SEARCH.md).

---

## At a glance

Every query has the same shape:

```text
[time modifier]  <search clause>  [| command]*
```

| Segment | What it does |
|---------|----------------|
| **Time** | Optional wall-clock window — `last 24h`, `now-7d` |
| **Search** | Boolean filters on MUDM event fields |
| **Pipes** | Transform rows: summarize, enrich, chart, project columns |

**Three queries to remember:**

```text
last 24h platform="android" | head 20
source="case-001" parser="Network" | stats count by dest_ip | head 20
platform="android" | timechart span=1h count by parser limit=8
```

> **Tip:** End exploratory hunts with `| head N`. It keeps scans fast and results manageable.

---

## Table of contents

1. [Time modifiers](#time-modifiers)
2. [Search expressions](#search-expressions)
3. [Pipe commands](#pipe-commands)
4. [Common fields](#common-fields)
5. [Analyst habits](#analyst-habits)
6. [Implementation](#implementation)

---

## Time modifiers

Prefix the search bar, or set **From / To** on the Search page. The time picker overrides inline `last …` when both are set.

| Syntax | Window |
|--------|--------|
| `last 15m` | Last 15 minutes |
| `last 24h` | Last 24 hours |
| `last 7d` | Last 7 days |
| `now-7d` | Same as `last 7d` |
| `@timestamp last 1h` | Accepted prefix (no effect) |

Units: `m` / `min`, `h` / `hr`, `d` / `day`, `w` / `week`.

### How Mobipwn picks a default window

When you omit `last` / `now-` and the API has no `time_from` / `time_to`:

1. **Case hunts** — queries with `source=` — and **IoC field filters** (`bundle_id`, `process_name`, `dest_ip`, `destination_domain`, `file_hash`, …) search **all event time** in scope. No surprise 24h cutoff.
2. Queries filtered only by `platform`, `parser`, `device_id`, or `source_type` also skip the default wall-clock window.
3. Everything else gets `MOBIPWN_SEARCH_DEFAULT_HOURS` (typically 24h).

Set `MOBIPWN_SEARCH_REQUIRE_TIME_RANGE=1` to force explicit time on broad platform-only queries.

---

## Search expressions

The search clause is boolean logic over fields.

- **Implicit AND** — whitespace between terms
- **Explicit** — `AND`, `OR`, `NOT`, parentheses
- **Compare** — `=`, `!=`, `>`, `<`, `>=`, `<=`
- **Shorthand** — `!field="x"` means `field!="x"`

### Field matching

```text
platform="android"
severity!="low"
bundle_id="com.foo.*"      // prefix glob
message=*error*            // contains
bundle_id=*                // field has a value
*bitchat*                  // bare wildcard → message
```

### IN lists

```text
platform IN ("android", "ios")
parser NOT IN ("Heartbeat", "Noise")
```

### Comments

```text
// line comment
/* block comment */
```

> **Tip:** Prefer `bundle_id`, `process_name`, and `dest_ip` over `message=*…*` — structured fields are faster and easier to pivot on.

---

## Pipe commands

Commands follow `|` and run in order.

### `where`

Filter after prior stages (same syntax as the search clause).

```text
platform="android" | where dest_ip=* | head 100
```

### `stats`

Aggregate rows.

```text
| stats count
| stats count by parser
| stats dc device_id by source
| stats values bundle_id by parser
```

| Function | Result |
|----------|--------|
| `count` | Row count per group |
| `dc` / `distinct_count` | Distinct values |
| `values` | Unique values (array) |
| `list` | All values (array) |
| `sum`, `avg`, `min`, `max` | Numeric aggregate |

`by` fields: comma- or space-separated. Trailing comma allowed.

### `head` · `sort`

```text
| head 100
| sort timestamp
| sort -timestamp          // descending
```

### `fields` · `rename`

```text
| fields timestamp, source, bundle_id, message
| rename bundle_id AS package
```

`AS` is optional.

### `eval` · `dedup` · `rex`

```text
| eval risk=if(severity="high",1,0)
| dedup bundle_id
| rex ip=(\d+\.\d+\.\d+\.\d+) field=message
```

`rex` stores capture group 1 in the named column. Default source field: `message`.

### `lookup`

Enrichment from Marketplace providers (ClickHouse dictionaries).

```text
| lookup dest_ip
| lookup geo dest_ip
| lookup vt dest_ip
| lookup play bundle_id
```

Supported keys: `src_ip`, `dest_ip`, `file_hash`, `destination_domain`, `bundle_id`.

### `join`

```text
| join device_id [ platform="ios" | head 100 ]
| join type=left device_id [ source="case-002" | stats count by device_id ]
```

Subquery in `[ … ]`. `type=inner` (default) or `type=left`.

### `timechart`

Bucketed metrics for the Search timeline.

```text
| timechart span=1h count
| timechart span=1h count by parser limit=8
| timechart span=1h avg raw_level
| timechart span=1h avg(raw_level)
| timechart span=1d count by parser limit=5 useother=false
```

| Option | Default | Role |
|--------|---------|------|
| `span` | — | Bucket: `15m`, `1h`, `1d` |
| `count` / `avg` / `min` / `max` / `sum` | — | Aggregation (`avg`/`min`/`max`/`sum` need a field) |
| `by` | — | Split series |
| `limit` | 10 | Top N series; `0` = all |
| `useother` | true | Roll minor series into **Other** |

Example (iOS powerlogs battery, workshop-style):

```text
source="case-…" parser="powerlogs" timestamp_desc="Battery Level" | timechart span=1h avg raw_level
```

Also works against older ingests that only have the activity in `message`:

```text
source="case-…" parser="powerlogs" message="Battery Level*" | timechart span=1h count
```

---

## Common fields

Events follow **MUDM**. Full catalog: Search sidebar, `/mudm`, `GET /v1/search/fields`.

| Field | Analyst use |
|-------|-------------|
| `source` | Case / ingest label — scope most hunts |
| `platform` | `android` or `ios` |
| `parser` | `Package`, `Process`, `Network`, `Crash`, … |
| `bundle_id` | Android package name |
| `process_name` | Process or command line |
| `src_ip`, `dest_ip` | Network endpoints |
| `destination_domain` | Hostname IoC |
| `installer` | APK installer (in `ext`) |
| `data_type` | Event subtype |
| `message` | Raw text |
| `timestamp` | Event time on device |
| `device_id` | Pivot across parsers on one phone |

Parser-specific keys may live in **`ext`** (JSON) when not promoted to a top-level column.

---

## Analyst habits

1. **Scope cases** — `source="your-case"` for bugreport work; you get the full device timeline.
2. **Cap rows** — `| head N` on every exploratory query.
3. **stats before head** — summarize first, then limit.
4. **timechart for volume** — “how much over time?”; **stats** for “top N what?”
5. **Test in Search, paste into rules** — detection rules use the same mPL.
6. **Android recipes** — [ANDROID_SEARCH.md](./ANDROID_SEARCH.md) has copy-paste hunts.

---

## Implementation

| Piece | Location |
|-------|----------|
| Parser | `mobipwn-search/src/mpl/` |
| SQL generator | `mobipwn-search/src/sql_gen.rs` |
| Time admission | `mobipwn-search/src/admission.rs` |
| Golden tests | `mobipwn-search/tests/mpl_golden.rs` |

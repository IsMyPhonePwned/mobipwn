# Crafting searches with an agent

Use an LLM or coding agent to translate natural-language hunting questions into **mPL** queries on mobile device telemetry.

In MobiPwn use **`mobipwn-mcp`** (Cursor/Claude), the in-app **Assistant**, or REST + docs.

**Setup:** add repo root [`AGENTS.md`](../AGENTS.md) to your Cursor / Claude project.

## Why an agent helps

mPL is small and pipe-based, but good mobile hunts still require knowing:

- Which **MUDM fields** to filter (`bundle_id`, `parser`, `installer`, `dest_ip`, …)
- **Case scoping** — `source="case-001"` vs cross-case IoC pivots
- **Platform** — `platform="android"` vs `ios`
- Which pipes to use (`stats`, `timechart`, `lookup`, `head`)
- **Prevalence / rarity** — Search sidebar or `prevalence_scatter` (MCP) to focus on rare artefacts
- **Time bounds** — `last 24h`, `last 90d`, or source-scoped “all event time”

An agent that has read [docs/MPL_LANGUAGE.md](MPL_LANGUAGE.md) and the [MUDM field catalog](../mobipwn-web/src/lib/mudmFieldCatalog.ts) (or `/mudm` in the UI) can apply that to questions phrased in English.

## Workflow

### Step 1: Point the agent at the references

Tell the agent (or add to your project rules / root `AGENTS.md`):

> When writing mPL for MobiPwn, use `docs/MPL_LANGUAGE.md`, `docs/AGENTS_CRAFTING_SEARCHES.md`, the Search guide (`/search/guide`), and MUDM fields (`/mudm`). Mobile data uses `platform="android"` or `"ios"` and case labels in `source=`.

With MCP: wire **`mobipwn-mcp`** and read resources:

- `mobipwn://docs/mpl-language`
- `mobipwn://docs/agents-crafting-searches`
- `mobipwn://docs/android-search`

See [docs/MCP.md](MCP.md).

### Step 2: Ask the question in English

Be specific about:

- **Case** — `source="case-001"` vs cross-case IoC hunt
- **Platform** — Android bugreport vs iOS sysdiagnose (`platform=`)
- **Time** — `last 24h`, `last 7d`, or all event time when scoped by `source=`
- **Shape** — raw events, `stats by …`, or `timechart`

Example:

> Hunt sideloaded apps on Android case case-001. Show package, installer, and count. Use last 30 days if needed.

### Step 3: Review the mPL draft

Check field names on `/mudm`, scoping, time syntax (`last 24h`, not SQL), and aggregation shape.

### Step 4: Run it

- Paste into **Search**, or click **Try in Search** from the Search guide examples
- **MCP (preferred for external agents):** `search_run` — ask *“Run that query and show me the top 5 results.”*
- **Assistant:** refine after pasting result snippets
- **API:** `POST /v1/search/run` with `{ "query": "…", "limit": 50 }`

This **ask → query → review → refine** loop is the interactive hunt workflow.

### Step 5: Iterate

Almost no first-shot query is right. Common refinements:

| Problem | mPL direction |
| --- | --- |
| Too noisy | Add `parser=` filters; `prevalence_scatter` for rare IoCs |
| Too narrow | Loosen field filters; verify spelling on `/mudm` |
| Wrong shape | Switch `stats by X` ↔ `timechart span=1h` ↔ `head N` |
| Unknown field | `search_fields_in_scope` or `GET /v1/mudm/fields` |

Use `| head 10` while iterating; drop the limit when the shape is right. Hand results back to the agent — don’t rewrite by hand if MCP is wired.

## Promoting a hunt to a detection

When a query consistently finds real issues, it’s a candidate for a scheduled detection. Ask your agent:

> Take that query and convert it into a mobipwn-dac detection file. Severity high, cron every 15 minutes. Save it to `rules/mobile/`.

Paths:

1. **Rules editor** — paste mPL, set severity, cron, lifecycle
2. **mobipwn-dac** — save as `rules/mobile/sideload_installers.yaml` and deploy
3. **MCP** — `rules_validate_query` then `rules_create`

Validate with `POST /v1/rules/validate-query` before enabling.

## Example hunts to practice with an agent

| Question | Starting mPL |
| --- | --- |
| Packages on a case | `source="case-001" parser="Package" \| head 20` |
| Sideloaded apps | `source="case-001" installer=* !installer="com.android.vending" \| head 20` |
| Network destinations | `source="case-001" dest_ip=* \| stats count() by dest_ip \| head 30` |
| Parser mix over time | `platform="android" last 24h \| timechart span=1h count by parser limit=8` |
| Cross-case domain IoC | `destination_domain=*suspicious* \| head 50` |

## Tips

- **Tell the agent your case label** — scoped hunts need the exact `source` string from Ingest / Data.
- **Tell the agent your field schema** — mention non-standard parser names in the prompt or `AGENTS.md`.
- **Use `| head N` while iterating** — cheap to run, fast to review.
- **Save reusable searches as macros** — `saved_queries_create` / UI saved queries for hunts you repeat.
- **Prefer column fields** from MUDM; ext-promoted names (`installer`, `destination_domain`) still work in mPL.
- **Check admission** — very broad queries may require `last 24h` or a `source=` / IoC filter (Settings → search limits).
- **Field cardinality** — `stats count by` on high-cardinality fields can be slow; scope with `source=` first.
- **IronSift** uses `platform="endpoint"` JSONL — different schema; say so in the prompt if hunting endpoint telemetry.

## What’s next

- [mPL language reference](MPL_LANGUAGE.md)
- [Android search recipes](ANDROID_SEARCH.md)
- [Agents overview](AGENTS.md)
- [MCP setup](MCP.md)
- UI: `/guide/agents/search`

# MobiPwn MCP server

`mobipwn-mcp` is the **external LLM integration** for MobiPwn. Wire it into **Cursor**, **Claude Desktop**, **Claude Code**, or any MCP client so your model can search mPL, triage alerts, and manage cases without the in-app Assistant.

Detection-as-code GitOps remains **`mobipwn-dac`**; the MCP server also exposes `rules_validate_query`, `rules_create`, and `saved_queries_create` for promoting hunts.

## Build

```bash
cargo build --release -p mobipwn-mcp
# binary: target/release/mobipwn-mcp
```

## Configure

| Variable | Default | Purpose |
|----------|---------|---------|
| `MOBIPWN_API_URL` | `http://127.0.0.1:3000` | `mobipwn-api` base URL |
| `MOBIPWN_API_KEY` | — | Sent as `X-API-Key` when auth is enabled |

Start **mobipwn-api** first. When `MOBIPWN_REQUIRE_AUTH=1`, an admin creates named keys in **Settings → API keys** (link each key to a user for audit). Paste the token into the MCP client as `MOBIPWN_API_KEY` — there is no shared `.env` bootstrap key on the server.

## Cursor

Project or global MCP config (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "mobipwn": {
      "command": "/absolute/path/to/mobipwn/target/release/mobipwn-mcp",
      "env": {
        "MOBIPWN_API_URL": "http://127.0.0.1:3000",
        "MOBIPWN_API_KEY": "your-api-key"
      }
    }
  }
}
```

Development (debug build):

```json
{
  "mcpServers": {
    "mobipwn": {
      "command": "cargo",
      "args": ["run", "-p", "mobipwn-mcp", "--manifest-path", "/absolute/path/to/mobipwn/Cargo.toml"],
      "env": {
        "MOBIPWN_API_URL": "http://127.0.0.1:3000",
        "MOBIPWN_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "mobipwn": {
      "command": "/absolute/path/to/mobipwn/target/release/mobipwn-mcp",
      "env": {
        "MOBIPWN_API_URL": "http://127.0.0.1:3000",
        "MOBIPWN_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Tools (investigator)

| Tool | API | Purpose |
|------|-----|---------|
| `search_run` | `POST /v1/search/run` | Execute mPL |
| `search_compile` | `POST /v1/search/compile` | mPL → SQL |
| `mudm_list_fields` | `GET /v1/mudm/fields` | Field catalog |
| `search_field_stats` | `POST /v1/search/field-stats` | Top field values |
| `search_fields_in_scope` | `POST /v1/search/fields-in-scope` | Fields in filter |
| `prevalence_scatter` | `POST /v1/prevalence/scatter` | Rarity / noise reduction in a scope |
| `overview` | `GET /v1/overview` | Platform snapshot |
| `cases_list` / `cases_get` / `cases_entities` / `cases_wall` | cases API | Investigation |
| `cases_patch` / `cases_link_alert` | cases API | Case updates |
| `alerts_list` / `alerts_get` / `alerts_patch` | alerts API | Triage |
| `rules_list` / `rules_validate_query` / `rules_create` | rules API | Detections |
| `saved_queries_list` / `saved_queries_create` | saved queries | Hunt library |
| `get_event` | `GET /v1/events/{id}` | Single row drill-down |
| `llm_status` | `GET /v1/llm/status` | Server LLM config (optional) |

## Resources

Embedded repo docs (no network):

| URI | Content |
|-----|---------|
| `mobipwn://docs/agents` | `docs/AGENTS.md` |
| `mobipwn://docs/agents-crafting-searches` | Hunt workflow |
| `mobipwn://docs/mpl-language` | mPL reference |
| `mobipwn://docs/android-search` | Android hunt recipes |

## Prompts

| Name | Use |
|------|-----|
| `hunt` | Start a mobile threat hunt (`question`, optional `case_source`) |
| `triage_alert` | Triage flow for an `alert_id` |

## Workflow

Same loop as [Crafting searches](AGENTS_CRAFTING_SEARCHES.md) / in-app guide `/guide/agents/search`:

1. Read `mobipwn://docs/agents-crafting-searches`
2. `mudm_list_fields` or `search_fields_in_scope`
3. Draft mPL with `source="case-…"` or `last 24h`
4. `search_run` with `| head N` while iterating
5. Triage with alerts/cases tools; promote with `rules_validate_query` + `rules_create`

## In-app Assistant vs MCP

| | In-app Assistant | `mobipwn-mcp` |
|--|------------------|---------------|
| Client | MobiPwn UI (top-bar Assistant) | Cursor, Claude Desktop, LM Studio + MCP, any MCP host |
| LLM | **Settings → LLM** (your OpenAI-compatible endpoint) | **Host’s** model (not configured in MobiPwn Settings) |
| Data access | MobiPwn API injects live context, then one LLM call | Host model calls MCP tools → REST API |
| Auth | Browser session | `MOBIPWN_API_KEY` |

Use **Assistant** for quick in-UI questions (“list alerts in the queue”) with your chosen LLM. Use **MCP** when an external chat client should drive hunts and triage via tools.

## Related

- [docs/AGENTS.md](AGENTS.md) — agent workflows overview
- [mobipwn-dac](../mobipwn-dac/) — GitOps rule deploy CLI

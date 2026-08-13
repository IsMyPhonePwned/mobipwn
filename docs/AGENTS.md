# Agents & LLM workflows

Analysts use AI to **author detections** and to **hunt interactively**. MobiPwn is self-hosted and uses an **OpenAI-compatible LLM** (Ollama, LM Studio, OpenAI, Azure, Groq, …) plus optional **GitOps** tooling.

## Which workflow do I want?

| | **Detection-as-code** | **Hunt & investigate** |
| --- | --- | --- |
| **Job** | Author and deploy mPL detection rules and saved queries | Search, triage alerts, investigate cases, refine hunts |
| **Direction** | Writes rules to MobiPwn | Mostly reads; writes cases, rules, and saved queries |
| **Workflow** | GitOps: draft YAML → validate → `mobipwn-dac deploy` | Interactive: ask → mPL → run → iterate |
| **Surface** | `mobipwn-dac` CLI + repo `rules/` | **`mobipwn-mcp`** + in-app Assistant + Search UI |
| **Who** | Detection engineers | SOC analysts and mobile threat hunters |

When a hunt surfaces behaviour that deserves a standing rule, promote it with **detection-as-code** (`mobipwn-dac` or the Rules editor).

## Three ways to drive MobiPwn with an agent

### 1. In-app LLM assistant

Configure **Settings → LLM assistant** with any OpenAI-compatible `/chat/completions` endpoint (local or hosted). The top-bar **Assistant** calls `POST /v1/llm/chat`:

1. MobiPwn detects when you ask for live data (alerts, overview, cases, rules).
2. The API fetches that data with your **session** (same path as REST / MCP).
3. Your configured LLM receives the facts in a **LIVE CONTEXT** block and answers in plain language.

- **Local:** Ollama (`http://127.0.0.1:11434/v1`), LM Studio (`http://127.0.0.1:1234/v1`) — usually no API key
- **Hosted:** OpenAI, Azure OpenAI, Groq — base URL + model id + API key

No MCP hop in the UI — the server supplies data; the distant LLM only summarizes. For IDE agents where **the host model** must call tools itself, use **`mobipwn-mcp`** (below).

### 2. External LLM via MCP — `mobipwn-mcp`

The primary integration for **external** models (Cursor, Claude Desktop, Claude Code). Stdio MCP server over `mobipwn-api`:

```bash
cargo build --release -p mobipwn-mcp
export MOBIPWN_API_URL=http://127.0.0.1:3000
export MOBIPWN_API_KEY=mpwn_…   # from Settings → API keys
# Wire target/release/mobipwn-mcp into your MCP client — see docs/MCP.md
```

**Tools:** `search_run`, `mudm_list_fields`, alerts/cases triage, `rules_validate_query`, …  
**Resources:** embedded `docs/MPL_LANGUAGE.md`, hunt workflow, agents overview.  
**Prompts:** `hunt`, `triage_alert`.

Full setup: **[docs/MCP.md](MCP.md)** (Cursor / Claude config examples).

### 3. External agent without MCP (REST + docs)

Point any agent at this repository’s docs and API:

| Reference | Use for |
| --- | --- |
| [docs/MPL_LANGUAGE.md](MPL_LANGUAGE.md) | mPL syntax and pipes |
| [docs/AGENTS_CRAFTING_SEARCHES.md](AGENTS_CRAFTING_SEARCHES.md) | Hunt workflow |
| `/search/mpl`, `/search/guide`, `/mudm` in the UI | Interactive references |
| `POST /v1/search/run` | Execute mPL and return JSON rows |
| `GET /v1/mudm/fields` | Searchable MUDM field catalog |

Optional: add a project rule (`.cursor/rules` or `AGENTS.md` in repo root) telling the agent to prefer `source="case-…"` scoping and `| head N` while iterating. Prefer **`mobipwn-mcp`** when your client supports MCP.

### 4. Detection-as-code — `mobipwn-dac`

Deploy YAML rules and saved queries from a directory:

```bash
export MOBIPWN_API_URL=http://127.0.0.1:3000
export MOBIPWN_API_KEY=mpwn_…   # from Settings → API keys
mobipwn-dac deploy ./my-rules-repo
```

Layout:

```
my-rules-repo/
  rules/**/*.yaml      # detection rules (name, query, severity, cron, …)
  queries/**/*.yaml    # saved hunt queries
```

Validate queries in the Rules editor (`POST /v1/rules/validate`) before deploy.

## Sections

- [MCP server setup](MCP.md) — Cursor, Claude, tool list
- [Crafting searches with an agent](AGENTS_CRAFTING_SEARCHES.md) — natural language → mPL hunts

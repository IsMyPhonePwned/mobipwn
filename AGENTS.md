# MobiPwn agent instructions

When hunting or authoring detections on this repository:

1. **Search language:** mPL — read [docs/MPL_LANGUAGE.md](docs/MPL_LANGUAGE.md) and `/search/mpl` patterns.
2. **Hunt workflow:** follow [docs/AGENTS_CRAFTING_SEARCHES.md](docs/AGENTS_CRAFTING_SEARCHES.md).
3. **Fields:** verify names via [docs/ANDROID_SEARCH.md](docs/ANDROID_SEARCH.md), `/mudm`, or `mudm_list_fields` (MCP).
4. **Run queries:** prefer **`mobipwn-mcp`** `search_run` with `| head N` while iterating — see [docs/MCP.md](docs/MCP.md).
5. **Scoping:** use `source="case-…"` for single-ingest hunts; `platform="android"` or `"ios"`; add `last 24h` when admission requires a time bound.
6. **Promote hunts:** `rules_validate_query` then `rules_create` or `mobipwn-dac` YAML under `rules/`.
7. **Reuse hunts:** `saved_queries_create` (saved-query “macros”).

Do not invent SQL time predicates — use mPL `last Nh` / `last Nd`, not `time > now() - 24h`.

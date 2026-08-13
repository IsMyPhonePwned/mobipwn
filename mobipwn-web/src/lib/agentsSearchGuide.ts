import type { MplGuideCallout, MplGuideTable } from "./mplLanguageGuide";

export type AgentsSearchStep = {
  id: string;
  number: number;
  title: string;
  lead: string;
  bullets?: string[];
  callouts?: MplGuideCallout[];
  examplePrompt?: string;
  exampleQuery?: string;
  code?: string;
  table?: MplGuideTable;
};

export const AGENTS_SEARCH_WHY: string[] = [
  "Which MUDM fields to filter (bundle_id, parser, installer, dest_ip) and which are populated on your parsers",
  "Case scoping — source=\"case-001\" vs cross-case IoC pivots",
  "Which pipes make useful output — stats, timechart, lookup, head",
  "When to use prevalence / rarity (Search sidebar or prevalence_scatter via MCP) to cut noise",
  "Time bounds — last 24h, last 90d, or all event time for a scoped source",
];

export const AGENTS_SEARCH_STEPS: AgentsSearchStep[] = [
  {
    id: "refs",
    number: 1,
    title: "Point the agent at the references",
    lead: "Docs, MUDM catalog, and optional MCP resources before writing mPL.",
    bullets: [
      "Repo root AGENTS.md + docs/MPL_LANGUAGE.md + docs/AGENTS_CRAFTING_SEARCHES.md",
      "MUDM: /mudm, docs/ANDROID_SEARCH.md, or mobipwn-mcp mudm_list_fields",
      "Hunt recipes: /search/guide — wire mobipwn-mcp for search_run (docs/MCP.md)",
      "MCP resources: mobipwn://docs/mpl-language, mobipwn://docs/agents-crafting-searches, mobipwn://docs/android-search",
    ],
    callouts: [
      {
        variant: "note",
        body: "Prefer mobipwn-mcp for interactive hunts and mobipwn-dac for GitOps rule deploy.",
      },
    ],
  },
  {
    id: "ask",
    number: 2,
    title: "Ask in English",
    lead: "Be explicit about case scope, platform, time window, and the shape of the answer.",
    examplePrompt:
      "Hunt sideloaded apps on Android case case-001. Show package, installer, and count. Use last 30 days if needed.",
    bullets: [
      "Case scope: source=\"case-001\" vs cross-case IoC (destination_domain, dest_ip)",
      "Platform: platform=\"android\" or \"ios\" (endpoint JSONL: platform=\"endpoint\")",
      "Time: last 24h, last 7d, or all event time when source= is set",
      "Output: raw events, stats by field, or timechart timeline",
    ],
  },
  {
    id: "draft",
    number: 3,
    title: "Review the mPL draft",
    lead: "Check field names, scoping, time syntax, and aggregation shape before you run.",
    exampleQuery: `source="case-001" platform="android" installer=* !installer="com.android.vending"
| stats count() as installs by bundle_id, installer
| sort -installs
| head 50`,
    bullets: [
      "Field accuracy — verify on /mudm; installer and destination_domain are often ext-promoted",
      "Time syntax — use last 24h in mPL, not SQL time > now() - 24h",
      "Aggregation — stats … by vs timechart vs head-only raw events",
    ],
  },
  {
    id: "run",
    number: 4,
    title: "Run it",
    lead: "ask → query → review → refine — the interactive hunt loop for self-hosted MobiPwn.",
    examplePrompt: "Run that query and show me the top 5 results.",
    bullets: [
      "Search UI — paste or Try in Search from this guide",
      "mobipwn-mcp — search_run (preferred for Cursor / Claude)",
      "Assistant — refine after pasting result snippets",
      "REST — POST /v1/search/run with { \"query\": \"…\", \"limit\": 50 }",
    ],
    callouts: [
      {
        variant: "tip",
        title: "Admission limits",
        body: "Broad platform-only queries may need last 24h or source= — Settings → search limits.",
      },
    ],
  },
  {
    id: "iterate",
    number: 5,
    title: "Iterate",
    lead: "Almost no first-shot query is right. Tighten noise, fix shape, then promote standing hunts.",
    table: {
      headers: ["Problem", "mPL direction"],
      rows: [
        ["Too noisy", "Add parser= or bundle_id filters; prevalence_scatter for rare IoCs"],
        ["Too narrow", "Loosen filters; double-check field spelling on /mudm"],
        ["Wrong shape", "Switch stats by X ↔ timechart span=1h ↔ head N raw rows"],
        ["Unknown field", "search_fields_in_scope or mudm_list_fields"],
      ],
    },
    bullets: [
      "Use | head 10 while iterating; raise limit when shape looks right",
      "Save reusable hunts — saved_queries_create (macro-style saved queries)",
      "Hand results back to the agent; don’t rewrite by hand if MCP is wired",
    ],
  },
];

export const AGENTS_SEARCH_PROMOTE = {
  lead: "When a hunt consistently surfaces real behaviour, promote it to a scheduled detection.",
  agentPrompt:
    "Take that query and convert it into a mobipwn-dac detection YAML. Severity high, cron every 15 minutes. Save under rules/mobile/.",
  bullets: [
    "Rules editor — paste mPL, severity, cron, lifecycle",
    "mobipwn-dac — rules/**/*.yaml then deploy",
    "MCP — rules_validate_query then rules_create",
    "Validate before enable — POST /v1/rules/validate-query",
  ],
  code: `# rules/mobile/sideload.yaml
name: Sideloaded Android installers
query: |
  platform="android" installer=* !installer="com.android.vending"
  | head 100
severity: high
cron: "*/15 * * * *"`,
};

export const AGENTS_SEARCH_TIPS: MplGuideCallout[] = [
  {
    variant: "tip",
    title: "Tell the agent your field schema",
    body: "Mention non-standard parser names or case source labels in the prompt or root AGENTS.md.",
  },
  {
    variant: "tip",
    title: "Use | head N while iterating",
    body: "Cheap to run and fast to review while shaping a hunt.",
  },
  {
    variant: "tip",
    title: "Save macros",
    body: "Repeated hunts → saved_queries_create (UI: saved queries) so the agent can reuse them.",
  },
  {
    variant: "note",
    title: "Field cardinality",
    body: "stats count by high-cardinality fields can be slow on large cases — prefer scoped source= first.",
  },
];

export const AGENTS_SEARCH_PRACTICE = [
  {
    title: "Packages on a case",
    query: 'source="case-001" parser="Package" | head 20',
  },
  {
    title: "Sideloaded apps",
    query: 'source="case-001" installer=* !installer="com.android.vending" | head 20',
  },
  {
    title: "Network destinations",
    query: 'source="case-001" dest_ip=* | stats count() by dest_ip | head 30',
  },
  {
    title: "Parser timeline",
    query: 'platform="android" last 24h | timechart span=1h count by parser limit=8',
  },
  {
    title: "Cross-case domain IoC",
    query: 'destination_domain=*suspicious* | head 50',
  },
] as const;

export const AGENTS_SEARCH_CALLOUTS: MplGuideCallout[] = [
  {
    variant: "important",
    title: "Mobile context",
    body: "Tell the agent Android bugreport vs iOS sysdiagnose. IronSift endpoint JSONL uses platform=\"endpoint\" — different hunts.",
  },
];

export const AGENTS_SEARCH_NEXT_LINKS = [
  { to: "/search/mpl", labelKey: "mplGuide.link" as const },
  { to: "/search/guide", labelKey: "nav.searchGuide" as const },
  { to: "/guide/agents", labelKey: "nav.agentsGuide" as const },
] as const;

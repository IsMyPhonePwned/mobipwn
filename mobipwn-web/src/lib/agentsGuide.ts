import type { MplGuideCallout, MplGuideTable } from "./mplLanguageGuide";

export type AgentsGuideSection = {
  id: string;
  title: string;
  lead?: string;
  paragraphs?: string[];
  callouts?: MplGuideCallout[];
  list?: string[];
  table?: MplGuideTable;
  links?: { href: string; label: string; external?: boolean }[];
  code?: { title?: string; body: string };
};

export const AGENTS_GUIDE_SECTIONS: AgentsGuideSection[] = [
  {
    id: "intro",
    title: "Agents & LLM workflows",
    lead: "Detection-as-code plus interactive hunting for self-hosted MobiPwn and mobile telemetry.",
    paragraphs: [
      "MobiPwn ships mobipwn-mcp (external LLM), an in-app LLM assistant, mobipwn-dac GitOps, and a REST search API so analysts can author detections and hunt with AI tools.",
    ],
  },
  {
    id: "which",
    title: "Which workflow do I want?",
    table: {
      headers: ["", "Detection-as-code", "Hunt & investigate"],
      rows: [
        ["Job", "Deploy mPL rules & saved queries", "Search, triage, investigate, refine hunts"],
        ["Direction", "Writes to MobiPwn", "Mostly reads; writes cases & rules"],
        ["Surface", "mobipwn-dac CLI + rules/", "mobipwn-mcp + Assistant + Search"],
        ["Who", "Detection engineers", "Mobile threat hunters & analysts"],
      ],
    },
    callouts: [
      {
        variant: "tip",
        body: "When a hunt finds standing behaviour, promote it to a scheduled rule via the Rules editor, mobipwn-dac, or MCP rules_create.",
      },
    ],
  },
  {
    id: "assistant",
    title: "In-app LLM assistant",
    lead: "Settings → LLM assistant — any OpenAI-compatible /chat/completions endpoint (Ollama, LM Studio, OpenAI, Azure, Groq).",
    list: [
      "Local or hosted: Ollama, LM Studio, OpenAI, Azure, Groq — base URL + model (+ API key if required)",
      "Ask in the top-bar Assistant — MobiPwn fetches live data, your LLM summarizes (POST /v1/llm/chat)",
      "External IDE agents: use mobipwn-mcp below (host LLM calls tools; no Settings LLM required)",
    ],
    links: [{ href: "/settings", label: "Configure LLM" }],
  },
  {
    id: "mcp",
    title: "External LLM — mobipwn-mcp",
    lead: "Stdio MCP server for Cursor, Claude Desktop, and Claude Code.",
    code: {
      title: "Build & env",
      body: `cargo build --release -p mobipwn-mcp
export MOBIPWN_API_URL=http://127.0.0.1:3000
export MOBIPWN_API_KEY=mpwn_…   # from Settings → API keys
# Add target/release/mobipwn-mcp to Cursor / Claude MCP config — see docs/MCP.md`,
    },
    list: [
      "Tools: search_run, mudm_list_fields, alerts_*, cases_*, rules_validate_query",
      "Resources: mobipwn://docs/mpl-language, agents-crafting-searches",
      "Prompts: hunt, triage_alert",
      "Host LLM chooses tools — no in-app Assistant required",
    ],
    links: [
      {
        href: "https://github.com/ismyphonepwned/mobipwn/blob/main/docs/MCP.md",
        label: "Full MCP setup (docs/MCP.md)",
        external: true,
      },
    ],
  },
  {
    id: "external",
    title: "REST fallback (no MCP)",
    lead: "Cursor, Claude Code, or any agent that can read repo docs and call the REST API.",
    paragraphs: [
      "Point the agent at docs/MPL_LANGUAGE.md, docs/MCP.md, docs/AGENTS_CRAFTING_SEARCHES.md, and the in-app guides (/search/mpl, /search/guide, /mudm).",
      "Preferred: wire mobipwn-mcp into Cursor or Claude — the host LLM calls search_run, alerts_*, cases_* tools directly.",
    ],
    list: [
      "mobipwn-mcp — stdio MCP (search, triage, rules validate/create)",
      "GET /v1/mudm/fields — searchable field catalog",
      "POST /v1/search/run — execute mPL without MCP",
      "POST /v1/rules/validate-query — check detection queries",
    ],
    links: [{ href: "/guide/agents/search", label: "Crafting searches with an agent" }],
  },
  {
    id: "dac",
    title: "Detection-as-code — mobipwn-dac",
    lead: "Deploy rules/**/*.yaml and queries/**/*.yaml from a Git repo.",
    code: {
      title: "Deploy",
      body: `export MOBIPWN_API_URL=http://127.0.0.1:3000
mobipwn-dac deploy ./my-rules-repo`,
    },
    list: [
      "rules/**/*.yaml — name, query, severity, cron, lifecycle",
      "queries/**/*.yaml — saved hunt queries",
      "Validate in Rules editor before enabling in production",
    ],
    links: [{ href: "/guide/agents/search", label: "Crafting searches with an agent" }],
  },
];

export const AGENTS_GUIDE_LINKS = [
  { to: "/guide/agents/search", label: "Crafting searches" },
  { to: "/search/mpl", label: "mPL reference" },
  { to: "/search/guide", label: "Search guide" },
  { to: "/settings", label: "LLM settings" },
] as const;

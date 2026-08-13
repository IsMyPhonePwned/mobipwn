export type MplGuideGroup = {
  id: string;
  title: string;
  description: string;
};

export type MplGuideCallout = {
  variant: "tip" | "note" | "important";
  title?: string;
  body: string;
};

export type MplGuideTable = {
  headers: string[];
  rows: string[][];
};

export type MplGuideExample = {
  title?: string;
  query: string;
  note?: string;
};

export type MplGuideSection = {
  id: string;
  group: string;
  title: string;
  lead?: string;
  command?: string;
  paragraphs?: string[];
  callouts?: MplGuideCallout[];
  list?: string[];
  table?: MplGuideTable;
  examples?: MplGuideExample[];
};

export const MPL_GUIDE_GROUPS: MplGuideGroup[] = [
  {
    id: "start",
    title: "Getting started",
    description: "How mPL queries are structured and how time windows work.",
  },
  {
    id: "syntax",
    title: "Search syntax",
    description: "Filters, wildcards, and boolean logic before the first pipe.",
  },
  {
    id: "pipes",
    title: "Pipe commands",
    description: "Transform result rows — aggregate, enrich, chart, and shape output.",
  },
  {
    id: "reference",
    title: "Field reference",
    description: "Common MUDM fields and analyst habits that save time.",
  },
];

export const MPL_CHEATSHEET: MplGuideExample[] = [
  { title: "Case hunt", query: 'source="case-001" parser="Package" bundle_id=* | head 100' },
  { title: "Top talkers", query: 'source="case-001" parser="Network" | stats count by dest_ip | head 20' },
  { title: "Timeline", query: 'platform="android" | timechart span=1h count by parser limit=8' },
  { title: "Enrich IPs", query: 'dest_ip=* | lookup vt dest_ip | head 50' },
];

export const MPL_GUIDE_SECTIONS: MplGuideSection[] = [
  {
    id: "overview",
    group: "start",
    title: "What is mPL?",
    lead: "mPL (Mobipwn Pipe Language) is Mobipwn’s search and detection query language — pipe-oriented, readable, and compiled to ClickHouse SQL.",
    paragraphs: [
      "Think of a query in three beats: optionally bound time, filter events with a search clause, then pipe the rows through commands that summarize, enrich, or reshape them.",
      "The same syntax powers the Search page and detection rules. If you can hunt in Search, you can write a rule.",
    ],
    callouts: [
      {
        variant: "tip",
        title: "Start here",
        body: "New to mobile hunts? Copy examples from the Search guide, then come back here when you want to understand the grammar.",
      },
    ],
    examples: [
      {
        title: "Filter and sample",
        query: 'last 24h platform="android" | head 20',
        note: "Wall-clock window + platform filter, capped at 20 rows",
      },
      {
        title: "Aggregate connections",
        query:
          'source="case-001" parser="Network" dest_ip=* | stats count by src_ip, dest_ip | head 50',
      },
      {
        title: "Chart volume over time",
        query: 'platform="android" | timechart span=1h count by parser limit=8',
      },
    ],
  },
  {
    id: "shape",
    group: "start",
    title: "Anatomy of a query",
    lead: "Every mPL query follows the same skeleton. Memorize this and the rest is just vocabulary.",
    table: {
      headers: ["Segment", "Required?", "What it does"],
      rows: [
        ["Time modifier", "Optional", "Bounds wall-clock time (`last 24h`, `now-7d`)"],
        ["Search clause", "Yes (can be `*`)", "Boolean filters on event fields"],
        ["`| command`", "Optional, repeatable", "Transform rows: stats, sort, lookup, chart…"],
      ],
    },
    callouts: [
      {
        variant: "important",
        title: "Always cap exploratory queries",
        body: "End open-ended hunts with `| head N`. Without a limit, broad searches can scan huge partitions.",
      },
    ],
    examples: [
      {
        title: "Full pipeline",
        query:
          'last 7d source="case-001" parser="Process" process_name=* | stats count by process_name | sort -count | head 25',
      },
    ],
  },
  {
    id: "time",
    group: "start",
    title: "Time modifiers",
    lead: "Control which slice of the event stream you see — or let case-scoped hunts use full device time.",
    paragraphs: [
      "Prefix the search bar with `last …` or `now-…`, or set **From / To** on the Search page. The picker wins over inline `last` when both are set.",
      "When you omit a time prefix, Mobipwn applies smart defaults: case hunts (`source=`) and IoC-style field filters often search all event time; broad platform-only queries get a default window (typically 24h).",
    ],
    table: {
      headers: ["Syntax", "Meaning"],
      rows: [
        ["`last 15m`", "Last 15 minutes"],
        ["`last 24h`", "Last 24 hours"],
        ["`last 7d`", "Last 7 days"],
        ["`now-7d`", "Equivalent to last 7 days"],
        ["`@timestamp last 1h`", "Optional prefix (accepted, ignored)"],
      ],
    },
    list: ["Units: `m` / `min`, `h` / `hr`, `d` / `day`, `w` / `week`"],
    callouts: [
      {
        variant: "note",
        body: 'Bugreport investigations: `source="your-case"` usually searches the whole case timeline without a 24h wall clock — ideal for package and network hunts.',
      },
    ],
  },
  {
    id: "search",
    group: "syntax",
    title: "Search expressions",
    lead: "The search clause is plain boolean logic over fields — implicit AND between terms, with explicit AND / OR / NOT when you need grouping.",
    paragraphs: [
      "Compare fields with `=`, `!=`, `>`, `<`, `>=`, `<=`. A bang before the field (`!installer=\"null\"`) is shorthand for not-equal.",
      "Quote values for strings with spaces or special characters. Bare tokens work when unambiguous.",
    ],
    table: {
      headers: ["You write", "It matches"],
      rows: [
        ['platform="android"', "Exact platform"],
        ['bundle_id="com.foo.*"', "Package prefix (glob)"],
        ['message=*error*', "Substring in message"],
        ['bundle_id=*', "Field is present (non-empty)"],
        ['platform IN ("android", "ios")', "Value in list"],
        ['parser NOT IN ("Heartbeat")', "Value not in list"],
        ['*bitchat*', "Wildcard token (searches message)"],
      ],
    },
    list: [
      "Group with parentheses: `(parser=\"Crash\" OR parser=\"Network\") dest_ip=*`",
      "Comments: `// line` and `/* block */`",
    ],
    callouts: [
      {
        variant: "tip",
        body: "Prefer structured fields (`bundle_id`, `process_name`, `dest_ip`) over `message=*…*` — faster, clearer, and easier to pivot on.",
      },
    ],
  },
  {
    id: "where",
    group: "pipes",
    title: "where",
    command: "where",
    lead: "Filter rows after earlier pipe stages — same expression syntax as the initial search clause.",
    examples: [
      {
        query: 'platform="android" | stats count by dest_ip | where dest_ip=* | head 50',
        note: "Often used mid-pipeline; rare in simple hunts",
      },
    ],
  },
  {
    id: "stats",
    group: "pipes",
    title: "stats",
    command: "stats",
    lead: "Roll events up into summaries — counts, distinct values, and numeric aggregates grouped by any field.",
    table: {
      headers: ["Function", "What you get"],
      rows: [
        ["count", "Number of rows in each group"],
        ["dc / distinct_count", "Distinct values of a field"],
        ["values", "Unique values as an array"],
        ["list", "All values as an array (may repeat)"],
        ["sum, avg, min, max", "Numeric aggregate on a field"],
      ],
    },
    paragraphs: ["`by` accepts comma- or space-separated fields. Trailing commas are fine."],
    examples: [
      { title: "Events per parser", query: '| stats count by parser' },
      { title: "Devices per case", query: '| stats dc device_id by source' },
      {
        title: "Packages seen per parser",
        query: '| stats values bundle_id by parser | head 50',
      },
    ],
  },
  {
    id: "head",
    group: "pipes",
    title: "head",
    command: "head",
    lead: "Hard limit on rows returned. Your safety rail on every hunt.",
    examples: [{ query: "| head 100", note: "Keep N most recent rows after prior commands" }],
  },
  {
    id: "sort",
    group: "pipes",
    title: "sort",
    command: "sort",
    lead: "Order rows by a field. Prefix with `-` for descending.",
    examples: [
      { query: "| sort timestamp", note: "Oldest first" },
      { query: "| sort -timestamp", note: "Newest first" },
    ],
  },
  {
    id: "fields",
    group: "pipes",
    title: "fields",
    command: "fields",
    lead: "Project only the columns you care about — great before export or when trimming wide bugreport rows.",
    examples: [
      {
        query: "| fields timestamp, source, bundle_id, parser, message",
      },
      {
        query: '| rename bundle_id AS package | fields package message',
        note: "Combine with rename for readable column names",
      },
    ],
  },
  {
    id: "rename",
    group: "pipes",
    title: "rename",
    command: "rename",
    lead: "Rename a column. `AS` is optional — whitespace alone works.",
    examples: [{ query: "| rename bundle_id AS package" }],
  },
  {
    id: "eval",
    group: "pipes",
    title: "eval",
    command: "eval",
    lead: "Add or overwrite a column with a literal, field reference, `if()`, or simple arithmetic.",
    examples: [
      { query: '| eval risk=if(severity="high",1,0)' },
      { query: '| eval label="reviewed"' },
    ],
  },
  {
    id: "dedup",
    group: "pipes",
    title: "dedup",
    command: "dedup",
    lead: "Keep the first row for each distinct value — deduplicate noisy repeated events.",
    examples: [{ query: "| dedup bundle_id" }],
  },
  {
    id: "rex",
    group: "pipes",
    title: "rex",
    command: "rex",
    lead: "Extract text with a regex capture group into a new column. Default source field is `message`.",
    examples: [
      {
        query: '| rex ip=(\\d+\\.\\d+\\.\\d+\\.\\d+) field=message',
        note: "Capture group 1 becomes column `ip`",
      },
    ],
  },
  {
    id: "lookup",
    group: "pipes",
    title: "lookup",
    command: "lookup",
    lead: "Attach enrichment columns from Marketplace providers — geo, VirusTotal, Play Store metadata.",
    table: {
      headers: ["Form", "Columns added"],
      rows: [
        ["lookup src_ip / dest_ip", "Country and city"],
        ["lookup geo dest_ip", "geo_* country / city"],
        ["lookup vt dest_ip", "VirusTotal stats (vt_*_malicious, …)"],
        ["lookup play bundle_id", "Play Store presence and title"],
      ],
    },
    examples: [
      { query: 'dest_ip=* | lookup vt dest_ip | head 50' },
      { query: 'bundle_id=* | lookup play bundle_id | head 20' },
    ],
    callouts: [
      {
        variant: "note",
        body: "Supported lookup keys: src_ip, dest_ip, file_hash, destination_domain, bundle_id. Configure providers on Marketplace first.",
      },
    ],
  },
  {
    id: "join",
    group: "pipes",
    title: "join",
    command: "join",
    lead: "Combine the current result set with a subquery on a shared key — inner (default) or left join.",
    examples: [
      {
        query: '| join device_id [ platform="ios" | head 100 ]',
        note: "Subquery in square brackets",
      },
      {
        query:
          '| join type=left device_id [ source="case-002" | stats count by device_id ]',
      },
    ],
  },
  {
    id: "timechart",
    group: "pipes",
    title: "timechart",
    command: "timechart",
    lead: "Bucket event counts or numeric metrics over time for the Search timeline. Split series with `by`, cap with `limit`.",
    table: {
      headers: ["Option", "Default", "Role"],
      rows: [
        ["span", "—", "Bucket width: 15m, 1h, 1d…"],
        ["count", "—", "Event count per bucket"],
        ["avg / min / max / sum field", "—", "Numeric metric (e.g. avg raw_level)"],
        ["by", "—", "Field to split series"],
        ["limit", "10", "Top N series; 0 = show all"],
        ["useother", "true", "Roll minor series into Other"],
      ],
    },
    examples: [
      { query: '| timechart span=1h count by parser limit=8' },
      { query: '| timechart span=1h avg raw_level' },
      { query: '| timechart span=1d count by parser limit=5 useother=false' },
    ],
  },
  {
    id: "fields-ref",
    group: "reference",
    title: "Common fields",
    lead: "Events follow the MUDM schema. The Search sidebar and /mudm catalog list every searchable column.",
    table: {
      headers: ["Field", "Analyst use"],
      rows: [
        ["source", "Case / ingest label — scope almost every hunt"],
        ["platform", "android or ios"],
        ["parser", "Normalizer: Package, Process, Network, Crash…"],
        ["timestamp_desc", "SAF activity (e.g. Battery Level) in ext"],
        ["raw_level", "iOS powerlogs battery % — use with timechart avg"],
        ["bundle_id", "Android package name"],
        ["process_name", "Process name or command line"],
        ["src_ip, dest_ip", "Network endpoints"],
        ["destination_domain", "Hostname IoC"],
        ["installer", "Who installed an APK (in ext)"],
        ["data_type", "Fine-grained event subtype"],
        ["message", "Raw text — wildcard-friendly"],
        ["timestamp", "Event time on device"],
        ["device_id", "Pivot across parsers on one phone"],
      ],
    },
    callouts: [
      {
        variant: "tip",
        title: "ext JSON",
        body: "Parser-specific keys land in ext when not promoted to a top-level field. Prefer promoted columns when they exist.",
      },
    ],
  },
  {
    id: "tips",
    group: "reference",
    title: "Habits that help",
    lead: "Small conventions that keep hunts fast and results trustworthy.",
    list: [
      'Open case hunts with source="your-case" — full timeline, no surprise 24h cutoff.',
      "Put | head N on every query while exploring.",
      "stats before head when summarizing — stats shrinks rows first.",
      "Use timechart for volume questions; stats for top-N tables.",
      "Detection rules share mPL — test in Search, then paste into a rule.",
      "Android recipes with copy buttons: Search guide (/search/guide).",
    ],
  },
];

export function sectionsForGroup(groupId: string): MplGuideSection[] {
  return MPL_GUIDE_SECTIONS.filter((s) => s.group === groupId);
}

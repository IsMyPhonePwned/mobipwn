import type { MplGuideCallout } from "./mplLanguageGuide";

export const SEARCH_FIELD_TIPS = [
  { field: "source", use: "Case / ingest label — scope almost every hunt" },
  { field: "platform", use: 'Filter OS: platform="android"' },
  { field: "parser", use: "Normalizer module: Package, Process, Crash, Network…" },
  { field: "bundle_id", use: "Android APK package name" },
  { field: "process_name", use: "Process name or command line" },
  { field: "installer", use: "Who installed the app (stored in ext)" },
  { field: "src_ip / dest_ip", use: "Network socket endpoints" },
  { field: "destination_domain", use: "Hostname IoC (often in ext)" },
  { field: "data_type", use: "Fine-grained event subtype string" },
  { field: "message", use: "Raw text — wildcard-friendly fallback" },
];

/** Featured hunt ids for the quick-start grid (resolved with active case source). */
export const SEARCH_FEATURED_IDS = [
  "pkg-all",
  "inst-sideload",
  "net-ip-pairs",
  "ov-timechart",
] as const;

export const SEARCH_GUIDE_CALLOUTS: MplGuideCallout[] = [
  {
    variant: "tip",
    title: "Case source",
    body: 'Set your case label above — every example with source="…" updates automatically before you copy or run.',
  },
  {
    variant: "note",
    body: "Cross-case examples skip source= and search all ingested data. Add last 90d if you need a wall-clock bound.",
  },
];

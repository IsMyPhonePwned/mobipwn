import { CASE_QUERY_TEMPLATE } from "./caseSource";

/** Token in example queries — UI replaces with the active case source label. */
export const EXAMPLE_CASE = CASE_QUERY_TEMPLATE;

export type SearchExampleCategory = {
  id: string;
  title: string;
  description: string;
};

export type SearchExample = {
  id: string;
  category: string;
  label: string;
  description: string;
  query: string;
  /** Query does not use {{case}} — runs as-is (cross-case hunts). */
  crossCase?: boolean;
};

export const SEARCH_EXAMPLE_CATEGORIES: SearchExampleCategory[] = [
  {
    id: "packages",
    title: "Packages",
    description: "Android APK package ids (`bundle_id`) from the Package parser.",
  },
  {
    id: "installers",
    title: "Installers",
    description: "Who installed an app — Play Store, sideload, enterprise (`installer` in ext).",
  },
  {
    id: "processes",
    title: "Processes",
    description: "Process names and command lines from the Process parser.",
  },
  {
    id: "crashes",
    title: "Crashes & ANRs",
    description: "Tombstones, ANR files, and crash backtrace symbols.",
  },
  {
    id: "network",
    title: "Network",
    description: "Sockets, IP pairs, ports, and domain IoCs.",
  },
  {
    id: "overview",
    title: "Overview & timelines",
    description: "Parser volume, timecharts, and case-level summaries.",
  },
  {
    id: "cross_case",
    title: "Cross-case hunts",
    description: "Search all ingested cases (no source= filter). Add last 90d if needed.",
  },
];

export const SEARCH_EXAMPLES: SearchExample[] = [
  {
    id: "pkg-all",
    category: "packages",
    label: "All package names",
    description: "Distinct Android packages (Package parser rows).",
    query: `source="${EXAMPLE_CASE}" parser="Package" bundle_id=* | stats count by bundle_id | head 100`,
  },
  {
    id: "pkg-one",
    category: "packages",
    label: "One app in a case",
    description: "Events for a single package id — replace com.example.app.",
    query: `source="${EXAMPLE_CASE}" bundle_id="com.example.app" | head 100`,
  },
  {
    id: "pkg-wildcard",
    category: "packages",
    label: "Package name contains",
    description: "Substring match on bundle_id (e.g. hunt for bitchat).",
    query: `source="${EXAMPLE_CASE}" bundle_id=*bitchat* | head 100`,
  },
  {
    id: "pkg-prefix",
    category: "packages",
    label: "Package prefix glob",
    description: "All Google packages via prefix glob.",
    query: `source="${EXAMPLE_CASE}" bundle_id="com.google.*" | head 100`,
  },
  {
    id: "pkg-apk-downgrade",
    category: "packages",
    label: "APK downgrades (battery daily)",
    description:
      "Version decreases from dumpsys batterystats daily updates — forensic downgrade / rollback hunt (MVT #638).",
    query: `source="${EXAMPLE_CASE}" parser="Battery" (data_type=*battery_daily_downgrade* OR action="downgrade") | fields timestamp, bundle_id, action, message, ext | sort -timestamp | head 50`,
  },
  {
    id: "inst-by-pkg",
    category: "installers",
    label: "Installers for one package",
    description: "Count install events by installer for a wildcard package.",
    query: `source="${EXAMPLE_CASE}" bundle_id=*bitchat* parser="Package" installer=* | stats count by installer | head 50`,
  },
  {
    id: "inst-exact",
    category: "installers",
    label: "Installers (exact package)",
    description: "Same hunt with an exact bundle_id.",
    query: `source="${EXAMPLE_CASE}" bundle_id="com.example.bitchat" parser="Package" installer=* | stats count by installer | head 50`,
  },
  {
    id: "inst-events",
    category: "installers",
    label: "Install events only",
    description: "Filter to INSTALL action or event_type.",
    query: `source="${EXAMPLE_CASE}" bundle_id=*bitchat* parser="Package" (action="INSTALL" OR event_type="INSTALL") installer=* | stats count by installer | head 50`,
  },
  {
    id: "inst-raw-rows",
    category: "installers",
    label: "Raw install rows",
    description: "Timestamp, source, bundle_id, installer — sorted newest first.",
    query: `source="${EXAMPLE_CASE}" bundle_id=*bitchat* parser="Package" installer=* | fields timestamp, source, bundle_id, installer, action, message | sort -timestamp | head 100`,
  },
  {
    id: "inst-sideload",
    category: "installers",
    label: "Non–Play Store installs",
    description: "Package metadata outside default installers (sideload hunt).",
    query: `source="${EXAMPLE_CASE}" parser="Package" platform="android" data_type=*package_metadata* installer=* installer NOT IN ("com.android.vending", "com.google.android.packageinstaller", "com.android.packageinstaller", "null") | head 100`,
  },
  {
    id: "inst-exclude",
    category: "installers",
    label: "Exclude Play Store",
    description: "Stats by bundle_id and installer with !installer exclusions.",
    query: `source="${EXAMPLE_CASE}" parser="Package" installer=* !installer="com.android.vending" !installer="com.google.android.packageinstaller" !installer="null" | stats count by bundle_id, installer | head 100`,
  },
  {
    id: "proc-all",
    category: "processes",
    label: "All processes",
    description: "Distinct process commands (Process parser rows).",
    query: `source="${EXAMPLE_CASE}" parser="Process" process_name=* | stats count by process_name | head 100`,
  },
  {
    id: "proc-one",
    category: "processes",
    label: "One process",
    description: "Events for a specific process name.",
    query: `source="${EXAMPLE_CASE}" process_name="com.google.android.gms" | head 50`,
  },
  {
    id: "proc-gms",
    category: "processes",
    label: "GMS process wildcard",
    description: "Process name contains gms.",
    query: `source="${EXAMPLE_CASE}" process_name=*com.google.android.gms* | head 50`,
  },
  {
    id: "crash-tomb",
    category: "crashes",
    label: "Crash / tombstones",
    description: "Native crashes (Crash parser — tombstones).",
    query: `source="${EXAMPLE_CASE}" parser="Crash" data_type="android:bugreport:tombstone" | head 100`,
  },
  {
    id: "crash-anr-file",
    category: "crashes",
    label: "ANR files",
    description: "ANR trace files listed in the bugreport.",
    query: `source="${EXAMPLE_CASE}" parser="Crash" data_type="android:bugreport:anr_file" | head 50`,
  },
  {
    id: "crash-anr-trace",
    category: "crashes",
    label: "ANR traces",
    description: "ANR trace parser rows.",
    query: `source="${EXAMPLE_CASE}" parser="Crash" data_type="android:bugreport:anr_trace" | head 50`,
  },
  {
    id: "crash-top-proc",
    category: "crashes",
    label: "Top crashing processes",
    description: "Count crash events by process name.",
    query: `source="${EXAMPLE_CASE}" parser="Crash" process_name=* | stats count by process_name | head 50`,
  },
  {
    id: "crash-stats-type",
    category: "crashes",
    label: "Crash types overview",
    description: "From examples/mobipwn-queries — count by data_type.",
    query: `source="${EXAMPLE_CASE}" parser="Crash" | stats count by data_type | head 20`,
  },
  {
    id: "crash-symbol",
    category: "crashes",
    label: "Native crash symbol IoC",
    description: "Cross-parser backtrace symbol hunt — replace SomeSymbol.",
    query: `(data_type=*tombstone_backtrace* AND function=*SomeSymbol*) | head 500`,
    crossCase: true,
  },
  {
    id: "net-sockets",
    category: "network",
    label: "Network sockets",
    description: "Socket events with IPs; ports in ext or message.",
    query: `source="${EXAMPLE_CASE}" parser="Network" data_type="android:bugreport:network_socket" | head 200`,
  },
  {
    id: "net-ip-pairs",
    category: "network",
    label: "Top src → dest IP pairs",
    description: "Count events by source and destination IP.",
    query: `source="${EXAMPLE_CASE}" parser="Network" dest_ip=* | stats count by src_ip, dest_ip | head 50`,
  },
  {
    id: "net-ports",
    category: "network",
    label: "IPs with ports",
    description: "Group socket traffic by IP and port fields from ext.",
    query: `source="${EXAMPLE_CASE}" parser="Network" remote_port=* | stats count by src_ip, dest_ip, local_port, remote_port | head 50`,
  },
  {
    id: "net-domain-exact",
    category: "network",
    label: "Domain IoC (exact)",
    description: "Replace evil.com with your IoC.",
    query: `source="${EXAMPLE_CASE}" destination_domain="evil.com" | head 50`,
  },
  {
    id: "net-domain-wild",
    category: "network",
    label: "Domain IoC (wildcard)",
    description: "Substring match on destination_domain.",
    query: `source="${EXAMPLE_CASE}" destination_domain=*evil* | head 50`,
  },
  {
    id: "ov-parsers",
    category: "overview",
    label: "Parsers overview",
    description: "Event volume by parser module for one case.",
    query: `source="${EXAMPLE_CASE}" | stats count by parser | head 30`,
  },
  {
    id: "ov-timechart",
    category: "overview",
    label: "Timeline by parser",
    description: "Stacked hourly timechart for one case.",
    query: `source="${EXAMPLE_CASE}" | timechart span=1h count by parser limit=8`,
  },
  {
    id: "ov-battery-level",
    category: "overview",
    label: "iOS battery level",
    description: "Powerlogs Battery Level average over time (re-ingest for raw_level).",
    query: `source="${EXAMPLE_CASE}" parser="powerlogs" (timestamp_desc="Battery Level" OR message="Battery Level*") | timechart span=1h avg raw_level`,
  },
  {
    id: "ov-android-sources",
    category: "overview",
    label: "Android events by source",
    description: "Last 7 days — which cases have Android data.",
    query: `last 7d platform="android" | stats count by source | head 50`,
    crossCase: true,
  },
  {
    id: "xc-pkg-cases",
    category: "cross_case",
    label: "Package across cases",
    description: "Which cases contain a package IoC.",
    query: `bundle_id=*bitchat* | stats count by source, bundle_id | head 100`,
    crossCase: true,
  },
  {
    id: "xc-timechart",
    category: "cross_case",
    label: "Package timeline per case",
    description: "Daily counts by source — open Timeline tab after run.",
    query: `bundle_id=*bitchat* | timechart span=1d count by source limit=20`,
    crossCase: true,
  },
  {
    id: "xc-first-seen",
    category: "cross_case",
    label: "First install per case",
    description: "Earliest timestamp per source for package install rows.",
    query: `bundle_id=*bitchat* parser="Package" action=*INSTALL* | stats min timestamp by source | head 50`,
    crossCase: true,
  },
  {
    id: "xc-installers",
    category: "cross_case",
    label: "Installers across cases",
    description: "Installer counts grouped by case and installer.",
    query: `bundle_id=*bitchat* parser="Package" installer=* | stats count by source, installer | head 100`,
    crossCase: true,
  },
];

export function resolveExampleQuery(query: string, caseSource: string): string {
  return query.split(CASE_QUERY_TEMPLATE).join(caseSource);
}

export function examplesForCategory(categoryId: string): SearchExample[] {
  return SEARCH_EXAMPLES.filter((e) => e.category === categoryId);
}

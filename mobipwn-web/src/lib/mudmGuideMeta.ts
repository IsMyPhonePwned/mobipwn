import type { MplGuideCallout } from "./mplLanguageGuide";

/** High-value fields for the quick-start grid. */
export const MUDM_FEATURED_FIELDS = [
  "source",
  "bundle_id",
  "process_name",
  "parser",
  "dest_ip",
  "installer",
  "destination_domain",
] as const;

export function mudmExampleQuery(field: string): string {
  switch (field) {
    case "source":
      return 'source="case-001" | head 20';
    case "platform":
      return 'platform="android" | head 20';
    case "parser":
      return 'parser="Package" | head 20';
    case "bundle_id":
      return 'bundle_id=*chrome* | head 20';
    case "process_name":
      return 'process_name=*adbd* | head 20';
    case "src_ip":
    case "dest_ip":
    case "remote_ip":
      return `${field}=* | head 20`;
    case "destination_domain":
      return 'destination_domain=*evil* | head 20';
    case "file_hash":
      return 'file_hash=* | head 20';
    case "installer":
      return 'installer="com.android.vending" | head 20';
    case "severity":
      return 'severity="high" | head 20';
    case "timestamp":
      return "last 24h | head 20";
    default:
      return `${field}=* | head 20`;
  }
}

export const MUDM_INTRO_CALLOUTS: MplGuideCallout[] = [
  {
    variant: "note",
    title: "Mobile event schema",
    body: "MUDM is MobiPwn’s mobile event schema — bundle_id, parser, installer, and other device-forensics fields on top of the ClickHouse event index.",
  },
  {
    variant: "tip",
    body: "Prefer promoted column fields in mPL. Keys only in ext are still searchable by name (e.g. destination_domain, installer).",
  },
];

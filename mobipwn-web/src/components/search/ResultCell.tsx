import { isEnrichmentColumn } from "@/lib/enrichment";

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function severityClass(value: string): string | null {
  const v = value.toLowerCase();
  if (v === "critical") return "results-sev results-sev--critical";
  if (v === "high") return "results-sev results-sev--high";
  if (v === "medium") return "results-sev results-sev--medium";
  if (v === "low") return "results-sev results-sev--low";
  return null;
}

type Props = {
  column: string;
  value: unknown;
  maxLen?: number;
};

export function ResultCell({ column, value, maxLen = 120 }: Props) {
  const full = cellText(value);
  if (!full) return <span className="muted">—</span>;

  const display = full.length > maxLen ? `${full.slice(0, maxLen)}…` : full;
  const col = column.toLowerCase();

  if (col === "severity") {
    const cls = severityClass(full);
    if (cls) return <span className={cls}>{display}</span>;
  }

  if (col === "parser" || col === "platform") {
    return <span className="results-field-badge">{display}</span>;
  }

  if (isEnrichmentColumn(column)) {
    const colLower = column.toLowerCase();
    const n = Number(full);
    const maliciousHit = colLower.endsWith("_malicious") && Number.isFinite(n) && n > 0;
    const threat =
      maliciousHit ||
      colLower.includes("suspicious") ||
      column.includes("malware") ||
      column.startsWith("ioc_");
    return (
      <span
        className={`results-enrich-value${threat ? " results-enrich-value--threat" : ""}`}
      >
        {display}
      </span>
    );
  }

  if (col === "timestamp" || col === "bucket") {
    return <span className="results-ts-value">{display}</span>;
  }

  return <span>{display}</span>;
}

export function resultCellTitle(column: string, value: unknown, maxLen = 120): string | undefined {
  const full = cellText(value);
  return full.length > maxLen ? full : undefined;
}

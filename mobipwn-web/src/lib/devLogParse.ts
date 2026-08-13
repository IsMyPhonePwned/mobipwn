export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

export type ParsedDevLogLine = {
  raw: string;
  lineIndex: number;
  timestamp?: string;
  level?: LogLevel;
  target?: string;
  message: string;
  fields: Record<string, string>;
  isEnrichment: boolean;
  isEnrichmentBanner: boolean;
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const TRACING_RE =
  /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([^:]+):\s+([\s\S]+)$/;

const ENRICHMENT_BANNER_RE = /^\[enrichment\]\s+RUNNING/i;

const FIELD_TAIL_RE = /\s(\w+)=(\S+|\[[^\]]*\])$/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function parseFieldsTail(text: string): { message: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  let rest = text.trim();
  for (;;) {
    const m = rest.match(FIELD_TAIL_RE);
    if (!m) break;
    fields[m[1]] = m[2];
    rest = rest.slice(0, m.index).trimEnd();
  }
  return { message: rest, fields };
}

function isEnrichmentLine(
  target: string | undefined,
  message: string,
  fields: Record<string, string>
): boolean {
  if (ENRICHMENT_BANNER_RE.test(message)) return true;
  if (target?.includes("enrichment")) return true;
  if (fields.slug || fields.kind) return true;
  if (/enrichment sync/i.test(message)) return true;
  return false;
}

export function parseDevLogLine(raw: string, lineIndex: number): ParsedDevLogLine {
  const cleaned = stripAnsi(raw).trim();
  if (!cleaned) {
    return {
      raw,
      lineIndex,
      message: "",
      fields: {},
      isEnrichment: false,
      isEnrichmentBanner: false,
    };
  }

  if (ENRICHMENT_BANNER_RE.test(cleaned)) {
    return {
      raw,
      lineIndex,
      level: "INFO",
      message: cleaned,
      fields: {},
      isEnrichment: true,
      isEnrichmentBanner: true,
    };
  }

  const m = cleaned.match(TRACING_RE);
  if (!m) {
    return {
      raw,
      lineIndex,
      message: cleaned,
      fields: {},
      isEnrichment: /enrichment/i.test(cleaned),
      isEnrichmentBanner: false,
    };
  }

  const [, timestamp, level, target, body] = m;
  const { message, fields } = parseFieldsTail(body);

  return {
    raw,
    lineIndex,
    timestamp,
    level: level as LogLevel,
    target: target.trim(),
    message,
    fields,
    isEnrichment: isEnrichmentLine(target.trim(), message, fields),
    isEnrichmentBanner: false,
  };
}

export function parseDevLogLines(lines: string[]): ParsedDevLogLine[] {
  return lines
    .map((raw, lineIndex) => parseDevLogLine(raw, lineIndex))
    .filter((l) => l.message.length > 0);
}

export function formatLogTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 23);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function shortTarget(target?: string): string {
  if (!target) return "";
  const parts = target.split("::");
  return parts[parts.length - 1] ?? target;
}

export function levelRank(level?: LogLevel): number {
  switch (level) {
    case "ERROR":
      return 4;
    case "WARN":
      return 3;
    case "INFO":
      return 2;
    case "DEBUG":
      return 1;
    case "TRACE":
      return 0;
    default:
      return 0;
  }
}

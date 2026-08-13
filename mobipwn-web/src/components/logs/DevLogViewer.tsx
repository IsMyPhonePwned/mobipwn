import { useMemo, useState } from "react";
import { Pause, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatLogTime,
  levelRank,
  parseDevLogLines,
  shortTarget,
  type LogLevel,
  type ParsedDevLogLine,
} from "@/lib/devLogParse";

type DevLogFile = "api" | "jobs" | "web";

type Props = {
  service: DevLogFile;
  lines: string[];
  onServiceChange: (s: DevLogFile) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (v: boolean) => void;
  onRefresh: () => void;
};

const SERVICES: { id: DevLogFile; label: string; hint: string }[] = [
  { id: "api", label: "API", hint: "HTTP + marketplace sync stream" },
  { id: "jobs", label: "Jobs", hint: "Background enrichments & detections" },
  { id: "web", label: "Web", hint: "Vite dev server" },
];

const LEVELS: (LogLevel | "all")[] = ["all", "ERROR", "WARN", "INFO", "DEBUG"];

function levelClass(level?: LogLevel): string {
  switch (level) {
    case "ERROR":
      return "dev-log-line--error";
    case "WARN":
      return "dev-log-line--warn";
    case "INFO":
      return "dev-log-line--info";
    case "DEBUG":
    case "TRACE":
      return "dev-log-line--debug";
    default:
      return "dev-log-line--plain";
  }
}

function DevLogLineRow({ line }: { line: ParsedDevLogLine }) {
  const [open, setOpen] = useState(false);
  const fieldEntries = Object.entries(line.fields);
  const hasFields = fieldEntries.length > 0;
  const expandable = hasFields || line.raw.length > line.message.length + 40;

  return (
    <div
      className={`dev-log-line ${levelClass(line.level)}${
        line.isEnrichmentBanner ? " dev-log-line--banner" : ""
      }${line.isEnrichment ? " dev-log-line--enrichment" : ""}`}
    >
      <button
        type="button"
        className="dev-log-line__head"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="dev-log-line__time mono">{formatLogTime(line.timestamp)}</span>
        <span className={`dev-log-line__level dev-log-line__level--${(line.level ?? "plain").toLowerCase()}`}>
          {line.level ?? "—"}
        </span>
        {line.target && (
          <span className="dev-log-line__target mono" title={line.target}>
            {shortTarget(line.target)}
          </span>
        )}
        <span className="dev-log-line__message">{line.message}</span>
        {hasFields && (
          <span className="dev-log-line__field-count muted">
            {fieldEntries.length} field{fieldEntries.length === 1 ? "" : "s"}
          </span>
        )}
      </button>
      {(open || line.isEnrichmentBanner) && hasFields && (
        <dl className="dev-log-line__fields">
          {fieldEntries.map(([k, v]) => (
            <div key={k} className="dev-log-line__field">
              <dt>{k}</dt>
              <dd className="mono">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function DevLogViewer({
  service,
  lines,
  onServiceChange,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
}: Props) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [enrichmentOnly, setEnrichmentOnly] = useState(false);

  const parsed = useMemo(() => parseDevLogLines(lines), [lines]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const minRank = level === "all" ? 0 : levelRank(level);
    const matched = parsed.filter((line) => {
      if (enrichmentOnly && !line.isEnrichment) return false;
      if (level !== "all" && levelRank(line.level) < minRank) return false;
      if (!q) return true;
      const hay = [
        line.message,
        line.target,
        line.level,
        ...Object.entries(line.fields).flatMap(([k, v]) => [k, v]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    // Newest first — file tails are chronological ascending.
    return matched.slice().reverse();
  }, [parsed, query, level, enrichmentOnly]);

  const errorCount = useMemo(
    () => parsed.filter((l) => l.level === "ERROR").length,
    [parsed]
  );
  const warnCount = useMemo(
    () => parsed.filter((l) => l.level === "WARN").length,
    [parsed]
  );

  const activeService = SERVICES.find((s) => s.id === service)!;

  return (
    <div className="dev-log-viewer">
      <div className="dev-log-toolbar">
        <div className="dev-log-service-tabs" role="tablist" aria-label="Log service">
          {SERVICES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={service === s.id}
              className={`dev-log-service-tab${service === s.id ? " dev-log-service-tab--active" : ""}`}
              onClick={() => onServiceChange(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="dev-log-service-hint muted">
          {activeService.hint}
          {parsed.length > 0 ? (
            <>
              {" · "}
              <span className="dev-log-summary">
                {errorCount > 0 ? (
                  <span className="dev-log-summary__err">{errorCount} error{errorCount === 1 ? "" : "s"}</span>
                ) : null}
                {errorCount > 0 && warnCount > 0 ? " · " : null}
                {warnCount > 0 ? (
                  <span className="dev-log-summary__warn">{warnCount} warn{warnCount === 1 ? "" : "s"}</span>
                ) : null}
                {errorCount === 0 && warnCount === 0 ? (
                  <span>{parsed.length} lines · newest first</span>
                ) : (
                  <span> · newest first</span>
                )}
              </span>
            </>
          ) : null}
        </p>
      </div>

      <div className="dev-log-controls">
        <label className="dev-log-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            placeholder="Filter by message, target, field…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="dev-log-levels" role="group" aria-label="Log level">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              className={`dev-log-level-chip${level === lv ? " dev-log-level-chip--active" : ""}`}
              onClick={() => setLevel(lv)}
            >
              {lv === "all" ? "All" : lv}
            </button>
          ))}
        </div>
        <label className="dev-log-toggle">
          <input
            type="checkbox"
            checked={enrichmentOnly}
            onChange={(e) => setEnrichmentOnly(e.target.checked)}
          />
          Enrichment only
        </label>
        <div className="dev-log-controls__actions">
          <span className="dev-log-count muted">
            Showing {filtered.length} of {parsed.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="dev-log-refresh-btn"
            onClick={() => onAutoRefreshChange(!autoRefresh)}
            title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
          >
            {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="dev-log-colhead" aria-hidden>
        <span>Time</span>
        <span>Level</span>
        <span>Target</span>
        <span>Message</span>
      </div>

      <ScrollArea className="dev-log-scroll">
        {filtered.length === 0 ? (
          <p className="dev-log-empty muted">
            {parsed.length === 0
              ? "No lines yet — start the stack with ./dev.sh, then refresh."
              : "No lines match the current filters."}
          </p>
        ) : (
          <div className="dev-log-list">
            {filtered.map((line) => (
              <DevLogLineRow key={line.lineIndex} line={line} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  History,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { formatRelativeCompact } from "@/lib/formatRelative";
import {
  formatRuleVersionChangeValue,
  parseRuleVersionChanges,
  ruleVersionHasQueryChange,
  summarizeRuleVersionDiff,
} from "@/lib/ruleVersionSummary";
import { RuleQueryDiff } from "./RuleQueryDiff";
import type { RuleVersion } from "./RuleEditorPanel";

type Props = {
  versions: RuleVersion[];
  currentQuery: string;
  onRestoreQuery: (query: string) => void;
};

function queriesMatch(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

function authorInitials(author: string): string {
  const parts = author.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="rules-version-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Check className="icon" /> : <Copy className="icon" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function RestoreQueryButton({
  query,
  currentQuery,
  onRestoreQuery,
}: {
  query: string;
  currentQuery: string;
  onRestoreQuery: (query: string) => void;
}) {
  if (queriesMatch(query, currentQuery)) return null;
  return (
    <button
      type="button"
      className="rules-version-btn rules-version-btn--primary"
      onClick={() => onRestoreQuery(query)}
    >
      <RotateCcw className="icon" />
      Restore to editor
    </button>
  );
}

function VersionTimelineItem({
  version,
  isLatest,
  expanded,
  currentQuery,
  onToggle,
  onRestoreQuery,
}: {
  version: RuleVersion;
  isLatest: boolean;
  expanded: boolean;
  currentQuery: string;
  onToggle: () => void;
  onRestoreQuery: (query: string) => void;
}) {
  const changes = parseRuleVersionChanges(version.diff);
  const summary = summarizeRuleVersionDiff(version.diff);
  const queryChanged = ruleVersionHasQueryChange(version);
  const nonQueryChanges = changes.filter((c) => c.field !== "query");
  const queryChange = changes.find((c) => c.field === "query");
  const beforeQuery = version.query_before ?? queryChange?.before ?? "";
  const afterQuery = version.query;
  const isInitial = version.version === 1 && changes.length === 0;

  return (
    <li className={`rules-version-timeline__item${expanded ? " rules-version-timeline__item--open" : ""}`}>
      <span className="rules-version-timeline__rail" aria-hidden />
      <button
        type="button"
        className="rules-version-timeline__head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="rules-version-timeline__dot" aria-hidden />
        <span className="rules-version-timeline__head-main">
          <span className="rules-version-timeline__badges">
            <span className="rules-version-badge mono">v{version.version}</span>
            {isLatest && <span className="rules-version-badge rules-version-badge--latest">Latest</span>}
            {isInitial && <span className="rules-version-badge rules-version-badge--initial">Created</span>}
          </span>
          <span className="rules-version-timeline__author">
            <span className="rules-version-avatar" title={version.author}>
              {authorInitials(version.author)}
            </span>
            <span className="rules-version-author">{version.author}</span>
          </span>
          <span className="rules-version-timeline__time muted" title={formatTimestamp(version.created_at)}>
            {formatRelativeCompact(new Date(version.created_at))}
          </span>
          {summary && <span className="rules-version-timeline__summary">{summary}</span>}
        </span>
        <ChevronDown className={`rules-version-timeline__chevron icon${expanded ? " rules-version-timeline__chevron--open" : ""}`} />
      </button>

      {expanded && (
        <div className="rules-version-timeline__body">
          {nonQueryChanges.length > 0 && (
            <dl className="rules-version-changes">
              {nonQueryChanges.map((c) => (
                <div key={c.field} className="rules-version-changes__row">
                  <dt>{c.label}</dt>
                  <dd>
                    <span className="rules-version-changes__value rules-version-changes__value--before mono">
                      {formatRuleVersionChangeValue(c.field, c.before)}
                    </span>
                    <ArrowRight className="icon rules-version-changes__arrow" />
                    <span className="rules-version-changes__value rules-version-changes__value--after mono">
                      {formatRuleVersionChangeValue(c.field, c.after)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {queryChanged && beforeQuery ? (
            <div className="rules-version-query-block">
              <div className="rules-version-query-compare">
                <div className="rules-version-query-pane rules-version-query-pane--before">
                  <div className="rules-version-query-pane__head">
                    <span className="rules-version-query-pane__label">Before</span>
                    <CopyButton text={beforeQuery} label="Copy" />
                  </div>
                  <pre className="rules-version-query-pre mono">{beforeQuery}</pre>
                  <RestoreQueryButton
                    query={beforeQuery}
                    currentQuery={currentQuery}
                    onRestoreQuery={onRestoreQuery}
                  />
                </div>
                <div className="rules-version-query-pane rules-version-query-pane--after">
                  <div className="rules-version-query-pane__head">
                    <span className="rules-version-query-pane__label">After</span>
                    <CopyButton text={afterQuery} label="Copy" />
                  </div>
                  <pre className="rules-version-query-pre mono">{afterQuery}</pre>
                  <RestoreQueryButton
                    query={afterQuery}
                    currentQuery={currentQuery}
                    onRestoreQuery={onRestoreQuery}
                  />
                </div>
              </div>
              <RuleQueryDiff before={beforeQuery} after={afterQuery} />
            </div>
          ) : (
            <div className="rules-version-query-pane rules-version-query-pane--single">
              <div className="rules-version-query-pane__head">
                <span className="rules-version-query-pane__label">Query at this version</span>
                <CopyButton text={afterQuery} label="Copy" />
              </div>
              <pre className="rules-version-query-pre mono">{afterQuery}</pre>
              <RestoreQueryButton
                query={afterQuery}
                currentQuery={currentQuery}
                onRestoreQuery={onRestoreQuery}
              />
            </div>
          )}

          <div className="rules-version-timeline__meta muted">
            Saved {formatTimestamp(version.created_at)}
          </div>
        </div>
      )}
    </li>
  );
}

export function RuleVersionHistory({ versions, currentQuery, onRestoreQuery }: Props) {
  const [filter, setFilter] = useState("");
  const [queryOnly, setQueryOnly] = useState(false);
  const latestVersion = versions[0]?.version ?? null;
  const [expandedVersion, setExpandedVersion] = useState<number | null>(
    () => versions[0]?.version ?? null
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return versions.filter((v) => {
      if (queryOnly && !ruleVersionHasQueryChange(v)) return false;
      if (!q) return true;
      return (
        v.query.toLowerCase().includes(q) ||
        (v.query_before?.toLowerCase().includes(q) ?? false) ||
        v.author.toLowerCase().includes(q) ||
        summarizeRuleVersionDiff(v.diff).toLowerCase().includes(q) ||
        parseRuleVersionChanges(v.diff).some(
          (c) =>
            c.before.toLowerCase().includes(q) ||
            c.after.toLowerCase().includes(q) ||
            c.label.toLowerCase().includes(q)
        )
      );
    });
  }, [filter, queryOnly, versions]);

  if (versions.length === 0) return null;

  const queryChangeCount = versions.filter((v) => ruleVersionHasQueryChange(v)).length;

  return (
    <section className="rules-version-history">
      <div className="rules-version-history__title">
        <History className="icon accent" />
        <span>Saved versions</span>
        <span className="rules-version-history__count">{versions.length}</span>
      </div>

      <div className="rules-version-history__toolbar">
        <label className="rules-version-history__search-wrap">
          <Search className="icon rules-version-history__search-icon" />
          <input
            type="search"
            className="rules-version-history__search mono"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by query, author, or field…"
          />
          {filter && (
            <button
              type="button"
              className="rules-version-history__search-clear"
              onClick={() => setFilter("")}
              aria-label="Clear search"
            >
              <X className="icon" />
            </button>
          )}
        </label>
        {queryChangeCount > 0 && (
          <button
            type="button"
            className={`rules-version-filter-chip${queryOnly ? " rules-version-filter-chip--active" : ""}`}
            onClick={() => setQueryOnly((v) => !v)}
          >
            Query changes
            <span className="rules-version-filter-chip__count">{queryChangeCount}</span>
          </button>
        )}
        <span className="rules-version-history__match muted">
          {visible.length === versions.length
            ? `${versions.length} versions`
            : `${visible.length} of ${versions.length}`}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rules-version-history__empty muted">No versions match this filter.</p>
      ) : (
        <ol className="rules-version-timeline">
          {visible.map((v) => (
            <VersionTimelineItem
              key={v.version}
              version={v}
              isLatest={v.version === latestVersion}
              expanded={expandedVersion === v.version}
              currentQuery={currentQuery}
              onToggle={() =>
                setExpandedVersion((current) => (current === v.version ? null : v.version))
              }
              onRestoreQuery={onRestoreQuery}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, Copy, Info, Lightbulb, Play } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useLocale } from "@/contexts/LocaleContext";
import type { MplGuideCallout, MplGuideExample } from "@/lib/mplLanguageGuide";
import { tokenizeMplQuery } from "@/lib/mplQueryHighlight";

function searchLink(query: string): string {
  return `/search?${new URLSearchParams({ q: query }).toString()}`;
}

export function InlineCode({ children }: { children: string }) {
  const parts = children.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="mpl-guide-inline-code">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

const CALLOUT_ICONS = {
  tip: Lightbulb,
  note: Info,
  important: AlertCircle,
} as const;

export function GuideCallout({ callout }: { callout: MplGuideCallout }) {
  const Icon = CALLOUT_ICONS[callout.variant];
  return (
    <aside className={`mpl-guide-callout mpl-guide-callout--${callout.variant}`}>
      <Icon className="icon mpl-guide-callout__icon" aria-hidden />
      <div>
        {callout.title && <strong className="mpl-guide-callout__title">{callout.title}</strong>}
        <p>
          <InlineCode>{callout.body}</InlineCode>
        </p>
      </div>
    </aside>
  );
}

export function HighlightedQuery({ query }: { query: string }) {
  const tokens = tokenizeMplQuery(query);
  return (
    <code className="mpl-guide-query-highlight mono">
      {tokens.map((t, i) => (
        <span key={`${i}-${t.value}`} className={`mpl-tok mpl-tok--${t.kind}`}>
          {t.value}
        </span>
      ))}
    </code>
  );
}

export function QueryAnatomy() {
  return (
    <div className="mpl-guide-anatomy" aria-label="Query anatomy">
      <div className="mpl-guide-anatomy__segment mpl-guide-anatomy__segment--time">
        <span className="mpl-guide-anatomy__label">Time</span>
        <span className="mono">last 24h</span>
      </div>
      <span className="mpl-guide-anatomy__plus">+</span>
      <div className="mpl-guide-anatomy__segment mpl-guide-anatomy__segment--search">
        <span className="mpl-guide-anatomy__label">Search</span>
        <span className="mono">platform=&quot;android&quot;</span>
      </div>
      <span className="mpl-guide-anatomy__plus">+</span>
      <div className="mpl-guide-anatomy__segment mpl-guide-anatomy__segment--pipe">
        <span className="mpl-guide-anatomy__label">Pipes</span>
        <span className="mono">| stats count by parser | head 20</span>
      </div>
    </div>
  );
}

export function GuideExampleCard({
  query,
  title,
  note,
  compact,
  tryHref,
  badge,
}: MplGuideExample & { compact?: boolean; tryHref?: string; badge?: string }) {
  const { log } = useActivityLog();
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(query);
      setCopied(true);
      log("info", "Copied mPL example", query.slice(0, 120));
    } catch {
      log("warn", "Copy failed");
    }
  }, [log, query]);

  return (
    <figure className={`mpl-guide-example${compact ? " mpl-guide-example--compact" : ""}`}>
      {(title || note || badge) && (
        <figcaption className="mpl-guide-example__caption">
          {title && <strong>{title}</strong>}
          {badge && <span className="search-guide-badge">{badge}</span>}
          {note && <span className="muted">{note}</span>}
        </figcaption>
      )}
      <div className="mpl-guide-example__body">
        <HighlightedQuery query={query} />
        <div className="mpl-guide-example__actions">
          <button
            type="button"
            className={`btn btn-sm ${copied ? "btn-primary" : "btn-secondary"}`}
            onClick={() => void copy()}
          >
            {copied ? <Check className="icon" /> : <Copy className="icon" />}
            {copied ? t("common.copied") : t("common.copy")}
          </button>
          <Link to={tryHref ?? searchLink(query)} className="btn btn-ghost btn-sm">
            <Play className="icon" />
            {t("common.tryInSearch")}
          </Link>
        </div>
      </div>
    </figure>
  );
}

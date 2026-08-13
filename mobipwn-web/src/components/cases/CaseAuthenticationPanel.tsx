import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Fingerprint, KeyRound, Loader2, ShieldCheck, ShieldX, User } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { LockUnlockTimelineChart } from "@/components/cases/LockUnlockTimelineChart";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_AUTHENTICATION_PANEL_ID } from "@/lib/caseDashboard";
import {
  authEventsSorted,
  authEventsToTimelinePoints,
  authSearchQuery,
  authTypeLabel,
  summarizeAuthRows,
} from "@/lib/authenticationEvents";
import { buildLockUnlockPreciseTimeline } from "@/lib/lockUnlockTimeline";

function authenticationQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="Authentication" | fields timestamp, datetime, user, action, message, ext | sort -timestamp | head 200`;
}

function AuthTypeIcon({ authType }: { authType: string }) {
  if (authType.includes("finger") || authType.includes("bio") || authType.includes("face")) {
    return <Fingerprint size={13} aria-hidden />;
  }
  return <KeyRound size={13} aria-hidden />;
}

export function CaseAuthenticationPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_AUTHENTICATION_PANEL_ID,
      title: "Authentication",
      query: authenticationQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_AUTHENTICATION_PANEL_ID, x: 0, y: 0, w: 12, h: 12, minW: 6, minH: 8 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const summary = useMemo(() => summarizeAuthRows(rows), [rows]);
  const events = useMemo(() => authEventsSorted(rows, 80), [rows]);
  const timeline = useMemo(
    () => buildLockUnlockPreciseTimeline(authEventsToTimelinePoints(events)),
    [events]
  );

  if (loading && rows.length === 0) {
    return (
      <div className="case-auth-panel case-auth-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-auth-panel case-auth-panel--error muted text-xs">{error}</p>;
  }

  if (!rows.length) {
    return (
      <p className="case-auth-panel case-auth-panel--empty muted text-xs">
        No unlock or authentication events in SYSTEM LOG sections for this bugreport.
      </p>
    );
  }

  return (
    <div className="case-auth-panel">
      <div className="case-auth-panel__summary">
        <span className="case-auth-stat">
          <User size={13} aria-hidden />
          {summary.users} user{summary.users === 1 ? "" : "s"}
        </span>
        {summary.success > 0 && (
          <span className="case-auth-stat case-auth-stat--success">
            <ShieldCheck size={13} aria-hidden />
            {summary.success} ok
          </span>
        )}
        {summary.failed > 0 && (
          <span className="case-auth-stat case-auth-stat--failed">
            <ShieldX size={13} aria-hidden />
            {summary.failed} failed
          </span>
        )}
        {summary.topTypes.map(({ type, count }) => (
          <span key={type} className="case-auth-stat muted">
            {authTypeLabel(type)} ×{count}
          </span>
        ))}
      </div>

      <LockUnlockTimelineChart timeline={timeline} title="Unlock timeline" />

      <ul className="case-auth-events case-auth-panel__scroll">
        {events.map((event, i) => (
          <li
            key={`auth-${i}`}
            className={`case-auth-event${event.success ? "" : " case-auth-event--failed"}`}
          >
            <div className="case-auth-event__head">
              <span className={`case-auth-event__status case-auth-event__status--${event.success ? "ok" : "fail"}`}>
                {event.success ? "OK" : "FAIL"}
              </span>
              <span className="case-auth-event__type">
                <AuthTypeIcon authType={event.authType} />
                {authTypeLabel(event.authType)}
              </span>
              {(event.date || event.timestampRaw) && (
                <time
                  className="case-auth-event__time mono text-xs"
                  dateTime={event.timestampRaw || undefined}
                >
                  {event.date ? (
                    <>
                      <span className="case-auth-event__date">{event.date}</span>
                      {event.time ? <span className="case-auth-event__clock">{event.time}</span> : null}
                    </>
                  ) : (
                    <span className="case-auth-event__date">{event.timestampRaw}</span>
                  )}
                </time>
              )}
            </div>
            <div className="case-auth-event__meta muted text-xs">
              {event.timestampRaw && (
                <span className="case-auth-event__ts mono" title="Timestamp">
                  ts {event.timestampRaw.replace("T", " ").replace(/\.\d+Z$/, "Z")}
                </span>
              )}
              <span>User {event.user}</span>
              {event.source && <span>{event.source}</span>}
              {event.wakeReason && event.wakeReason !== event.authType && (
                <span>{event.wakeReason}</span>
              )}
            </div>
            {event.message && (
              <p className="case-auth-event__message text-xs">{event.message}</p>
            )}
            <Link
              to={buildSearchHref(authSearchQuery(event, scope))}
              className="case-auth-event__link text-xs"
            >
              Hunt similar →
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to={buildSearchHref(`${scope} parser="Authentication" | sort -timestamp | head 50`)}
        className="case-auth-panel__link text-xs"
      >
        Search all authentication events →
      </Link>
    </div>
  );
}

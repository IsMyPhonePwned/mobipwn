import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, LockOpen, Loader2, Timer } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_LOCK_STATE_PANEL_ID } from "@/lib/caseDashboard";
import {
  iosLockEventsFromRows,
  iosLockStateQuery,
  iosLockStateSearchQuery,
  summarizeIosLockEvents,
  type IosLockEvent,
} from "@/lib/iosLockState";
import { LockUnlockTimelineChart } from "@/components/cases/LockUnlockTimelineChart";
import {
  buildLockUnlockPreciseTimeline,
  type LockUnlockTimelinePoint,
} from "@/lib/lockUnlockTimeline";

function LockKindIcon({ kind }: { kind: IosLockEvent["kind"] }) {
  if (kind === "unlocked") return <LockOpen size={13} aria-hidden />;
  if (kind === "autolock") return <Timer size={13} aria-hidden />;
  if (kind === "failed") return <Lock size={13} aria-hidden />;
  return <Lock size={13} aria-hidden />;
}

export function CaseIosLockStatePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const [filter, setFilter] = useState("");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_LOCK_STATE_PANEL_ID,
      title: "Lock / unlock",
      query: iosLockStateQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_IOS_LOCK_STATE_PANEL_ID, x: 0, y: 0, w: 12, h: 16, minW: 6, minH: 8 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const events = useMemo(() => iosLockEventsFromRows(rows), [rows]);
  const summary = useMemo(() => summarizeIosLockEvents(events), [events]);
  const timeline = useMemo(() => {
    const points: LockUnlockTimelinePoint[] = [];
    for (const ev of events) {
      if (ev.timestampMs == null || ev.timestampMs <= 0) continue;
      if (ev.kind === "unlocked" || ev.kind === "locked" || ev.kind === "autolock" || ev.kind === "failed") {
        points.push({ t: ev.timestampMs, kind: ev.kind });
      }
    }
    return buildLockUnlockPreciseTimeline(points);
  }, [events]);
  const visible = useMemo(
    () =>
      events.filter((ev) =>
        panelSearchMatch(
          filter,
          ev.when,
          ev.whenDate,
          ev.whenTime,
          ev.whenRaw,
          ev.detail,
          ev.status,
          ev.source,
          ev.kind,
          ev.message,
          ev.parser,
          ev.activity,
          ev.apolloModule,
          ev.sourceDb,
          ...ev.extras.flatMap((e) => [e.label, e.value])
        )
      ),
    [events, filter]
  );
  const src = escapeMplString(ingestSource);

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-lock case-ios-lock--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-lock case-ios-lock--error muted text-xs">{error}</p>;
  }

  if (!events.length) {
    return (
      <p className="case-ios-lock case-ios-lock--empty muted text-xs">
        No lock/unlock or authentication events in this sysdiagnose.
        Failed Face ID / passcode attempts need unified-log decode
        (<code className="mono">./dev.sh --logarchive-decode</code>) then re-ingest.
      </p>
    );
  }

  return (
    <div className="case-ios-lock">
      <header className="case-ios-lock__hero">
        <LockOpen size={18} aria-hidden />
        <div>
          <span className="case-ios-lock__hero-title">
            {summary.lastUnlocked
              ? `Last unlocked ${summary.lastUnlocked}`
              : `${summary.unlocked + summary.locked} lock-state events`}
          </span>
          <span className="case-ios-lock__hero-meta muted text-xs">
            {summary.lastLocked ? `Last locked ${summary.lastLocked}` : "No lock transitions yet"}
            {summary.unlocked > 0 ? ` · ${summary.unlocked} unlocks` : ""}
            {summary.locked > 0 ? ` · ${summary.locked} locks` : ""}
            {summary.failed > 0 ? ` · ${summary.failed} failed` : ""}
          </span>
        </div>
      </header>

      <div className="case-ios-lock__summary">
        {summary.unlocked > 0 && (
          <span className="case-ios-lock-stat case-ios-lock-stat--unlocked">
            <LockOpen size={13} aria-hidden />
            {summary.unlocked} unlock{summary.unlocked === 1 ? "" : "s"}
          </span>
        )}
        {summary.locked > 0 && (
          <span className="case-ios-lock-stat case-ios-lock-stat--locked">
            <Lock size={13} aria-hidden />
            {summary.locked} lock{summary.locked === 1 ? "" : "s"}
          </span>
        )}
        {summary.autolock > 0 && (
          <span className="case-ios-lock-stat muted">
            <Timer size={13} aria-hidden />
            {summary.autolock} auto-lock
          </span>
        )}
        {summary.failed > 0 && (
          <span className="case-ios-lock-stat case-ios-lock-stat--failed">
            <Lock size={13} aria-hidden />
            {summary.failed} failed
          </span>
        )}
      </div>

      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter unlock / lock time, status, DB, or message…"
      />

      <LockUnlockTimelineChart timeline={timeline} title="Lock / unlock timeline" />

      <ul className="case-ios-lock__list">
        {visible.slice(0, 80).map((ev, i) => (
          <li
            key={`${ev.whenRaw}-${ev.kind}-${ev.status}-${i}`}
            className={`case-ios-lock__item case-ios-lock__item--${ev.kind}`}
          >
            <span className="case-ios-lock__icon">
              <LockKindIcon kind={ev.kind} />
            </span>
            <div className="case-ios-lock__body">
              <div className="case-ios-lock__row-head">
                <strong className="case-ios-lock__detail">{ev.detail}</strong>
                {(ev.whenDate || ev.whenRaw) && (
                  <time className="case-ios-lock__when mono" dateTime={ev.whenRaw || undefined}>
                    {ev.whenDate ? (
                      <>
                        <span className="case-ios-lock__date">{ev.whenDate}</span>
                        {ev.whenTime ? <span className="case-ios-lock__time">{ev.whenTime}</span> : null}
                      </>
                    ) : (
                      <span className="case-ios-lock__date">{ev.whenRaw}</span>
                    )}
                  </time>
                )}
              </div>

              <div className="case-ios-lock__chips">
                {ev.whenRaw && (
                  <span className="case-ios-lock-chip case-ios-lock-chip--ts mono" title="Timestamp">
                    ts {ev.whenRaw.replace("T", " ").replace(/\.\d+Z$/, "Z")}
                  </span>
                )}
                <span className="case-ios-lock-chip">{ev.source}</span>
                {ev.activity && ev.activity !== ev.detail && (
                  <span className="case-ios-lock-chip muted">{ev.activity}</span>
                )}
                {ev.status && ev.status !== ev.detail && (
                  <span className="case-ios-lock-chip mono">{ev.status}</span>
                )}
                {ev.parser && <span className="case-ios-lock-chip muted">{ev.parser}</span>}
                {ev.extras.map((extra) => (
                  <span
                    key={`${extra.label}-${extra.value}`}
                    className="case-ios-lock-chip"
                    title={`${extra.label}: ${extra.value}`}
                  >
                    <span className="case-ios-lock-chip__k">{extra.label}</span> {extra.value}
                  </span>
                ))}
              </div>

              {ev.message && (
                <p className="case-ios-lock__message muted text-xs mono" title={ev.message}>
                  {ev.message}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {visible.length > 80 && (
        <p className="muted text-xs">+{visible.length - 80} more (use search)</p>
      )}

      <p className="case-ios-lock__footer muted text-xs">
        <Link to={buildSearchHref(iosLockStateSearchQuery(src), { run: true })}>
          Search lock / unlock events
        </Link>
      </p>
    </div>
  );
}

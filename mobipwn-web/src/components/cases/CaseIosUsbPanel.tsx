import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cable, Loader2, PlugZap, Usb } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_USB_PANEL_ID } from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { formatWallTimestamp } from "@/lib/formatRelative";
import {
  formatUsbDuration,
  iosUsbDevicesQuery,
  iosUsbLockdownQuery,
  iosUsbPowerQuery,
  iosUsbViewFromRows,
  type IosUsbCableSession,
  type IosUsbDevice,
  type IosUsbLockdownEvent,
  type IosUsbLockdownKind,
  type IosUsbView,
} from "@/lib/iosUsbPanel";

type KindFilter = "all" | IosUsbLockdownKind;

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "attach", label: "Attach" },
  { id: "detach", label: "Detach" },
  { id: "pair", label: "Pair" },
  { id: "trust", label: "Trust" },
  { id: "usbmux", label: "usbmux" },
  { id: "other", label: "Other" },
];

const SESSION_PAGE = 12;

function cableStateLabel(connected: boolean | null): string {
  if (connected === true) return "Cable connected";
  if (connected === false) return "Cable disconnected";
  return "Cable state unknown";
}

function formatUsbWhen(when: string): string {
  const raw = when.trim();
  if (!raw || raw === "—" || /^still connected$/i.test(raw)) return raw || "—";
  if (/[A-Za-z]{3}/.test(raw) && /\d{4}/.test(raw)) return raw;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return formatWallTimestamp(raw);
  return raw;
}

function DeviceRow({ device }: { device: IosUsbDevice }) {
  return (
    <tr>
      <td className="case-ios-usb__td-product">
        <strong>{device.product}</strong>
        {device.vendor ? <span className="muted text-xs">{device.vendor}</span> : null}
      </td>
      <td className="mono text-xs">
        {[device.idVendor, device.idProduct].filter(Boolean).join(" / ") || "—"}
      </td>
      <td className="mono text-xs" title={device.serial}>
        {device.serial || "—"}
      </td>
      <td className="mono text-xs muted">{device.port || "—"}</td>
      <td className="mono text-xs muted" title={device.usbClass || device.nodeName}>
        {device.usbClass || device.nodeName || "—"}
      </td>
      <td className="mono text-xs case-ios-usb__td-when">
        <time dateTime={device.when || undefined}>{formatUsbWhen(device.when)}</time>
      </td>
    </tr>
  );
}

function LockdownRow({ event }: { event: IosUsbLockdownEvent }) {
  return (
    <li className="case-ios-usb__lock-item">
      <span className={`case-ios-usb__kind case-ios-usb__kind--${event.kind}`}>{event.kind}</span>
      <div className="case-ios-usb__lock-body">
        <span className="case-ios-usb__lock-title" title={event.message}>
          {event.title}
        </span>
        {event.host && event.host !== event.title ? (
          <span className="case-ios-usb__lock-host mono text-xs muted">host {event.host}</span>
        ) : null}
      </div>
      <time className="case-ios-usb__when muted text-xs mono" dateTime={event.when || undefined}>
        {formatUsbWhen(event.when)}
      </time>
    </li>
  );
}

function SessionRow({ session }: { session: IosUsbCableSession }) {
  const open = session.endMs == null;
  return (
    <li className={`case-ios-usb__session${open ? " case-ios-usb__session--open" : ""}`}>
      <span className={`case-ios-usb__power-flag case-ios-usb__power-flag--on`}>
        {open ? "on" : "sess"}
      </span>
      <div className="case-ios-usb__session-body">
        <span className="case-ios-usb__session-range mono text-xs">
          <time dateTime={session.startWhen}>{formatUsbWhen(session.startWhen)}</time>
          {" → "}
          {open ? (
            <span>still connected</span>
          ) : (
            <time dateTime={session.endWhen}>{formatUsbWhen(session.endWhen)}</time>
          )}
        </span>
        <span className="case-ios-usb__session-meta muted text-xs">
          {formatUsbDuration(session.durationMs)}
          {session.chargingSeen ? " · charging" : ""}
        </span>
      </div>
      <time
        className="case-ios-usb__when muted text-xs mono"
        dateTime={session.startWhen || undefined}
        title={
          open
            ? `${formatUsbWhen(session.startWhen)} → still connected`
            : `${formatUsbWhen(session.startWhen)} → ${formatUsbWhen(session.endWhen)}`
        }
      >
        {formatUsbWhen(session.startWhen)}
      </time>
    </li>
  );
}

function CableTimeline({ view }: { view: IosUsbView }) {
  const start = view.timelineStartMs;
  const end = view.timelineEndMs;
  if (start == null || end == null || end <= start || !view.sessions.length) return null;
  const span = end - start;

  return (
    <div className="case-ios-usb__timeline" aria-hidden>
      <div className="case-ios-usb__timeline-track">
        {view.sessions.map((s, i) => {
          const left = ((s.startMs - start) / span) * 100;
          const rightEdge = (s.endMs ?? end) - start;
          const width = Math.max(rightEdge / span * 100 - left, 0.8);
          return (
            <span
              key={`${s.startMs}-${i}`}
              className={`case-ios-usb__timeline-seg${s.chargingSeen ? " is-charging" : ""}${
                s.endMs == null ? " is-open" : ""
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${s.startWhen} → ${s.endWhen} (${formatUsbDuration(s.durationMs)})`}
            />
          );
        })}
      </div>
      <div className="case-ios-usb__timeline-labels muted text-xs mono">
        <span>{formatUsbWhen(view.sessions[view.sessions.length - 1]?.startWhen || "")}</span>
        <span>{formatUsbWhen(view.lastExternalWhen || "")}</span>
      </div>
    </div>
  );
}

export function CaseIosUsbPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [sessionLimit, setSessionLimit] = useState(SESSION_PAGE);

  const devicesPanel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_USB_PANEL_ID,
      title: "USB",
      query: iosUsbDevicesQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_IOS_USB_PANEL_ID, x: 0, y: 0, w: 12, h: 10, minW: 6, minH: 6 },
    }),
    [ingestSource]
  );
  const lockdownPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_USB_PANEL_ID}_lockdown`,
      title: "USB lockdown",
      query: iosUsbLockdownQuery(ingestSource),
      viz: "table",
      layout: { i: `${CASE_IOS_USB_PANEL_ID}_lockdown`, x: 0, y: 0, w: 12, h: 4, minW: 4, minH: 3 },
    }),
    [ingestSource]
  );
  const powerPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_USB_PANEL_ID}_power`,
      title: "USB power",
      query: iosUsbPowerQuery(ingestSource),
      viz: "table",
      layout: { i: `${CASE_IOS_USB_PANEL_ID}_power`, x: 0, y: 0, w: 12, h: 4, minW: 4, minH: 3 },
    }),
    [ingestSource]
  );

  const devices = useDashboardPanel(devicesPanel, "24h", refreshKey, true);
  const lockdown = useDashboardPanel(lockdownPanel, "24h", refreshKey, true);
  const power = useDashboardPanel(powerPanel, "24h", refreshKey, true);

  const view = useMemo(
    () => iosUsbViewFromRows(devices.rows, lockdown.rows, power.rows),
    [devices.rows, lockdown.rows, power.rows]
  );

  const visibleLockdown = useMemo(() => {
    if (!view) return [];
    return view.lockdown.filter((e) => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      return panelSearchMatch(filter, e.title, e.host, e.message, e.kind, e.when);
    });
  }, [view, filter, kindFilter]);

  const loading =
    devices.loading &&
    devices.rows.length === 0 &&
    lockdown.loading &&
    lockdown.rows.length === 0 &&
    power.loading &&
    power.rows.length === 0;

  if (loading) {
    return (
      <div className="case-ios-usb case-ios-usb--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (!view && (devices.error || lockdown.error || power.error)) {
    return (
      <p className="case-ios-usb case-ios-usb--error muted text-xs">
        {devices.error || lockdown.error || power.error}
      </p>
    );
  }

  if (!view) {
    return (
      <p className="case-ios-usb case-ios-usb--empty muted text-xs">
        No IOUSB plane, lockdownd USB, or battery external-power traces in this sysdiagnose yet.
        Re-ingest after the iousb flatten update to populate IOUSB device nodes.
      </p>
    );
  }

  const attachCount = view.lockdownKindCounts.attach ?? 0;
  const pairCount = view.lockdownKindCounts.pair ?? 0;
  const hasCable = view.sessions.length > 0 || view.power.length > 0;
  const hasLockdown = view.lockdown.length > 0;
  const sessionRows = view.sessions.slice(0, sessionLimit);

  return (
    <div className="case-ios-usb">
      <header className="case-ios-usb__hero">
        <Cable size={18} aria-hidden />
        <div className="case-ios-usb__hero-main">
          <span className="case-ios-usb__hero-title">{cableStateLabel(view.lastExternalConnected)}</span>
          <span className="case-ios-usb__hero-meta muted text-xs">
            {view.lastExternalWhen
              ? `Last sample ${formatUsbWhen(view.lastExternalWhen)}`
              : "From battery OBC + lockdownd USB"}
            {view.pairHosts.length ? ` · hosts ${view.pairHosts.join(", ")}` : ""}
          </span>
        </div>
        <dl className="case-ios-usb__stats" aria-label="USB summary">
          <div className="case-ios-usb__stat">
            <dt>Nodes</dt>
            <dd className="mono">{view.devices.length}</dd>
          </div>
          <div className="case-ios-usb__stat">
            <dt>Sessions</dt>
            <dd className="mono">{view.sessions.length}</dd>
          </div>
          <div className="case-ios-usb__stat">
            <dt>Attaches</dt>
            <dd className="mono">{attachCount}</dd>
          </div>
          <div className="case-ios-usb__stat">
            <dt>Pairs</dt>
            <dd className="mono">{pairCount}</dd>
          </div>
        </dl>
      </header>

      {!view.devices.length ? (
        <p className="case-ios-usb__hint-inline muted text-xs">
          No IOUSB device nodes yet
          {view.deviceCount > 0 ? ` (summary ${view.deviceCount})` : ""} — re-ingest to expand{" "}
          <code className="mono">ioreg/IOUSB.txt</code>. Cable/pairing below still work.
        </p>
      ) : null}

      <div
        className={`case-ios-usb__body${hasCable && hasLockdown ? " case-ios-usb__body--split" : ""}`}
      >
        {hasCable ? (
          <section className="case-ios-usb__section case-ios-usb__section--cable">
            <h4 className="case-ios-usb__section-title">
              <PlugZap size={14} aria-hidden /> Cable / external power
              <span className="muted text-xs">
                {view.sessions.length
                  ? `${view.sessions.length} session${view.sessions.length === 1 ? "" : "s"}`
                  : `${view.power.length} transitions`}
              </span>
            </h4>
            <CableTimeline view={view} />
            {view.sessions.length > 0 ? (
              <>
                <ul className="case-ios-usb__sessions">
                  <li className="case-ios-usb__lock-head case-ios-usb__session-head" aria-hidden>
                    <span>State</span>
                    <span>Session</span>
                    <span>Timestamp</span>
                  </li>
                  {sessionRows.map((s, i) => (
                    <SessionRow key={`${s.startMs}-${i}`} session={s} />
                  ))}
                </ul>
                {view.sessions.length > sessionRows.length ? (
                  <button
                    type="button"
                    className="case-ios-usb__more"
                    onClick={() =>
                      setSessionLimit((n) => Math.min(n + SESSION_PAGE, view.sessions.length))
                    }
                  >
                    Show more sessions ({sessionRows.length} / {view.sessions.length})
                  </button>
                ) : null}
              </>
            ) : (
              <ul className="case-ios-usb__power">
                {view.power.map((p, i) => (
                  <li key={`${p.when}-${i}`} className="case-ios-usb__power-item">
                    <span
                      className={`case-ios-usb__power-flag case-ios-usb__power-flag--${
                        p.externalConnected === true
                          ? "on"
                          : p.externalConnected === false
                            ? "off"
                            : "unk"
                      }`}
                    >
                      {p.externalConnected === true
                        ? "connected"
                        : p.externalConnected === false
                          ? "disconnected"
                          : "—"}
                      {p.charging === true ? " · charging" : ""}
                      {p.soc ? ` · ${p.soc}%` : ""}
                    </span>
                    <time
                      className="case-ios-usb__when muted text-xs mono"
                      dateTime={p.when || undefined}
                    >
                      {formatUsbWhen(p.when)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {hasLockdown ? (
          <section className="case-ios-usb__section case-ios-usb__section--lock">
            <h4 className="case-ios-usb__section-title">
              lockdownd USB / pairing
              <span className="muted text-xs">{view.lockdown.length}</span>
            </h4>
            <CasePanelSearchBar
              value={filter}
              onChange={setFilter}
              placeholder="Filter host, pair label…"
            />
            <div className="case-ios-usb__chips" role="group" aria-label="Lockdown kind filter">
              {KIND_FILTERS.map((k) => {
                const count =
                  k.id === "all" ? view.lockdown.length : (view.lockdownKindCounts[k.id] ?? 0);
                if (k.id !== "all" && count === 0) return null;
                return (
                  <button
                    key={k.id}
                    type="button"
                    className={`case-ios-usb__chip${kindFilter === k.id ? " is-active" : ""}`}
                    onClick={() => setKindFilter(k.id)}
                  >
                    {k.label} ({count})
                  </button>
                );
              })}
            </div>
            {visibleLockdown.length === 0 ? (
              <p className="muted text-xs">No lockdown events match the filter.</p>
            ) : (
              <ul className="case-ios-usb__lock">
                <li className="case-ios-usb__lock-head" aria-hidden>
                  <span>Kind</span>
                  <span>Event</span>
                  <span>Timestamp</span>
                </li>
                {visibleLockdown.map((e, i) => (
                  <LockdownRow key={`${e.when}-${e.kind}-${i}`} event={e} />
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {view.devices.length > 0 ? (
        <section className="case-ios-usb__section case-ios-usb__section--devices">
          <h4 className="case-ios-usb__section-title">
            <Usb size={14} aria-hidden /> IOUSB plane
            <span className="muted text-xs">{view.devices.length}</span>
          </h4>
          <div className="case-ios-usb__table-wrap">
            <table className="case-ios-usb__table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>VID / PID</th>
                  <th>Serial</th>
                  <th>Port</th>
                  <th>Class</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {view.devices.map((d, i) => (
                  <DeviceRow key={`${d.product}-${d.idProduct}-${i}`} device={d} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="case-ios-usb__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="iousb" | head 100`)}>Search iousb</Link>
        {" · "}
        <Link
          to={buildSearchHref(
            `source="${src}" parser="lockdownd" message="*USB*" | sort -timestamp | head 80`
          )}
        >
          Hunt USB attach
        </Link>
        {" · "}
        <Link
          to={buildSearchHref(`source="${src}" parser="battery_bdc" | sort -timestamp | head 80`)}
        >
          Battery external power
        </Link>
      </p>
    </div>
  );
}

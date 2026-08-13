import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Cable, Loader2, Usb } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_ANDROID_USB_PANEL_ID } from "@/lib/caseDashboard";
import {
  androidUsbActionLabel,
  androidUsbDevicesQuery,
  androidUsbViewFromRows,
  type AndroidUsbDevice,
  type AndroidUsbPort,
} from "@/lib/androidUsbDevices";

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="case-ausb-detail__row">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}

function actionClass(action: string): string {
  const a = action.trim().toLowerCase();
  if (a === "add" || a === "bind") return "case-ausb-action case-ausb-action--on";
  if (a === "remove" || a === "unbind") return "case-ausb-action case-ausb-action--off";
  if (a) return "case-ausb-action";
  return "case-ausb-action case-ausb-action--unknown";
}

function DeviceCard({ device }: { device: AndroidUsbDevice }) {
  const title =
    device.productName ||
    ([device.vid, device.pid].filter(Boolean).join(":") || device.driver || "USB device");
  return (
    <li className="case-ausb-device">
      <div className="case-ausb-device__icon" aria-hidden>
        <Usb size={14} />
      </div>
      <div className="case-ausb-device__body">
        <div className="case-ausb-device__head">
          <strong className="case-ausb-device__name">{title}</strong>
          {device.lastAction ? (
            <span className={actionClass(device.lastAction)}>
              {androidUsbActionLabel(device.lastAction)}
            </span>
          ) : null}
        </div>
        {device.manufacturer ? (
          <p className="case-ausb-device__mfg muted text-xs">{device.manufacturer}</p>
        ) : null}
        <dl className="case-ausb-detail">
          <Detail label="VID" value={device.vid} mono />
          <Detail label="PID" value={device.pid} mono />
          <Detail label="Driver" value={device.driver} mono />
          <Detail label="Interface" value={device.interface} mono />
          <Detail label="First Seen" value={device.firstSeen} mono />
          <Detail label="Last Seen" value={device.lastSeen} mono />
          <Detail label="Last Action" value={device.lastAction} />
          <Detail label="Path" value={device.path} mono />
        </dl>
      </div>
    </li>
  );
}

function PortCard({ port }: { port: AndroidUsbPort }) {
  const statusClass =
    port.connected === true
      ? "case-ausb-action case-ausb-action--on"
      : port.connected === false
        ? "case-ausb-action case-ausb-action--off"
        : "case-ausb-action case-ausb-action--unknown";
  const status =
    port.connected === true ? "connected" : port.connected === false ? "disconnected" : "unknown";
  return (
    <li className="case-ausb-device case-ausb-device--port">
      <div className="case-ausb-device__icon" aria-hidden>
        <Cable size={14} />
      </div>
      <div className="case-ausb-device__body">
        <div className="case-ausb-device__head">
          <strong className="case-ausb-device__name mono">{port.id}</strong>
          <span className={statusClass}>{status}</span>
        </div>
        <dl className="case-ausb-detail">
          <Detail label="Mode" value={port.currentMode} />
          <Detail label="First Seen" value={port.firstSeen} mono />
          <Detail label="Last Change" value={port.lastStateChange} mono />
        </dl>
      </div>
    </li>
  );
}

export function CaseAndroidUsbPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_ANDROID_USB_PANEL_ID,
      title: "USB",
      query: androidUsbDevicesQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_ANDROID_USB_PANEL_ID, x: 0, y: 0, w: 6, h: 8, minW: 3, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const view = useMemo(() => androidUsbViewFromRows(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-ausb-panel case-ausb-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ausb-panel case-ausb-panel--error muted text-xs">{error}</p>;
  }

  if (!view.devices.length && !view.ports.length) {
    return (
      <p className="case-ausb-panel case-ausb-panel--empty muted text-xs">
        No USB host devices or ports in this bugreport.
      </p>
    );
  }

  return (
    <div className="case-ausb-panel">
      <p className="case-ausb-panel__count muted text-xs">
        {view.devices.length} device{view.devices.length === 1 ? "" : "s"}
        {view.ports.length > 0 ? ` · ${view.ports.length} port${view.ports.length === 1 ? "" : "s"}` : ""}
      </p>
      {view.devices.length > 0 ? (
        <ul className="case-ausb-devices case-ausb-panel__scroll">
          {view.devices.map((d) => (
            <DeviceCard key={`${d.vid}:${d.pid}:${d.interface}:${d.firstSeen}`} device={d} />
          ))}
        </ul>
      ) : null}
      {view.ports.length > 0 ? (
        <>
          <p className="case-ausb-panel__section muted text-xs">Ports</p>
          <ul className="case-ausb-devices">
            {view.ports.map((p) => (
              <PortCard key={p.id} port={p} />
            ))}
          </ul>
        </>
      ) : null}
      <Link to={buildSearchHref(`${scope} parser="Usb" | head 40`)} className="case-ausb-panel__link text-xs">
        Search →
      </Link>
    </div>
  );
}

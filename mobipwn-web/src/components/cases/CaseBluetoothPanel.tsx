import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bluetooth, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_BLUETOOTH_PANEL_ID } from "@/lib/caseDashboard";
import { bluetoothConnectionLabel, bluetoothDevices, type BluetoothDevice } from "@/lib/bluetoothDevices";

function bluetoothQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="Bluetooth" | fields timestamp, datetime, app_name, device_id, message, ext | sort -timestamp | head 40`;
}

function DeviceDetail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="case-bt-detail__row">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}

function BluetoothDeviceCard({ device }: { device: BluetoothDevice }) {
  const statusClass =
    device.connected === true
      ? "case-bt-status--on"
      : device.connected === false
        ? "case-bt-status--off"
        : "case-bt-status--unknown";

  return (
    <li className="case-bt-device">
      <div className="case-bt-device__icon" aria-hidden>
        <Bluetooth size={14} />
      </div>
      <div className="case-bt-device__body">
        <div className="case-bt-device__head">
          <strong className="case-bt-device__name">{device.name}</strong>
          {device.timestamp && (
            <time className="case-bt-device__time mono text-xs muted">{device.timestamp}</time>
          )}
        </div>
        <span className={`case-bt-status ${statusClass}`}>
          {bluetoothConnectionLabel(device.connected)}
        </span>

        <dl className="case-bt-detail">
          <DeviceDetail label="MAC Address" value={device.address} mono />
          <DeviceDetail label="Identity Address" value={device.identityAddress} mono />
          <DeviceDetail label="Device Class" value={device.deviceClass} mono />
          <DeviceDetail label="Device Type" value={device.deviceType} mono />
          <DeviceDetail label="Transport Type" value={device.transportType} />
          <DeviceDetail label="Link Type" value={device.linkType} mono />
          <DeviceDetail label="Manufacturer ID" value={device.manufacturerId} mono />
        </dl>

        {device.services.length > 0 && (
          <div className="case-bt-services">
            <span className="case-bt-services__label">Profiles</span>
            <div className="case-bt-services__tags">
              {device.services.map((service) => (
                <span key={service} className="case-bt-service-tag">
                  {service}
                </span>
              ))}
            </div>
          </div>
        )}
        {device.serviceUuids.length > 0 && (
          <div className="case-bt-services case-bt-services--uuids">
            <span className="case-bt-services__label">Service UUIDs</span>
            <div className="case-bt-services__tags">
              {device.serviceUuids.map((uuid) => (
                <span key={uuid} className="case-bt-service-tag case-bt-service-tag--uuid mono" title={uuid}>
                  {uuid}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function CaseBluetoothPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_BLUETOOTH_PANEL_ID,
      title: "Bluetooth",
      query: bluetoothQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_BLUETOOTH_PANEL_ID, x: 0, y: 0, w: 4, h: 3, minW: 3, minH: 3 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const devices = useMemo(() => bluetoothDevices(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;
  const connectedCount = devices.filter((d) => d.connected === true).length;

  if (loading && rows.length === 0) {
    return (
      <div className="case-bt-panel case-bt-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-bt-panel case-bt-panel--error muted text-xs">{error}</p>;
  }

  if (!devices.length) {
    return (
      <p className="case-bt-panel case-bt-panel--empty muted text-xs">
        No paired Bluetooth devices in this bugreport.
      </p>
    );
  }

  return (
    <div className="case-bt-panel">
      <p className="case-bt-panel__count muted text-xs">
        {devices.length} device{devices.length === 1 ? "" : "s"}
        {connectedCount > 0 && ` · ${connectedCount} connected`}
      </p>
      <ul className="case-bt-devices case-bt-panel__scroll">
        {devices.map((d) => (
          <BluetoothDeviceCard key={d.address || d.name} device={d} />
        ))}
      </ul>
      <Link
        to={buildSearchHref(`${scope} parser="Bluetooth" | head 30`)}
        className="case-bt-panel__link text-xs"
      >
        Search →
      </Link>
    </div>
  );
}

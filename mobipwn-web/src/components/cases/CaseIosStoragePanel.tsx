import { useMemo } from "react";
import { Link } from "react-router-dom";
import { HardDrive, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_STORAGE_PANEL_ID } from "@/lib/caseDashboard";
import { iosDeviceSnapshotQuery } from "@/lib/iosDeviceSnapshot";
import {
  formatBytes,
  storageCapacityTone,
  storageVolumesFromRows,
  type IosStorageVolume,
} from "@/lib/iosStorage";

function StorageVolumeCard({ volume }: { volume: IosStorageVolume }) {
  const tone = storageCapacityTone(volume.capacityPercent);
  const percent = volume.capacityPercent > 0 ? volume.capacityPercent : 0;

  return (
    <article className={`case-ios-storage-vol case-ios-storage-vol--${tone}`}>
      <div className="case-ios-storage-vol__head">
        <div>
          <h4 className="case-ios-storage-vol__label">{volume.label}</h4>
          <p className="case-ios-storage-vol__mount mono">{volume.mount}</p>
        </div>
        <span className="case-ios-storage-vol__pct mono">{volume.capacityLabel}</span>
      </div>

      <div
        className="case-ios-storage-vol__bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${volume.label} ${volume.capacityLabel} used`}
      >
        <span className="case-ios-storage-vol__bar-fill" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>

      <dl className="case-ios-storage-vol__stats">
        <div>
          <dt>Used</dt>
          <dd className="mono">{volume.used}</dd>
        </div>
        <div>
          <dt>Free</dt>
          <dd className="mono">{volume.avail}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd className="mono">{volume.size}</dd>
        </div>
        <div>
          <dt>Filesystem</dt>
          <dd className="mono" title={volume.filesystem}>
            {volume.filesystemShort}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function CaseIosStoragePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_STORAGE_PANEL_ID,
      title: "Storage",
      query: iosDeviceSnapshotQuery(src, "disks", "| fields message, ext | head 30"),
      viz: "table",
      layout: { i: CASE_IOS_STORAGE_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const volumes = useMemo(() => storageVolumesFromRows(rows), [rows]);
  const scope = `source="${src}" parser="disks"`;

  const totalUsed = volumes.primary.reduce((sum, v) => sum + v.usedBytes, 0);
  const root = volumes.primary.find((v) => v.mount === "/");

  if (loading && rows.length === 0) {
    return (
      <div className="case-ios-storage case-ios-storage--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-ios-storage case-ios-storage--error muted text-xs">{error}</p>;
  }

  if (volumes.primary.length === 0 && volumes.other.length === 0) {
    return (
      <p className="case-ios-storage case-ios-storage--empty muted text-xs">
        No disks parser volumes in this sysdiagnose yet.
      </p>
    );
  }

  return (
    <div className="case-ios-storage">
      {root && (
        <header className="case-ios-storage__hero">
          <HardDrive size={18} aria-hidden />
          <div>
            <span className="case-ios-storage__hero-title">
              {root.used} used · {root.avail} free
            </span>
            <span className="case-ios-storage__hero-meta muted text-xs">
              System volume {root.capacityLabel} full
              {totalUsed > 0 ? ` · ${formatBytes(totalUsed)} on key mounts` : ""}
            </span>
          </div>
        </header>
      )}

      <div className="case-ios-storage__scroll">
        <div className="case-ios-storage__list">
          {volumes.primary.map((vol) => (
            <StorageVolumeCard key={vol.mount} volume={vol} />
          ))}
        </div>

        {volumes.other.length > 0 && (
          <details className="case-ios-storage__more">
            <summary>Other mounts ({volumes.other.length})</summary>
            <div className="case-ios-storage__list">
              {volumes.other.map((vol) => (
                <StorageVolumeCard key={vol.mount} volume={vol} />
              ))}
            </div>
          </details>
        )}
      </div>

      <p className="case-ios-storage__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | head 50`)}>Search all disks events</Link>
      </p>
    </div>
  );
}

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Cpu, Loader2 } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_MEMORY_PANEL_ID } from "@/lib/caseDashboard";
import { formatKb, memorySnapshots } from "@/lib/memorySnapshot";

function memoryQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="Memory" | fields timestamp, message, ext | head 5`;
}

export function CaseMemoryPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_MEMORY_PANEL_ID,
      title: "Memory",
      query: memoryQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_MEMORY_PANEL_ID, x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const snapshots = useMemo(() => memorySnapshots(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-memory-panel case-memory-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-memory-panel case-memory-panel--error muted text-xs">{error}</p>;
  }

  if (!snapshots.length) {
    return (
      <p className="case-memory-panel case-memory-panel--empty muted text-xs">
        No /proc/meminfo snapshots in this bugreport.
      </p>
    );
  }

  return (
    <div className="case-memory-panel">
      <div className="case-memory-panel__scroll">
      {snapshots.map((snap, i) => (
        <section key={`mem-${i}`} className="case-memory-snapshot">
          <h4 className="case-memory-snapshot__title">
            <Cpu size={13} aria-hidden />
            {snap.label}
          </h4>
          {(snap.totalKb != null || snap.availableKb != null) && (
            <div className="case-memory-snapshot__hero">
              {snap.totalKb != null && (
                <span>
                  Total <strong className="mono">{formatKb(snap.totalKb)}</strong>
                </span>
              )}
              {snap.availableKb != null && (
                <span>
                  Available <strong className="mono">{formatKb(snap.availableKb)}</strong>
                </span>
              )}
              {snap.freeKb != null && (
                <span>
                  Free <strong className="mono">{formatKb(snap.freeKb)}</strong>
                </span>
              )}
            </div>
          )}
          <dl className="case-memory-snapshot__grid">
            {snap.fields.map((f, fi) => (
              <div key={`${f.key}-${fi}`} className="case-memory-snapshot__row">
                <dt>{f.key}</dt>
                <dd className="mono">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      </div>
      <Link
        to={buildSearchHref(`${scope} parser="Memory" | head 10`)}
        className="case-memory-panel__link text-xs"
      >
        Search →
      </Link>
    </div>
  );
}

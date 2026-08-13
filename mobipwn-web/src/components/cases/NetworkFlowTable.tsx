import { ExternalLink } from "lucide-react";
import { NetworkUidOwnerFootnote } from "@/components/cases/NetworkUidOwnerFootnote";
import {
  flowSourceDisplay,
  flowTargetDisplay,
  flowTargetTitle,
  flowWeight,
  type FlowWeightMode,
  type NetworkFlowLink,
} from "@/lib/networkFlow";
import { compareFlowSources } from "@/lib/networkOwner";
import { formatBytes } from "@/lib/rowExt";

function formatFlowValue(link: NetworkFlowLink, mode: FlowWeightMode): string {
  if (mode === "bytes") return link.bytes > 0 ? formatBytes(link.bytes) : "—";
  return link.count.toLocaleString();
}

function rowKey(link: NetworkFlowLink): string {
  return `${link.source}\0${link.target}\0${link.targetKind}`;
}

export function NetworkFlowTable({
  links,
  mode,
  activeKey,
  onHover,
  onFlowClick,
}: {
  links: NetworkFlowLink[];
  mode: FlowWeightMode;
  activeKey?: string | null;
  onHover?: (key: string | null) => void;
  onFlowClick?: (link: NetworkFlowLink) => void;
}) {
  const sorted = [...links].sort(
    (a, b) =>
      compareFlowSources(a.source, b.source) ||
      a.target.localeCompare(b.target) ||
      flowWeight(b, mode) - flowWeight(a, mode)
  );

  if (!sorted.length) return null;

  return (
    <div className="network-flow-table-wrap">
      <table className="network-flow-table">
        <thead>
          <tr>
            <th>App / package</th>
            <th>Destination</th>
            <th className="network-flow-table__num">
              {mode === "bytes" ? "Bytes" : "Connections"}
            </th>
            <th aria-hidden />
          </tr>
        </thead>
        <tbody>
          {sorted.map((link) => {
            const key = rowKey(link);
            const active = activeKey === key;
            const display = flowSourceDisplay(link);
            const rowClass = [
              active ? "network-flow-table__row--active" : "",
              display.isStale ? "network-flow-table__row--stale" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <tr
                key={key}
                className={rowClass || undefined}
                onMouseEnter={() => onHover?.(key)}
                onMouseLeave={() => onHover?.(null)}
                onClick={() => onFlowClick?.(link)}
                title={
                  onFlowClick
                    ? [link.source, display.secondary, "Open scoped search"].filter(Boolean).join(" · ")
                    : [link.source, display.secondary].filter(Boolean).join(" · ")
                }
              >
                <td className="network-flow-table__app">
                  <div className="network-flow-table__app-main mono" title={link.source}>
                    {display.isStale ? (
                      <span className="network-flow-table__stale-badge">stale</span>
                    ) : null}
                    <span className={display.isStale ? "network-flow-table__stale-label" : undefined}>
                      {display.primary}
                    </span>
                  </div>
                  {(display.explanation || display.secondary || display.isUid) && (
                    <NetworkUidOwnerFootnote
                      explanation={display.explanation}
                      secondary={display.explanation ? null : display.secondary}
                      isUid={display.isUid}
                      className="network-flow-table__app-detail"
                    />
                  )}
                </td>
                <td className="network-flow-table__dest">
                  {link.targetKind === "domain" && (
                    <span className="network-flow-table__dest-badge network-flow-table__dest-badge--domain">
                      domain
                    </span>
                  )}
                  <span
                    className={`mono${link.targetKind === "ip" ? " network-flow-table__dest-ip" : ""}`}
                    title={flowTargetTitle(link)}
                  >
                    {flowTargetDisplay(link)}
                  </span>
                </td>
                <td className="network-flow-table__num mono">{formatFlowValue(link, mode)}</td>
                <td className="network-flow-table__action">
                  {onFlowClick && <ExternalLink size={12} aria-hidden />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { rowKey as networkFlowRowKey };

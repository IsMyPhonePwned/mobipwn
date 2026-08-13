import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2, MapPin } from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_PRIVACY_PANEL_ID } from "@/lib/caseDashboard";
import { privacyProviders, openStreetMapUrl, type PrivacyLocationCoords } from "@/lib/privacyLocation";

function PrivacyLocationLine({
  label,
  text,
  coords,
}: {
  label: string;
  text: string;
  coords: PrivacyLocationCoords | null;
}) {
  const mapUrl = coords ? openStreetMapUrl(coords.latitude, coords.longitude) : null;
  return (
    <p className="case-privacy-item__loc mono text-xs" title={text}>
      <span>
        {label}: {text}
      </span>
      {mapUrl ? (
        <a
          href={mapUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="case-privacy-item__map-link"
          title="Open in OpenStreetMap"
        >
          OpenStreetMap ↗
        </a>
      ) : null}
    </p>
  );
}

function privacyQuery(source: string): string {
  const src = escapeMplString(source);
  return `source="${src}" parser="Privacy" | fields timestamp, permission, bundle_id, message, ext | head 20`;
}

export function CasePrivacyPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_PRIVACY_PANEL_ID,
      title: "Privacy",
      query: privacyQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_PRIVACY_PANEL_ID, x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const providers = useMemo(() => privacyProviders(rows), [rows]);
  const scope = `source="${escapeMplString(ingestSource)}"`;

  if (loading && rows.length === 0) {
    return (
      <div className="case-privacy-panel case-privacy-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="case-privacy-panel case-privacy-panel--error muted text-xs">{error}</p>;
  }

  if (!providers.length) {
    return (
      <p className="case-privacy-panel case-privacy-panel--empty muted text-xs">
        No location provider dumps in this bugreport.
      </p>
    );
  }

  return (
    <div className="case-privacy-panel">
      <ul className="case-privacy-list case-privacy-panel__scroll">
        {providers.map((p, i) => (
          <li key={`priv-${i}`} className="case-privacy-item">
            <div className="case-privacy-item__head">
              <MapPin size={14} aria-hidden />
              <strong>{p.title}</strong>
              {p.listenerCount > 0 && (
                <span className="case-privacy-item__badge">{p.listenerCount} listeners</span>
              )}
            </div>
            <div className="case-privacy-item__meta muted text-xs">
              {p.lastAvailability && <span>GPS {p.lastAvailability}</span>}
              {p.source && <span title={p.source}>source</span>}
            </div>
            {p.lastLocationFine && (
              <PrivacyLocationLine label="Fine" text={p.lastLocationFine} coords={p.fineCoords} />
            )}
            {p.lastLocationCoarse && !p.lastLocationFine && (
              <PrivacyLocationLine
                label="Coarse"
                text={p.lastLocationCoarse}
                coords={p.coarseCoords}
              />
            )}
          </li>
        ))}
      </ul>
      <Link
        to={buildSearchHref(`${scope} parser="Privacy" | head 20`)}
        className="case-privacy-panel__link text-xs"
      >
        Search →
      </Link>
    </div>
  );
}

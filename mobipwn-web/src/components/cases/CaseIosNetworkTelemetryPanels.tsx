import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Download,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Network,
  Phone,
  Search,
  Share2,
  Shield,
  Timer,
  Wifi,
} from "lucide-react";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import {
  CASE_IOS_CONNECTED_DOMAINS_PANEL_ID,
  CASE_IOS_INTERACTION_URLS_PANEL_ID,
  CASE_IOS_NETWORK_EXTENSION_PANEL_ID,
  CASE_IOS_NETWORK_IOCS_PANEL_ID,
  CASE_IOS_NETUSAGE_PANEL_ID,
  CASE_IOS_SAFARI_HISTORY_PANEL_ID,
  CASE_IOS_KNOWLEDGE_WEB_PANEL_ID,
  CASE_IOS_PLIST_URLS_PANEL_ID,
  CASE_IOS_POWERLOG_PUSH_PANEL_ID,
  CASE_IOS_POWERLOG_USAGE_PANEL_ID,
  CASE_IOS_QUARANTINE_URLS_PANEL_ID,
  CASE_IOS_SCREENTIME_DOMAINS_PANEL_ID,
  CASE_IOS_SWCUTIL_DOMAINS_PANEL_ID,
  CASE_IOS_TRANSPARENCY_CONTACTS_PANEL_ID,
  CASE_IOS_LOG_IPS_PANEL_ID,
} from "@/lib/caseDashboard";
import { CasePanelSearchBar, panelSearchMatch } from "@/components/cases/CasePanelSearchBar";
import { iosParserQuery } from "@/lib/iosParserData";
import {
  connectedDomainsFromSources,
  interactionUrlsFromRows,
  knowledgeWebUsageFromRows,
  logMessageIpsFromRows,
  networkExtensionHintsFromRows,
  networkIocsFromRows,
  netusageRoutesFromRows,
  plistUrlHitsFromRows,
  powerlogPushFromRows,
  powerlogUsageFromRows,
  quarantineUrlsFromRows,
  safariHistoryFromRows,
  screentimeDomainsFromRows,
  swcutilDomainsFromRows,
  transparencyContactsFromRows,
} from "@/lib/iosNetworkData";

function Loading({ className }: { className: string }) {
  return (
    <div className={`${className} case-ios-wifi--loading`}>
      <Loader2 size={16} className="animate-spin" />
    </div>
  );
}

type IocKindFilter = "all" | "domain" | "url" | "ipv4" | "other";

export function CaseIosConnectedDomainsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");

  const iocsPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_iocs`,
      title: "IOCs",
      query: iosParserQuery(src, "network_iocs", "| fields message, ioc_kind, ioc_value, ext | head 200"),
      viz: "table",
      layout: { i: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_iocs`, x: 0, y: 0, w: 12, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const safariPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_safari`,
      title: "Safari",
      query: iosParserQuery(src, "safari_history", "| fields message, ext | head 120"),
      viz: "table",
      layout: { i: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_safari`, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const knowledgePanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_knowledge`,
      title: "KnowledgeC",
      query: `source="${src}" parser="knowledgec" (message="*Web Usage*" OR message="*Safari*" OR message="*Browsing*") | fields message, ext, bundle_id | head 200`,
      viz: "table",
      layout: {
        i: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_knowledge`,
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        minW: 4,
        minH: 3,
      },
    }),
    [src]
  );
  const screenPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_screen`,
      title: "Screen Time",
      query: iosParserQuery(src, "screentime", "| fields message, ext, bundle_id | head 150"),
      viz: "table",
      layout: { i: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_screen`, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const quarantinePanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_quarantine`,
      title: "Quarantine",
      query: iosParserQuery(src, "quarantine_events", "| fields message, ext, bundle_id | head 80"),
      viz: "table",
      layout: {
        i: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_quarantine`,
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        minW: 4,
        minH: 3,
      },
    }),
    [src]
  );
  const interactionPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_interaction`,
      title: "Interaction",
      query: iosParserQuery(src, "interactionc", "| fields message, ext | head 100"),
      viz: "table",
      layout: {
        i: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_interaction`,
        x: 0,
        y: 0,
        w: 6,
        h: 4,
        minW: 4,
        minH: 3,
      },
    }),
    [src]
  );
  const swcPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_swc`,
      title: "swcutil",
      query: iosParserQuery(src, "swcutil", "| fields message, ext | head 120"),
      viz: "table",
      layout: { i: `${CASE_IOS_CONNECTED_DOMAINS_PANEL_ID}_swc`, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );

  const iocs = useDashboardPanel(iocsPanel, "24h", refreshKey, true);
  const safari = useDashboardPanel(safariPanel, "24h", refreshKey, true);
  const knowledge = useDashboardPanel(knowledgePanel, "24h", refreshKey, true);
  const screen = useDashboardPanel(screenPanel, "24h", refreshKey, true);
  const quarantine = useDashboardPanel(quarantinePanel, "24h", refreshKey, true);
  const interaction = useDashboardPanel(interactionPanel, "24h", refreshKey, true);
  const swc = useDashboardPanel(swcPanel, "24h", refreshKey, true);

  const domains = useMemo(
    () =>
      connectedDomainsFromSources({
        iocs: networkIocsFromRows(iocs.rows),
        safari: safariHistoryFromRows(safari.rows),
        knowledge: knowledgeWebUsageFromRows(knowledge.rows),
        screentime: screentimeDomainsFromRows(screen.rows),
        quarantine: quarantineUrlsFromRows(quarantine.rows),
        interaction: interactionUrlsFromRows(interaction.rows),
        swcutil: swcutilDomainsFromRows(swc.rows),
      }),
    [iocs.rows, safari.rows, knowledge.rows, screen.rows, quarantine.rows, interaction.rows, swc.rows]
  );

  const filtered = useMemo(
    () =>
      domains.filter((d) =>
        panelSearchMatch(filter, d.domain, d.sampleUrl, ...d.sources)
      ),
    [domains, filter]
  );

  const loading =
    iocs.loading &&
    safari.loading &&
    knowledge.loading &&
    screen.loading &&
    quarantine.loading &&
    interaction.loading &&
    swc.loading &&
    domains.length === 0;

  if (loading) return <Loading className="case-ios-netdom" />;
  if (!domains.length) {
    return (
      <p className="case-ios-netdom case-ios-wifi--empty muted text-xs">
        No connected domains found yet from Safari, KnowledgeC, Screen Time, quarantine, interaction,
        swcutil, or network_iocs.
      </p>
    );
  }

  return (
    <div className="case-ios-netdom">
      <header className="case-ios-wifi__hero">
        <Globe size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">
          {domains.length} unique domains across URL / host parsers
        </span>
      </header>
      <CasePanelSearchBar value={filter} onChange={setFilter} placeholder="Filter domain or source…" />
      <ul className="case-ios-wifi__list">
        {filtered.slice(0, 40).map((d) => (
          <li key={d.domain} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono text-xs">{d.domain}</span>
              <span className="mono muted text-xs">{d.hits}×</span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {d.sources.join(" · ")}
              {d.sampleUrl ? ` · ${d.sampleUrl}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {filtered.length > 40 ? (
        <p className="muted text-xs">+{filtered.length - 40} more domains</p>
      ) : null}
      {filtered.length === 0 ? <p className="muted text-xs">No domains match the filter.</p> : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" destination_domain=* | head 80`)}>
          Hunt destination_domain
        </Link>
        {" · "}
        <Link to={buildSearchHref(`source="${src}" parser="network_iocs" ioc_kind="domain" | head 80`)}>
          Domain IOCs
        </Link>
      </p>
    </div>
  );
}

export function CaseIosNetworkIocsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<IocKindFilter>("all");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_NETWORK_IOCS_PANEL_ID,
      title: "Network IOCs",
      query: iosParserQuery(src, "network_iocs", "| fields message, ioc_kind, ioc_value, ext | head 200"),
      viz: "table",
      layout: { i: CASE_IOS_NETWORK_IOCS_PANEL_ID, x: 0, y: 0, w: 12, h: 5, minW: 6, minH: 4 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const iocs = useMemo(() => networkIocsFromRows(rows), [rows]);
  const ipv4 = iocs.filter((i) => i.kind === "ipv4");
  const domains = iocs.filter((i) => i.kind === "domain");
  const urls = iocs.filter((i) => i.kind === "url");
  const other = iocs.filter((i) => i.kind !== "ipv4" && i.kind !== "domain" && i.kind !== "url");

  const visible = useMemo(() => {
    return iocs.filter((ioc) => {
      if (kindFilter === "domain" && ioc.kind !== "domain") return false;
      if (kindFilter === "url" && ioc.kind !== "url") return false;
      if (kindFilter === "ipv4" && ioc.kind !== "ipv4") return false;
      if (kindFilter === "other" && (ioc.kind === "domain" || ioc.kind === "url" || ioc.kind === "ipv4"))
        return false;
      return panelSearchMatch(filter, ioc.kind, ioc.value, ioc.sourceParser, ioc.jsonPath);
    });
  }, [iocs, filter, kindFilter]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netiocs" />;
  if (error) return <p className="case-ios-netiocs case-ios-wifi--error muted text-xs">{error}</p>;
  if (!iocs.length) {
    return (
      <p className="case-ios-netiocs case-ios-wifi--empty muted text-xs">
        No network IOCs — re-ingest sysdiagnose to run the network_iocs analyser.
      </p>
    );
  }

  const chips: Array<{ id: IocKindFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: iocs.length },
    { id: "domain", label: "Domains", count: domains.length },
    { id: "url", label: "URLs", count: urls.length },
    { id: "ipv4", label: "IPs", count: ipv4.length },
    { id: "other", label: "Other", count: other.length },
  ];

  return (
    <div className="case-ios-netiocs">
      <header className="case-ios-wifi__hero">
        <Search size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">
          {iocs.length} IOCs · {domains.length} domains · {urls.length} URLs · {ipv4.length} IP
        </span>
      </header>
      <CasePanelSearchBar value={filter} onChange={setFilter} placeholder="Filter IOC value or source…" />
      <div className="case-ios-usb__chips" role="group" aria-label="IOC kind filter">
        {chips.map((c) => {
          if (c.id !== "all" && c.count === 0) return null;
          return (
            <button
              key={c.id}
              type="button"
              className={`case-ios-usb__chip${kindFilter === c.id ? " is-active" : ""}`}
              onClick={() => setKindFilter(c.id)}
            >
              {c.label} ({c.count})
            </button>
          );
        })}
      </div>
      <ul className="case-ios-wifi__list">
        {visible.slice(0, 36).map((ioc) => (
          <li key={`${ioc.kind}:${ioc.value}:${ioc.sourceParser}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="muted text-xs">{ioc.kind}</span>
              <span className="case-ios-wifi__ssid mono text-xs">{ioc.value}</span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {ioc.sourceParser}
              {ioc.jsonPath ? ` · ${ioc.jsonPath}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {visible.length > 36 && (
        <p className="muted text-xs">+{visible.length - 36} more IOCs</p>
      )}
      {visible.length === 0 ? <p className="muted text-xs">No IOCs match the filter.</p> : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="network_iocs" | head 200`)}>
          Search network_iocs
        </Link>
      </p>
    </div>
  );
}

export function CaseIosNetusagePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_NETUSAGE_PANEL_ID,
      title: "Netusage routes",
      query: iosParserQuery(src, "netusage", "| fields message, ext | head 100"),
      viz: "table",
      layout: { i: CASE_IOS_NETUSAGE_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const routes = useMemo(() => netusageRoutesFromRows(rows), [rows]);
  const filteredRoutes = useMemo(
    () =>
      routes.filter((r) =>
        panelSearchMatch(
          filter,
          r.displayName,
          r.networkType,
          r.identifier,
          r.bssid,
          r.bytesIn,
          r.bytesOut
        )
      ),
    [routes, filter]
  );
  const wifiRoutes = useMemo(() => filteredRoutes.filter((r) => r.isWifi), [filteredRoutes]);
  const otherRoutes = useMemo(() => filteredRoutes.filter((r) => !r.isWifi), [filteredRoutes]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netusage" />;
  if (error) return <p className="case-ios-netusage case-ios-wifi--error muted text-xs">{error}</p>;
  if (!routes.length) {
    return (
      <p className="case-ios-netusage case-ios-wifi--empty muted text-xs">
        No netusage.sqlite route rows in this sysdiagnose.
      </p>
    );
  }

  const renderRoute = (r: (typeof routes)[number], i: number) => {
    const meta: string[] = [];
    if (r.bssid) meta.push(r.bssid);
    if (r.networkType && r.networkType !== r.displayName) meta.push(r.networkType);
    if (r.identifier && r.identifier !== r.displayName) meta.push(r.identifier);
    if (r.packetsIn !== "—" || r.packetsOut !== "—") {
      meta.push(`↓${r.packetsIn} pkt · ↑${r.packetsOut} pkt`);
    }
    if (r.connAttempts) meta.push(`${r.connAttempts} conn attempts`);
    if (r.connSuccesses) meta.push(`${r.connSuccesses} successes`);

    return (
      <li key={`${r.networkType}-${r.identifier}-${r.displayName}-${i}`} className="case-ios-wifi__item">
        <div className="case-ios-wifi__row">
          <span className="case-ios-wifi__ssid">{r.displayName}</span>
          <span className="mono muted text-xs">
            ↓{r.bytesIn} ↑{r.bytesOut}
          </span>
        </div>
        {meta.length > 0 ? (
          <span className="case-ios-wifi__meta muted text-xs">{meta.join(" · ")}</span>
        ) : null}
      </li>
    );
  };

  return (
    <div className="case-ios-netusage">
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter route name, type, or BSSID…"
      />
      {wifiRoutes.length > 0 ? (
        <>
          <header className="case-ios-wifi__hero">
            <Wifi size={18} aria-hidden />
            <span className="case-ios-wifi__hero-title">{wifiRoutes.length} Wi‑Fi access points</span>
          </header>
          <ul className="case-ios-wifi__list">{wifiRoutes.slice(0, 10).map(renderRoute)}</ul>
        </>
      ) : null}
      {otherRoutes.length > 0 ? (
        <>
          <header className="case-ios-wifi__hero">
            <Activity size={18} aria-hidden />
            <span className="case-ios-wifi__hero-title">
              {otherRoutes.length} cellular / other routes
            </span>
          </header>
          <ul className="case-ios-wifi__list">{otherRoutes.slice(0, 10).map(renderRoute)}</ul>
        </>
      ) : null}
      {filteredRoutes.length === 0 ? (
        <p className="muted text-xs">No routes match the filter.</p>
      ) : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="netusage" | head 80`)}>Search netusage</Link>
      </p>
    </div>
  );
}

export function CaseIosSafariHistoryPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_SAFARI_HISTORY_PANEL_ID,
      title: "Safari history",
      query: iosParserQuery(src, "safari_history", "| fields message, ext, destination_domain | head 120"),
      viz: "table",
      layout: { i: CASE_IOS_SAFARI_HISTORY_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const visits = useMemo(() => safariHistoryFromRows(rows), [rows]);
  const filtered = useMemo(
    () =>
      visits.filter((v) => panelSearchMatch(filter, v.url, v.domain, v.title, v.timestamp)),
    [visits, filter]
  );
  const uniqueDomains = useMemo(() => {
    const s = new Set(visits.map((v) => v.domain).filter(Boolean));
    return s.size;
  }, [visits]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netsafari" />;
  if (error) return <p className="case-ios-netsafari case-ios-wifi--error muted text-xs">{error}</p>;
  if (!visits.length) {
    return (
      <p className="case-ios-netsafari case-ios-wifi--empty muted text-xs">
        No Safari History.db rows in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-netsafari">
      <header className="case-ios-wifi__hero">
        <Globe size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">
          {visits.length} Safari visits · {uniqueDomains} domains
        </span>
      </header>
      <CasePanelSearchBar value={filter} onChange={setFilter} placeholder="Filter URL, domain, title…" />
      <ul className="case-ios-wifi__list">
        {filtered.slice(0, 18).map((v, i) => (
          <li key={`${v.url}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono text-xs">{v.domain || v.url}</span>
              {v.visitCount ? <span className="mono muted text-xs">{v.visitCount}×</span> : null}
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {v.title || v.url}
              {v.timestamp ? ` · ${v.timestamp}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {filtered.length === 0 ? <p className="muted text-xs">No visits match the filter.</p> : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="safari_history" | head 120`)}>
          Search safari_history
        </Link>
      </p>
    </div>
  );
}

export function CaseIosKnowledgeWebPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_KNOWLEDGE_WEB_PANEL_ID,
      title: "App web usage",
      query: `source="${src}" parser="knowledgec" (message="*Web Usage*" OR message="*Safari*" OR message="*Browsing*") | fields message, ext, bundle_id | head 150`,
      viz: "table",
      layout: { i: CASE_IOS_KNOWLEDGE_WEB_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const usage = useMemo(() => knowledgeWebUsageFromRows(rows), [rows]);
  const filtered = useMemo(
    () =>
      usage.filter((u) =>
        panelSearchMatch(filter, u.appName, u.bundleId, u.domain, u.url, u.module)
      ),
    [usage, filter]
  );

  if (loading && rows.length === 0) return <Loading className="case-ios-netknow" />;
  if (error) return <p className="case-ios-netknow case-ios-wifi--error muted text-xs">{error}</p>;
  if (!usage.length) {
    return (
      <p className="case-ios-netknow case-ios-wifi--empty muted text-xs">
        No KnowledgeC web usage / Safari browsing URL rows in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-netknow">
      <header className="case-ios-wifi__hero">
        <Globe size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{usage.length} web / Safari KnowledgeC events</span>
      </header>
      <CasePanelSearchBar
        value={filter}
        onChange={setFilter}
        placeholder="Filter app, domain, or URL…"
      />
      <ul className="case-ios-wifi__list">
        {filtered.slice(0, 18).map((u, i) => (
          <li key={`${u.appName}-${u.domain}-${u.url}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono text-xs">
                {u.domain || u.url || u.appName || u.bundleId}
              </span>
              {u.seconds ? <span className="mono muted text-xs">{u.seconds}s</span> : null}
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {[u.appName || u.bundleId, u.module, u.url && u.domain ? u.url : ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {filtered.length === 0 ? <p className="muted text-xs">No events match the filter.</p> : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link
          to={buildSearchHref(
            `source="${src}" parser="knowledgec" (message="*Web Usage*" OR message="*Safari*") | head 100`
          )}
        >
          Search knowledgec web / Safari
        </Link>
      </p>
    </div>
  );
}

export function CaseIosQuarantineUrlsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_QUARANTINE_URLS_PANEL_ID,
      title: "Quarantine download URLs",
      query: iosParserQuery(src, "quarantine_events", "| fields message, ext, bundle_id | head 80"),
      viz: "table",
      layout: { i: CASE_IOS_QUARANTINE_URLS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const hits = useMemo(() => quarantineUrlsFromRows(rows), [rows]);
  const filtered = useMemo(
    () =>
      hits.filter((h) =>
        panelSearchMatch(filter, h.originUrl, h.dataUrl, h.agentBundleId, h.agentName)
      ),
    [hits, filter]
  );

  if (loading && rows.length === 0) return <Loading className="case-ios-netplist" />;
  if (error) return <p className="case-ios-netplist case-ios-wifi--error muted text-xs">{error}</p>;
  if (!hits.length) {
    return (
      <p className="case-ios-netplist case-ios-wifi--empty muted text-xs">
        No quarantine origin/data URLs in this archive (common on pure iOS; more often present on
        macOS / shared quarantine DBs).
      </p>
    );
  }

  return (
    <div className="case-ios-netplist">
      <header className="case-ios-wifi__hero">
        <Download size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{hits.length} quarantine URL events</span>
      </header>
      <CasePanelSearchBar value={filter} onChange={setFilter} placeholder="Filter URL or agent…" />
      <ul className="case-ios-wifi__list">
        {filtered.slice(0, 16).map((h, i) => (
          <li key={`${h.originUrl}-${h.dataUrl}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono text-xs">
                {h.originUrl || h.dataUrl || "—"}
              </span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {[h.dataUrl && h.originUrl ? `data ${h.dataUrl}` : "", h.agentName || h.agentBundleId]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {filtered.length === 0 ? <p className="muted text-xs">No quarantine rows match.</p> : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="quarantine_events" | head 80`)}>
          Search quarantine_events
        </Link>
      </p>
    </div>
  );
}

export function CaseIosScreentimeDomainsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_SCREENTIME_DOMAINS_PANEL_ID,
      title: "Screen Time domains",
      query: iosParserQuery(src, "screentime", "| fields message, ext, bundle_id | head 150"),
      viz: "table",
      layout: { i: CASE_IOS_SCREENTIME_DOMAINS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const domains = useMemo(() => screentimeDomainsFromRows(rows), [rows]);
  const filtered = useMemo(
    () =>
      domains.filter((d) =>
        panelSearchMatch(filter, d.domain, d.bundleId, d.category)
      ),
    [domains, filter]
  );

  if (loading && rows.length === 0) return <Loading className="case-ios-netdom" />;
  if (error) return <p className="case-ios-netdom case-ios-wifi--error muted text-xs">{error}</p>;
  if (!domains.length) {
    return (
      <p className="case-ios-netdom case-ios-wifi--empty muted text-xs">
        No Screen Time domain rows in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-netdom">
      <header className="case-ios-wifi__hero">
        <Timer size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{domains.length} Screen Time domains</span>
      </header>
      <CasePanelSearchBar value={filter} onChange={setFilter} placeholder="Filter domain or bundle…" />
      <ul className="case-ios-wifi__list">
        {filtered.slice(0, 20).map((d) => (
          <li key={d.domain} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono text-xs">{d.domain}</span>
              <span className="mono muted text-xs">{d.hits}×</span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {[d.bundleId, d.category].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {filtered.length === 0 ? <p className="muted text-xs">No domains match the filter.</p> : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="screentime" | head 120`)}>
          Search screentime
        </Link>
      </p>
    </div>
  );
}

export function CaseIosInteractionUrlsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const [filter, setFilter] = useState("");
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_INTERACTION_URLS_PANEL_ID,
      title: "Shared / interaction URLs",
      query: iosParserQuery(src, "interactionc", "| fields message, ext | head 100"),
      viz: "table",
      layout: { i: CASE_IOS_INTERACTION_URLS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const hits = useMemo(() => interactionUrlsFromRows(rows), [rows]);
  const filtered = useMemo(
    () =>
      hits.filter((h) =>
        panelSearchMatch(filter, h.contentUrl, h.domainId, h.contextText)
      ),
    [hits, filter]
  );

  if (loading && rows.length === 0) return <Loading className="case-ios-netplist" />;
  if (error) return <p className="case-ios-netplist case-ios-wifi--error muted text-xs">{error}</p>;
  if (!hits.length) {
    return (
      <p className="case-ios-netplist case-ios-wifi--empty muted text-xs">
        No interactionC content URLs / domain identifiers in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-netplist">
      <header className="case-ios-wifi__hero">
        <Share2 size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{hits.length} shared / interaction URLs</span>
      </header>
      <CasePanelSearchBar value={filter} onChange={setFilter} placeholder="Filter URL or domain id…" />
      <ul className="case-ios-wifi__list">
        {filtered.slice(0, 16).map((h, i) => (
          <li key={`${h.contentUrl}-${h.domainId}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono text-xs">
                {h.contentUrl || h.domainId || "—"}
              </span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {[h.domainId && h.contentUrl ? h.domainId : "", h.contextText]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {filtered.length === 0 ? <p className="muted text-xs">No interactions match.</p> : null}
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="interactionc" | head 80`)}>
          Search interactionc
        </Link>
      </p>
    </div>
  );
}

export function CaseIosSwcutilDomainsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_SWCUTIL_DOMAINS_PANEL_ID,
      title: "Associated domains",
      query: iosParserQuery(src, "swcutil", "| fields message, ext | head 120"),
      viz: "table",
      layout: { i: CASE_IOS_SWCUTIL_DOMAINS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const domains = useMemo(() => swcutilDomainsFromRows(rows), [rows]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netdom" />;
  if (error) return <p className="case-ios-netdom case-ios-wifi--error muted text-xs">{error}</p>;
  if (!domains.length) {
    return (
      <p className="case-ios-netdom case-ios-wifi--empty muted text-xs">
        No swcutil NETWORK section domains in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-netdom">
      <header className="case-ios-wifi__hero">
        <Globe size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{domains.length} associated domains</span>
      </header>
      <ul className="case-ios-wifi__list">
        {domains.map((d) => (
          <li key={d.domain} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid">{d.domain}</span>
              {d.status && <span className="muted text-xs">{d.status}</span>}
            </div>
          </li>
        ))}
      </ul>
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="swcutil" message="Network:*" | head 80`)}>
          Search swcutil domains
        </Link>
      </p>
    </div>
  );
}

export function CaseIosPowerlogPushPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_POWERLOG_PUSH_PANEL_ID,
      title: "Push server endpoints",
      query: iosParserQuery(src, "powerlogs", "| fields message, ext, bundle_id, dest_ip | head 120"),
      viz: "table",
      layout: { i: CASE_IOS_POWERLOG_PUSH_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const pushes = useMemo(() => powerlogPushFromRows(rows), [rows]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netpush" />;
  if (error) return <p className="case-ios-netpush case-ios-wifi--error muted text-xs">{error}</p>;
  if (!pushes.length) {
    return (
      <p className="case-ios-netpush case-ios-wifi--empty muted text-xs">
        No powerlog push notification rows (PLPUSHAGENT) in this sysdiagnose.
      </p>
    );
  }

  return (
    <div className="case-ios-netpush">
      <header className="case-ios-wifi__hero">
        <Network size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{pushes.length} push endpoints</span>
      </header>
      <ul className="case-ios-wifi__list">
        {pushes.slice(0, 12).map((p, i) => (
          <li key={`${p.hostname}-${p.serverIp}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono">{p.hostname || p.serverIp || p.topic}</span>
              {p.serverIp && p.hostname && <span className="mono muted text-xs">{p.serverIp}</span>}
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {[p.bundleId, p.topic, p.connectionType].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="powerlogs" message="*Push Message*" | head 80`)}>
          Search powerlog push events
        </Link>
      </p>
    </div>
  );
}

export function CaseIosPowerlogUsagePanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_POWERLOG_USAGE_PANEL_ID,
      title: "Process network bytes",
      query: iosParserQuery(src, "powerlogs", "| fields message, ext, bundle_id | head 150"),
      viz: "table",
      layout: { i: CASE_IOS_POWERLOG_USAGE_PANEL_ID, x: 0, y: 0, w: 12, h: 4, minW: 6, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const usage = useMemo(() => powerlogUsageFromRows(rows), [rows]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netusage" />;
  if (error) return <p className="case-ios-netusage case-ios-wifi--error muted text-xs">{error}</p>;
  if (!usage.length) {
    return (
      <p className="case-ios-netusage case-ios-wifi--empty muted text-xs">
        No powerlog process data usage rows in this sysdiagnose (interface bytes, no peer IP).
      </p>
    );
  }

  return (
    <div className="case-ios-netusage">
      <header className="case-ios-wifi__hero">
        <Activity size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{usage.length} process usage snapshots</span>
      </header>
      <ul className="case-ios-wifi__list">
        {usage.slice(0, 14).map((u, i) => (
          <li key={`${u.bundleId}-${u.processName}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid">{u.bundleId || u.processName || "process"}</span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              Wi‑Fi ↓{u.wifiIn} ↑{u.wifiOut}
              {(u.cellIn !== "—" || u.cellOut !== "—") && ` · Cell ↓${u.cellIn} ↑${u.cellOut}`}
            </span>
          </li>
        ))}
      </ul>
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="powerlogs" message="*Process Data Usage*" | head 80`)}>
          Search powerlog usage
        </Link>
      </p>
    </div>
  );
}

export function CaseIosNetworkExtensionPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_NETWORK_EXTENSION_PANEL_ID,
      title: "VPN / proxy config",
      query: iosParserQuery(
        src,
        "networkextension",
        '| fields message, ext, dest_ip, destination_domain | head 80'
      ),
      viz: "table",
      layout: { i: CASE_IOS_NETWORK_EXTENSION_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const hints = useMemo(() => networkExtensionHintsFromRows(rows), [rows]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netext" />;
  if (error) return <p className="case-ios-netext case-ios-wifi--error muted text-xs">{error}</p>;
  if (!hints.length) {
    return (
      <p className="case-ios-netext case-ios-wifi--empty muted text-xs">
        No networkextension plist hints — re-ingest after flatten update, or archive lacks Networking plists.
      </p>
    );
  }

  return (
    <div className="case-ios-netext">
      <header className="case-ios-wifi__hero">
        <Shield size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{hints.length} network extension hints</span>
      </header>
      <ul className="case-ios-wifi__list">
        {hints.slice(0, 10).map((h, i) => (
          <li key={`${h.path}-${h.key}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono">{h.value}</span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {h.path}
              {h.key !== "—" ? ` · ${h.key}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="case-ios-wifi__footer muted text-xs">
        <Link
          to={buildSearchHref(
            `source="${src}" parser IN ("networkextension", "networkextensioncache") | head 80`
          )}
        >
          Search network extension
        </Link>
      </p>
    </div>
  );
}

export function CaseIosPlistUrlsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_PLIST_URLS_PANEL_ID,
      title: "URLs in plists",
      query: iosParserQuery(src, "plists", "| fields message, ext, url | head 80"),
      viz: "table",
      layout: { i: CASE_IOS_PLIST_URLS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const hits = useMemo(() => plistUrlHitsFromRows(rows), [rows]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netplist" />;
  if (error) return <p className="case-ios-netplist case-ios-wifi--error muted text-xs">{error}</p>;
  if (!hits.length) {
    return (
      <p className="case-ios-netplist case-ios-wifi--empty muted text-xs">
        No URL / quarantine keys found in captured plists.
      </p>
    );
  }

  return (
    <div className="case-ios-netplist">
      <header className="case-ios-wifi__hero">
        <Link2 size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{hits.length} plist URL hits</span>
      </header>
      <ul className="case-ios-wifi__list">
        {hits.slice(0, 10).map((h, i) => (
          <li key={`${h.path}-${h.url}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono text-xs">{h.url}</span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">
              {h.path}
              {h.key !== "—" ? ` · ${h.key}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="plists" message="*Plist URL*" | head 80`)}>
          Search plist URLs
        </Link>
      </p>
    </div>
  );
}

export function CaseIosTransparencyContactsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_TRANSPARENCY_CONTACTS_PANEL_ID,
      title: "Contact URIs",
      query: iosParserQuery(src, "transparency_json", "| fields message, ext | head 40"),
      viz: "table",
      layout: { i: CASE_IOS_TRANSPARENCY_CONTACTS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const contacts = useMemo(() => transparencyContactsFromRows(rows), [rows]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netcontact" />;
  if (error) return <p className="case-ios-netcontact case-ios-wifi--error muted text-xs">{error}</p>;
  if (!contacts.length) {
    return (
      <p className="case-ios-netcontact case-ios-wifi--empty muted text-xs">
        No im://mailto: or im://tel: URIs in transparency_json.
      </p>
    );
  }

  return (
    <div className="case-ios-netcontact">
      <header className="case-ios-wifi__hero">
        {contacts[0]?.kind === "tel" ? <Phone size={18} aria-hidden /> : <KeyRound size={18} aria-hidden />}
        <span className="case-ios-wifi__hero-title">{contacts.length} contact URIs</span>
      </header>
      <ul className="case-ios-wifi__list">
        {contacts.map((c) => (
          <li key={c.uri} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid">{c.label}</span>
              <span className="muted text-xs">{c.kind}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" parser="transparency_json" | head 40`)}>
          Search transparency_json
        </Link>
      </p>
    </div>
  );
}

export function CaseIosLogIpsPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_LOG_IPS_PANEL_ID,
      title: "IPs in log text",
      query: `source="${src}" message=* | fields timestamp, parser, message | head 200`,
      viz: "table",
      layout: { i: CASE_IOS_LOG_IPS_PANEL_ID, x: 0, y: 0, w: 6, h: 4, minW: 4, minH: 3 },
    }),
    [src]
  );
  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const ips = useMemo(() => logMessageIpsFromRows(rows).slice(0, 16), [rows]);

  if (loading && rows.length === 0) return <Loading className="case-ios-netips" />;
  if (error) return <p className="case-ios-netips case-ios-wifi--error muted text-xs">{error}</p>;
  if (!ips.length) {
    return (
      <p className="case-ios-netips case-ios-wifi--empty muted text-xs">
        No IPv4 literals found in ingested log messages (re-ingest with macos-unifiedlogs logarchive decode for more).
      </p>
    );
  }

  return (
    <div className="case-ios-netips">
      <header className="case-ios-wifi__hero">
        <Search size={18} aria-hidden />
        <span className="case-ios-wifi__hero-title">{ips.length} IP mentions</span>
      </header>
      <ul className="case-ios-wifi__list">
        {ips.map((hit, i) => (
          <li key={`${hit.ip}-${hit.parser}-${i}`} className="case-ios-wifi__item">
            <div className="case-ios-wifi__row">
              <span className="case-ios-wifi__ssid mono">{hit.ip}</span>
              <span className="muted text-xs">{hit.parser}</span>
            </div>
            <span className="case-ios-wifi__meta muted text-xs">{hit.message}</span>
          </li>
        ))}
      </ul>
      <p className="case-ios-wifi__footer muted text-xs">
        <Link to={buildSearchHref(`source="${src}" message="*.*.*.*" | head 50`)}>Hunt IPs in search</Link>
      </p>
    </div>
  );
}

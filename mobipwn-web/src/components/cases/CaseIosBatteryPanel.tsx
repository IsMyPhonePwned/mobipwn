import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Battery, BatteryCharging, Loader2, PlugZap } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboardPanel } from "@/hooks/useDashboardPanel";
import { buildSearchHref, escapeMplString } from "@/lib/mplQuery";
import type { DashboardPanel } from "@/lib/dashboard";
import { CASE_IOS_BATTERY_PANEL_ID } from "@/lib/caseDashboard";
import {
  batteryChargingRanges,
  downsampleBatterySeries,
  iosBatteryLevelSeriesFromRows,
  iosBatteryQuery,
  iosBatterySocSeriesFromBdcRows,
  iosBatteryViewFromPowerlogsSeries,
  iosBatteryViewFromRows,
  iosPowerlogsBatteryQuery,
} from "@/lib/batteryPanel";
import { CaseBatteryHeroStats } from "@/components/cases/CaseBatteryHeroStats";

function formatChartTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  if (spanMs <= 36 * 60 * 60 * 1000) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  if (spanMs <= 14 * 24 * 60 * 60 * 1000) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CaseIosBatteryPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const src = escapeMplString(ingestSource);
  const bdcPanel = useMemo(
    (): DashboardPanel => ({
      id: CASE_IOS_BATTERY_PANEL_ID,
      title: "Battery",
      query: iosBatteryQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_IOS_BATTERY_PANEL_ID, x: 0, y: 0, w: 12, h: 16, minW: 4, minH: 8 },
    }),
    [ingestSource]
  );
  const levelPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_IOS_BATTERY_PANEL_ID}_level`,
      title: "Battery level",
      query: iosPowerlogsBatteryQuery(ingestSource),
      viz: "line",
      layout: { i: `${CASE_IOS_BATTERY_PANEL_ID}_level`, x: 0, y: 0, w: 12, h: 6, minW: 4, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(bdcPanel, "24h", refreshKey, true);
  const {
    rows: levelRows,
    loading: levelLoading,
    error: levelError,
  } = useDashboardPanel(levelPanel, "24h", refreshKey, true);

  const powerlogsSeries = useMemo(() => iosBatteryLevelSeriesFromRows(levelRows), [levelRows]);
  const series = useMemo(() => {
    if (powerlogsSeries.length > 0) return downsampleBatterySeries(powerlogsSeries);
    return downsampleBatterySeries(iosBatterySocSeriesFromBdcRows(rows));
  }, [powerlogsSeries, rows]);
  const view = useMemo(() => {
    const bdc = iosBatteryViewFromRows(rows);
    if (bdc) return bdc;
    return iosBatteryViewFromPowerlogsSeries(series);
  }, [rows, series]);
  const seriesSource = powerlogsSeries.length > 0 ? "powerlogs" : series.length > 0 ? "bdc" : null;
  const chargingRanges = useMemo(() => batteryChargingRanges(series), [series]);
  const chartData = useMemo(
    () =>
      series.map((p) => ({
        t: p.t,
        label: p.when,
        level: Math.round(p.level * 10) / 10,
        charging: p.charging,
      })),
    [series]
  );
  const spanMs = useMemo(() => {
    if (series.length < 2) return 0;
    return series[series.length - 1]!.t - series[0]!.t;
  }, [series]);

  const scope = `source="${src}" parser="battery_bdc"`;
  const levelSearch =
    `source="${src}" parser="powerlogs" (timestamp_desc="Battery Level" OR message="Battery Level*") ` +
    `| timechart span=1h avg raw_level`;

  if (loading && rows.length === 0 && levelLoading && levelRows.length === 0) {
    return (
      <div className="case-battery-panel case-battery-panel--loading">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  if (error && !view && levelError && series.length === 0) {
    return <p className="case-battery-panel case-battery-panel--error muted text-xs">{error}</p>;
  }

  if (!view && series.length === 0) {
    return (
      <p className="case-battery-panel case-battery-panel--empty muted text-xs">
        No battery_bdc or powerlogs Battery Level telemetry in this sysdiagnose yet.
      </p>
    );
  }

  return (
    <div className="case-battery-panel case-battery-panel--ios">
      {view ? (
        <>
          <header className="case-battery-panel__hero">
            <div className="case-battery-panel__hero-icon" aria-hidden>
              {view.isCharging ? <BatteryCharging size={20} /> : <Battery size={20} />}
            </div>
            <div className="case-battery-panel__hero-main">
              <div className="case-battery-panel__hero-levels">
                <span className="case-battery-panel__soc">{view.stateOfCharge}</span>
                {view.healthPercent && (
                  <span className="case-battery-panel__health muted text-xs">
                    {view.healthPercent} health
                  </span>
                )}
              </div>
              <div className="case-battery-panel__badges">
                {view.statusBadges.map((badge) => (
                  <span key={badge} className="case-battery-panel__badge">
                    {badge === "External power" ? <PlugZap size={11} aria-hidden /> : null}
                    {badge}
                  </span>
                ))}
                <span className="case-battery-panel__badge case-battery-panel__badge--muted">
                  {view.typeCount} BDC type{view.typeCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </header>

          <CaseBatteryHeroStats stats={view.heroStats} />
        </>
      ) : null}

      {chartData.length > 0 ? (
        <section className="case-battery-section case-battery-section--chart">
          <h4 className="case-battery-section__title">
            Battery level
            <span className="muted text-xs">
              {series.length} sample{series.length === 1 ? "" : "s"}
              {seriesSource === "bdc" ? " · from BDC" : seriesSource === "powerlogs" ? " · from powerlogs" : ""}
            </span>
          </h4>
          <div className="case-battery-chart case-battery-chart--tall">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                {chargingRanges.map((range) => (
                  <ReferenceArea
                    key={`chg-${range.x1}-${range.x2}`}
                    x1={range.x1}
                    x2={range.x2}
                    fill="var(--accent-green, #22c55e)"
                    fillOpacity={0.12}
                    ifOverflow="extendDomain"
                  />
                ))}
                <ReferenceLine
                  y={20}
                  stroke="var(--accent-yellow, #eab308)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => formatChartTick(Number(v), spanMs)}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={36}
                  height={28}
                />
                <YAxis
                  domain={[0, 100]}
                  width={40}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as
                      | { label?: string; charging?: boolean | null }
                      | undefined;
                    const charge =
                      p?.charging === true ? " · charging" : p?.charging === false ? " · on battery" : "";
                    return `${p?.label ?? ""}${charge}`;
                  }}
                  formatter={(value) => [`${value}%`, "Level"]}
                />
                <Line
                  type="monotone"
                  dataKey="level"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={chartData.length < 40 ? { r: 2.5, strokeWidth: 0, fill: "var(--primary)" } : false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {chargingRanges.length > 0 ? (
            <p className="case-battery-chart__legend muted text-xs">Shaded bands = charging</p>
          ) : null}
        </section>
      ) : null}

      {view ? (
        <div className="case-battery-panel__scroll">
          {view.highlightFields.length > 0 && (
            <section className="case-battery-section">
              <h4 className="case-battery-section__title">Key metrics</h4>
              <dl className="case-battery-grid">
                {view.highlightFields.map((field) => (
                  <div key={field.key} className="case-battery-grid__row">
                    <dt>{field.label}</dt>
                    <dd className="mono">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {view.sections.map((section) => (
            <details
              key={section.id}
              className="case-battery-section case-battery-section--details"
              open={section.id.startsWith("BDC_")}
            >
              <summary className="case-battery-section__title">
                {section.title}
                <span className="muted text-xs">{section.fields.length} fields</span>
              </summary>
              <dl className="case-battery-grid case-battery-grid--dense">
                {section.fields.map((field) => (
                  <div key={`${section.id}-${field.key}`} className="case-battery-grid__row">
                    <dt>{field.label}</dt>
                    <dd className="mono" title={field.value}>
                      {field.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}

          {view.recentSamples.length > 1 && (
            <section className="case-battery-section">
              <h4 className="case-battery-section__title">Recent samples</h4>
              <ul className="case-battery-timeline">
                {view.recentSamples.map((sample, i) => (
                  <li key={`${sample.type}-${sample.when}-${i}`} className="case-battery-timeline__row">
                    <span className="case-battery-timeline__type">{sample.type}</span>
                    <span className="case-battery-timeline__summary mono text-xs">{sample.summary}</span>
                    <time className="case-battery-timeline__when muted text-xs">{sample.when}</time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}

      <div className="case-battery-panel__links">
        {rows.length > 0 ? (
          <Link to={buildSearchHref(`${scope} | sort -timestamp | head 80`)} className="case-battery-panel__link text-xs">
            Search battery_bdc →
          </Link>
        ) : (
          <span className="muted text-xs">No BatteryBDC CSV in this sysdiagnose</span>
        )}
        <Link to={buildSearchHref(levelSearch)} className="case-battery-panel__link text-xs">
          Chart Battery Level (timechart) →
        </Link>
        <Link
          to={buildSearchHref(
            `source="${src}" parser="powerlogs" (timestamp_desc="Battery Level" OR message="Battery Level*") | sort -timestamp | head 80`
          )}
          className="case-battery-panel__link text-xs"
        >
          Search Battery Level events →
        </Link>
      </div>
    </div>
  );
}

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Battery, BatteryCharging, Loader2, Smartphone } from "lucide-react";
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
import { CASE_BATTERY_PANEL_ID } from "@/lib/caseDashboard";
import {
  androidBatteryLevelQuery,
  androidBatteryLevelSeriesFromRows,
  androidBatteryQuery,
  androidBatteryViewFromRows,
  batteryChargingRanges,
  downsampleBatterySeries,
} from "@/lib/batteryPanel";
import { CaseBatteryHeroStats } from "@/components/cases/CaseBatteryHeroStats";

function formatChartTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  if (spanMs <= 36 * 60 * 60 * 1000) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (spanMs <= 14 * 24 * 60 * 60 * 1000) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CaseAndroidBatteryPanel({
  ingestSource,
  refreshKey,
}: {
  ingestSource: string;
  refreshKey: number;
}) {
  const panel = useMemo(
    (): DashboardPanel => ({
      id: CASE_BATTERY_PANEL_ID,
      title: "Battery",
      query: androidBatteryQuery(ingestSource),
      viz: "table",
      layout: { i: CASE_BATTERY_PANEL_ID, x: 0, y: 0, w: 12, h: 16, minW: 4, minH: 8 },
    }),
    [ingestSource]
  );
  const levelPanel = useMemo(
    (): DashboardPanel => ({
      id: `${CASE_BATTERY_PANEL_ID}_level`,
      title: "Battery level",
      query: androidBatteryLevelQuery(ingestSource),
      viz: "line",
      layout: { i: `${CASE_BATTERY_PANEL_ID}_level`, x: 0, y: 0, w: 12, h: 6, minW: 4, minH: 4 },
    }),
    [ingestSource]
  );

  const { rows, loading, error } = useDashboardPanel(panel, "24h", refreshKey, true);
  const {
    rows: levelRows,
    loading: levelLoading,
    error: levelError,
  } = useDashboardPanel(levelPanel, "24h", refreshKey, true);

  const view = useMemo(() => androidBatteryViewFromRows(rows), [rows]);
  const series = useMemo(
    () => downsampleBatterySeries(androidBatteryLevelSeriesFromRows(levelRows)),
    [levelRows]
  );
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
  const chargingRanges = useMemo(() => batteryChargingRanges(series), [series]);
  const spanMs = useMemo(() => {
    if (series.length < 2) return 0;
    return series[series.length - 1]!.t - series[0]!.t;
  }, [series]);
  const uniqueTimes = useMemo(() => new Set(series.map((p) => p.t)).size, [series]);

  const src = escapeMplString(ingestSource);
  const scope = `source="${src}" parser="Battery"`;
  const levelSearch =
    `${scope} (data_type="*battery_history*" OR message="Battery history*") ` +
    `| fields timestamp, datetime, message, data_type, ext | sort timestamp | head 500`;

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
        No Battery parser data in this bugreport yet.
      </p>
    );
  }

  return (
    <div className="case-battery-panel case-battery-panel--android">
      {view ? (
        <>
          <header className="case-battery-panel__hero">
            <div className="case-battery-panel__hero-icon" aria-hidden>
              {view.isCharging ? <BatteryCharging size={20} /> : <Battery size={20} />}
            </div>
            <div className="case-battery-panel__hero-main">
              <div className="case-battery-panel__hero-levels">
                <span className="case-battery-panel__soc">{view.charge}</span>
                <span className="case-battery-panel__health muted text-xs">{view.status}</span>
              </div>
              <div className="case-battery-panel__badges">
                {view.statusBadges.map((badge) => (
                  <span key={badge} className="case-battery-panel__badge">
                    {badge}
                  </span>
                ))}
                {view.historyCount > 0 && (
                  <span className="case-battery-panel__badge case-battery-panel__badge--muted">
                    {view.historyCount} history
                  </span>
                )}
                {view.hardwareCount > 0 && (
                  <span className="case-battery-panel__badge case-battery-panel__badge--muted">
                    {view.hardwareCount} kernel
                  </span>
                )}
                {view.appCount > 0 && (
                  <span className="case-battery-panel__badge case-battery-panel__badge--muted">
                    {view.appCount} apps
                  </span>
                )}
              </div>
            </div>
          </header>

          <CaseBatteryHeroStats stats={view.heroStats} />
        </>
      ) : null}

      {chartData.length > 0 && uniqueTimes >= 2 ? (
        <section className="case-battery-section case-battery-section--chart">
          <h4 className="case-battery-section__title">
            Battery level
            <span className="muted text-xs">
              {series.length} sample{series.length === 1 ? "" : "s"}
              {spanMs > 0 ? ` · ${formatChartTick(series[0]!.t, spanMs)} → ${formatChartTick(series[series.length - 1]!.t, spanMs)}` : ""}
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
                      p?.charging === true
                        ? " · charging"
                        : p?.charging === false
                          ? " · discharging"
                          : "";
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
      ) : view && view.historyCount === 0 ? (
        <p className="case-battery-panel__chart-empty muted text-xs">
          No SEC LOG battery history timeline in this bugreport — only a snapshot SoC
          {view.charge !== "—" ? ` (${view.charge})` : ""}. Re-ingest after the latest Battery
          timeline fix if history was present but collapsed.
        </p>
      ) : null}

      {view ? (
        <div className="case-battery-panel__scroll">
          {view.hardware.length > 0 && (
            <section className="case-battery-section">
              <h4 className="case-battery-section__title">Kernel hardware samples</h4>
              <ul className="case-battery-timeline">
                {view.hardware.map((sample, i) => (
                  <li key={`bh-kernel-${sample.when}-${i}`} className="case-battery-timeline__row">
                    <span className="case-battery-timeline__type">kernel</span>
                    <span className="case-battery-timeline__summary mono text-xs">
                      {[
                        sample.soc,
                        sample.temperature,
                        sample.voltage,
                        sample.current !== "—" ? sample.current : "",
                      ]
                        .filter((p) => p && p !== "—")
                        .join(" · ")}
                    </span>
                    <time className="case-battery-timeline__when muted text-xs">{sample.when}</time>
                    {sample.chargerTemp !== "—" && (
                      <span className="case-battery-timeline__flags muted text-xs">
                        charger {sample.chargerTemp}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view.history.length > 0 && (
            <section className="case-battery-section">
              <h4 className="case-battery-section__title">History samples</h4>
              <ul className="case-battery-timeline">
                {view.history.map((sample, i) => (
                  <li key={`bh-${sample.when}-${i}`} className="case-battery-timeline__row">
                    <span className="case-battery-timeline__type">{sample.status}</span>
                    <span className="case-battery-timeline__summary mono text-xs">
                      {[
                        sample.charge,
                        sample.temp,
                        sample.volt,
                        sample.current !== "—" ? sample.current : "",
                      ]
                        .filter((p) => p && p !== "—")
                        .join(" · ")}
                    </span>
                    <time className="case-battery-timeline__when muted text-xs">{sample.when}</time>
                    {sample.flags && (
                      <span className="case-battery-timeline__flags muted text-xs">{sample.flags}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view.topApps.length > 0 && (
            <section className="case-battery-section">
              <h4 className="case-battery-section__title">
                <Smartphone size={13} aria-hidden />
                Top battery consumers
              </h4>
              <ul className="case-battery-apps">
                {view.topApps.map((app) => (
                  <li key={app.package} className="case-battery-app">
                    <code className="case-battery-app__pkg mono">{app.package}</code>
                    <dl className="case-battery-app__stats">
                      <div>
                        <dt>Wakelock</dt>
                        <dd className="mono">{app.wakelock}</dd>
                      </div>
                      <div>
                        <dt>Network</dt>
                        <dd className="mono">{app.network}</dd>
                      </div>
                      <div>
                        <dt>CPU</dt>
                        <dd className="mono">{app.cpu}</dd>
                      </div>
                      <div>
                        <dt>Jobs</dt>
                        <dd className="mono">{app.jobs}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}

      <p className="case-battery-panel__footer muted text-xs">
        <Link to={buildSearchHref(`${scope} | sort -timestamp | head 80`)}>Search all battery events</Link>
        {" · "}
        <Link to={buildSearchHref(levelSearch)}>Hunt battery history</Link>
      </p>
    </div>
  );
}

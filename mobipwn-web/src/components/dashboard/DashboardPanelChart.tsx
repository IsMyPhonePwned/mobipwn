import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { drilldownSearchUrl, type PanelViz } from "@/lib/dashboard";
import {
  effectiveViz,
  formatCell,
  singleValue,
  toBarData,
  toPieData,
  toTimechartData,
  type BarPoint,
  type SearchRow,
} from "@/lib/dashboardPanelData";
import { seriesColorMap } from "@/lib/timelineChart";
import { formatBucketTime } from "@/lib/timelineFormat";

type Props = {
  viz: PanelViz;
  query: string;
  rows: SearchRow[];
  columns: string[];
  compact?: boolean;
};

const PIE_COLORS = ["#5EE7F0", "#FB7185", "#FBBF24", "#A78BFA", "#34D399", "#60A5FA", "#FB923C"];

export function DashboardPanelChart({ viz, query, rows, columns, compact }: Props) {
  const navigate = useNavigate();
  const effective = effectiveViz(viz, rows, columns, query);

  const barData = useMemo(() => toBarData(rows, columns), [rows, columns]);
  const pieData = useMemo(() => toPieData(rows, columns), [rows, columns]);
  const timechart = useMemo(() => toTimechartData(rows, columns, query), [rows, columns, query]);
  const colors = useMemo(() => seriesColorMap(timechart.seriesKeys), [timechart.seriesKeys]);

  const drill = (field: string, value: string) => {
    navigate(drilldownSearchUrl(query, field, value));
  };

  if (!rows.length && effective !== "single_value") {
    return <p className="dashboard-panel-empty">No data in range</p>;
  }

  if (effective === "single_value") {
    const val = singleValue(rows, columns);
    return (
      <div className="dashboard-single-value">
        {val == null ? "—" : typeof val === "number" ? val.toLocaleString() : val}
      </div>
    );
  }

  if (effective === "table") {
    const cols = columns.length ? columns : Object.keys(rows[0] ?? {});
    const maxRows = compact ? 12 : 20;
    return (
      <div className="dashboard-panel-table-wrap">
        <table className="dashboard-panel-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, maxRows).map((row, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className="truncate-cell" title={formatCell(row[c])}>
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (effective === "pie" && pieData.length) {
    return (
      <div className="dashboard-panel-chart">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="45%"
            outerRadius="80%"
            onClick={(_, idx) => {
              const pt = pieData[idx];
              if (pt) drill(pt.field, pt.name);
            }}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} cursor="pointer" />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      </div>
    );
  }

  if (effective === "timechart" && timechart.data.length) {
    const Chart = viz === "line" ? LineChart : viz === "bar" ? BarChart : AreaChart;
    const spanMs =
      timechart.data.length >= 2
        ? timechart.data[timechart.data.length - 1].timestamp - timechart.data[0].timestamp
        : 0;
    const spansDays = spanMs > 24 * 60 * 60 * 1000;
    return (
      <div className="dashboard-panel-chart">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={timechart.data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-2)" />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ts) => formatBucketTime(ts, spansDays)}
            tick={{ fontSize: 10 }}
          />
          <YAxis tick={{ fontSize: 10 }} width={40} />
          <Tooltip labelFormatter={(ts) => formatBucketTime(Number(ts), spansDays)} />
          {timechart.seriesKeys.map((key) =>
            viz === "line" ? (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors.get(key)}
                dot={false}
                strokeWidth={2}
              />
            ) : viz === "bar" ? (
              <Bar key={key} dataKey={key} fill={colors.get(key)} stackId="a" />
            ) : (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors.get(key)}
                fill={colors.get(key)}
                fillOpacity={0.25}
                stackId="a"
              />
            )
          )}
        </Chart>
      </ResponsiveContainer>
      </div>
    );
  }

  if (barData.length) {
    const horizontal = barData.length > 6;
    return (
      <div className="dashboard-panel-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={barData}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 4, right: 8, left: horizontal ? 72 : 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-2)" />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="label" width={68} tick={{ fontSize: 10 }} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} width={40} />
            </>
          )}
          <Tooltip />
          <Bar
            dataKey="value"
            fill="var(--primary)"
            cursor="pointer"
            onClick={(cell) => {
              const pt = (cell as { payload?: BarPoint }).payload ?? (cell as BarPoint);
              if (pt?.label && pt.field) drill(pt.field, pt.label);
            }}
          />
        </BarChart>
      </ResponsiveContainer>
      </div>
    );
  }

  return <p className="dashboard-panel-empty">No chartable data</p>;
}

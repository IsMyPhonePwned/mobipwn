import { useLocale } from "@/contexts/LocaleContext";
import type { HoneycombCell } from "@/lib/ironsift";

const LEGEND = [
  { key: "critical", label: "Critical" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
] as const;

function severityHexClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "ironsift-hex--critical";
    case "high":
      return "ironsift-hex--high";
    case "medium":
      return "ironsift-hex--medium";
    case "low":
      return "ironsift-hex--low";
    default:
      return "ironsift-hex--unknown";
  }
}

export function HoneycombGrid({
  cells,
  onCellClick,
}: {
  cells: HoneycombCell[];
  onCellClick?: (machineId: string) => void;
}) {
  const { t } = useLocale();

  if (cells.length === 0) {
    return <p className="muted">{t("ironsift.honeycombEmpty")}</p>;
  }

  const maxRow = Math.max(...cells.map((c) => c.row), 0);
  const maxCol = Math.max(...cells.map((c) => c.col), 0);
  const grid: (HoneycombCell | null)[][] = Array.from({ length: maxRow + 1 }, () =>
    Array.from({ length: maxCol + 1 }, () => null)
  );
  const cellKeys: string[][] = Array.from({ length: maxRow + 1 }, () =>
    Array.from({ length: maxCol + 1 }, () => "")
  );
  for (const [idx, cell] of cells.entries()) {
    grid[cell.row][cell.col] = cell;
    cellKeys[cell.row][cell.col] = `hc-${idx}`;
  }

  return (
    <div className="ironsift-honeycomb-wrap">
      <div className="ironsift-honeycomb-legend">
        {LEGEND.map((item) => (
          <span key={item.key} className="ironsift-honeycomb-legend__item">
            <span
              className={`ironsift-honeycomb-legend__swatch ironsift-honeycomb-legend__swatch--${item.key}`}
            />
            {item.label}
          </span>
        ))}
      </div>
      <div className="ironsift-honeycomb">
        {grid.map((row, ri) => (
          <div key={ri} className="ironsift-honeycomb-row">
            {row.map((cell, ci) => {
              const cellKey = cellKeys[ri][ci] || `empty-${ri}-${ci}`;
              if (!cell) {
                return <div key={cellKey} className="ironsift-hex ironsift-hex-empty" />;
              }
              const label = `${cell.machine_id} — ${cell.severity} (${cell.score.toFixed(2)})`;
              const severityClass = severityHexClass(cell.severity);
              const content = (
                <>
                  <span>{cell.machine_id.slice(0, 8)}</span>
                  <span className="ironsift-hex__score">{cell.score.toFixed(2)}</span>
                </>
              );
              return (
                onCellClick ? (
                  <button
                    key={cellKey}
                    type="button"
                    className={`ironsift-hex ironsift-hex--clickable ${severityClass}`}
                    title={`${label}\n${t("ironsift.honeycombOpenFinding")}`}
                    onClick={() => onCellClick(cell.machine_id)}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    key={cellKey}
                    className={`ironsift-hex ${severityClass}`}
                    title={label}
                  >
                    {content}
                  </div>
                )
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { ArrowDown, ArrowUp, Copy } from "lucide-react";
import { ResultCell, resultCellTitle } from "@/components/search/ResultCell";
import { enrichmentColumnLabel, isEnrichmentColumn } from "@/lib/enrichment";

export type ResultsTableRow = Record<string, unknown>;

const DEFAULT_COL_WIDTH = 132;
const MESSAGE_COL_WIDTH = 380;
const TIMESTAMP_COL_WIDTH = 160;
const MIN_COL_WIDTH = 56;
const ROW_INDEX_WIDTH = 44;
const MAX_CELL_CHARS = 2000;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

type SortDir = "asc" | "desc";

function compareCellValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null || a === "") return 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = cellText(a);
  const sb = cellText(b);
  const na = Number(sa);
  const nb = Number(sb);
  if (sa !== "" && sb !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) {
    return na - nb;
  }
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
}

function defaultWidthFor(col: string): number {
  const c = col.toLowerCase();
  if (c === "timestamp" || c === "bucket") return TIMESTAMP_COL_WIDTH;
  if (c === "message") return MESSAGE_COL_WIDTH;
  if (c === "severity" || c === "platform" || c === "action") return 88;
  if (c === "parser" || c === "data_type") return 140;
  return DEFAULT_COL_WIDTH;
}

function defaultWidths(columns: string[]): Record<string, number> {
  const w: Record<string, number> = { __row: ROW_INDEX_WIDTH };
  for (const c of columns) {
    w[c] = defaultWidthFor(c);
  }
  return w;
}

type Props = {
  columns: string[];
  rows: ResultsTableRow[];
  selectedIndex: number | null;
  onSelectRow: (row: ResultsTableRow, index: number) => void;
  maxRows?: number;
};

export function ResultsTable({
  columns,
  rows,
  selectedIndex,
  onSelectRow,
  maxRows,
}: Props) {
  const { log } = useActivityLog();
  const [widths, setWidths] = useState<Record<string, number>>(() => defaultWidths(columns));
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ row: number; col: string } | null>(null);
  const [sort, setSort] = useState<{ col: string; dir: SortDir } | null>(null);
  const resizeRef = useRef<{
    col: string;
    startX: number;
    startW: number;
  } | null>(null);

  const stickyLeftCol = columns.includes("timestamp") ? "timestamp" : null;
  const stickyRightCol = columns.includes("message") ? "message" : null;

  /** Keep message last so sticky-right sits at the natural end of the row. */
  const orderedColumns = useMemo(() => {
    if (!stickyRightCol) return columns;
    return [...columns.filter((c) => c !== stickyRightCol), stickyRightCol];
  }, [columns, stickyRightCol]);

  useEffect(() => {
    setWidths((prev) => {
      const next = defaultWidths(orderedColumns);
      for (const c of orderedColumns) {
        if (prev[c] != null) next[c] = prev[c];
      }
      return next;
    });
  }, [orderedColumns.join("|")]);

  useEffect(() => {
    setSort(null);
  }, [rows, orderedColumns.join("|")]);

  useEffect(() => {
    if (!copyNotice) return;
    const t = window.setTimeout(() => setCopyNotice(null), 2000);
    return () => window.clearTimeout(t);
  }, [copyNotice]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onResizeStart = useCallback(
    (col: string, clientX: number) => {
      resizeRef.current = {
        col,
        startX: clientX,
        startW: widths[col] ?? defaultWidthFor(col),
      };
    },
    [widths]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      e.preventDefault();
      const w = Math.max(MIN_COL_WIDTH, r.startW + (e.clientX - r.startX));
      setWidths((prev) => ({ ...prev, [r.col]: w }));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const copyCell = useCallback(
    async (rowIdx: number, col: string, value: string) => {
      const text = value.slice(0, MAX_CELL_CHARS);
      try {
        await navigator.clipboard.writeText(text);
        setCopied({ row: rowIdx, col });
        setCopyNotice(`Copied ${col}`);
        log("info", `Copy cell: ${col}`, text.slice(0, 120));
      } catch {
        setCopyNotice("Copy failed — allow clipboard access");
        log("warn", `Copy cell failed: ${col}`);
      }
    },
    [log]
  );

  const selectRow = useCallback(
    (row: ResultsTableRow, index: number) => {
      log("info", `Inspect result row #${index + 1}`);
      onSelectRow(row, index);
    },
    [log, onSelectRow]
  );

  const visible = maxRows != null ? rows.slice(0, maxRows) : rows;
  const truncated = maxRows != null && rows.length > maxRows;

  const displayRows = useMemo(() => {
    if (!sort) return visible;
    return [...visible].sort((ra, rb) => {
      const cmp = compareCellValues(ra[sort.col], rb[sort.col]);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [visible, sort]);

  const toggleSort = useCallback(
    (col: string) => {
      let logMsg = "";
      setSort((prev) => {
        if (prev?.col !== col) {
          logMsg = `Sort column: ${col} (asc)`;
          return { col, dir: "asc" };
        }
        if (prev.dir === "asc") {
          logMsg = `Sort column: ${col} (desc)`;
          return { col, dir: "desc" };
        }
        logMsg = `Sort column: ${col} (cleared)`;
        return null;
      });
      log("info", logMsg);
    },
    [log]
  );

  const tableWidth =
    (widths.__row ?? ROW_INDEX_WIDTH) +
    orderedColumns.reduce((n, c) => n + (widths[c] ?? defaultWidthFor(c)), 0);

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);

  const stickyClass = (c: string) =>
    [
      stickyLeftCol === c ? "results-table__sticky results-table__sticky--left" : "",
      stickyRightCol === c ? "results-table__sticky results-table__sticky--right" : "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div className="results-table-panel">
      <div className="results-table-scroll">
        <table
          className="results-table results-table--dense results-table--nano"
          style={{ width: Math.max(tableWidth, 640), minWidth: "100%" }}
        >
          <colgroup>
            <col style={{ width: widths.__row ?? ROW_INDEX_WIDTH }} />
            {orderedColumns.map((c) => (
              <col key={c} style={{ width: widths[c] ?? defaultWidthFor(c) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="results-table__idx results-table__sticky results-table__sticky--idx" scope="col">
                #
              </th>
              {orderedColumns.map((c) => {
                const active = sort?.col === c;
                const enrichCol = isEnrichmentColumn(c);
                return (
                  <th
                    key={c}
                    scope="col"
                    className={[enrichCol ? "results-table__th--enrich" : "", stickyClass(c)]
                      .filter(Boolean)
                      .join(" ") || undefined}
                    style={{ width: widths[c] ?? defaultWidthFor(c) }}
                    aria-sort={
                      active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <div className="results-table__th-inner">
                      <button
                        type="button"
                        className={`results-table__sort-btn${active ? " active" : ""}`}
                        onClick={() => toggleSort(c)}
                        title={`Sort by ${c}`}
                      >
                        <span className="results-table__th-label">
                          {enrichCol ? enrichmentColumnLabel(c) : c}
                        </span>
                        {active &&
                          (sort.dir === "asc" ? (
                            <ArrowUp size={12} className="results-table__sort-icon" />
                          ) : (
                            <ArrowDown size={12} className="results-table__sort-icon" />
                          ))}
                      </button>
                      <span
                        className="results-table__resize"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${c} column`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          document.body.style.cursor = "col-resize";
                          document.body.style.userSelect = "none";
                          onResizeStart(c, e.clientX);
                        }}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => {
              const isSelected = selectedIndex === i;
              return (
                <tr
                  key={i}
                  className={isSelected ? "selected" : ""}
                  onClick={() => selectRow(row, i)}
                >
                  <td className="results-table__idx results-table__sticky results-table__sticky--idx muted">
                    {i + 1}
                  </td>
                  {orderedColumns.map((c) => {
                    const full = cellText(row[c]);
                    const isCopied = copied?.row === i && copied?.col === c;
                    const enrichCol = isEnrichmentColumn(c);
                    return (
                      <td
                        key={c}
                        className={[
                          isCopied ? "results-table__cell--copied" : "",
                          enrichCol ? "results-table__cell--enrich" : "",
                          c.toLowerCase() === "message" ? "results-table__cell--message" : "",
                          stickyClass(c),
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        title={resultCellTitle(c, row[c])}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) {
                            e.stopPropagation();
                            void copyCell(i, c, full);
                          }
                        }}
                      >
                        <span className="results-table__cell-text">
                          <ResultCell column={c} value={row[c]} />
                        </span>
                        <button
                          type="button"
                          className="results-table__copy-btn"
                          title="Copy cell"
                          aria-label={`Copy ${c}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void copyCell(i, c, full);
                          }}
                        >
                          <Copy size={12} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="results-table-footer">
        {truncated && (
          <p className="results-table-truncated muted">
            Showing {visible.length.toLocaleString()} of {rows.length.toLocaleString()} rows
          </p>
        )}
        <p className="results-table-hint muted">
          Click a column name to sort (asc → desc → off) · click a row to inspect ·{" "}
          {isMac ? "⌘" : "Ctrl"}+click or <Copy size={10} className="inline-icon" /> to copy · drag
          the line at the right edge of a header to resize · scroll horizontally for more columns ·
          use <code className="mono">| sort -field</code> in the query to sort before{" "}
          <code className="mono">head</code>
        </p>
        {copyNotice && <p className="results-table-toast">{copyNotice}</p>}
      </div>
    </div>
  );
}

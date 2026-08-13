import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  flowWeight,
  flowSourceDisplay,
  flowSourceLabel,
  flowTargetDisplay,
  flowTargetTitle,
  type FlowWeightMode,
  type NetworkFlowLink,
} from "@/lib/networkFlow";
import { formatBytes } from "@/lib/rowExt";
import { networkFlowRowKey } from "@/components/cases/NetworkFlowTable";

const MAX_LINKS = 18;
const NODE_MIN_H = 14;
const NODE_GAP = 4;
const PAD = 10;
const LABEL_W = 110;
const CHART_WIDTH = 720;
const MIN_CHART_HEIGHT = 240;
const MAX_CHART_HEIGHT = 420;
const MAX_ZOOM = 4;

type FlowViewBox = { x: number; y: number; w: number; h: number };

export type FlowDiagramNode = {
  id: string;
  label: string;
  side: "source" | "target";
  y0: number;
  y1: number;
  cy: number;
  total: number;
};

export type FlowDiagramPath = {
  link: NetworkFlowLink;
  d: string;
  strokeWidth: number;
  weight: number;
};

function clampViewBox(view: FlowViewBox, baseW: number, baseH: number): FlowViewBox {
  const w = Math.max(baseW / MAX_ZOOM, Math.min(baseW, view.w));
  const h = Math.max(baseH / MAX_ZOOM, Math.min(baseH, view.h));
  const x = Math.max(0, Math.min(baseW - w, view.x));
  const y = Math.max(0, Math.min(baseH - h, view.y));
  return { x, y, w, h };
}

function zoomViewBox(
  view: FlowViewBox,
  baseW: number,
  baseH: number,
  clientX: number,
  clientY: number,
  rect: DOMRect,
  zoomIn: boolean
): FlowViewBox {
  const factor = zoomIn ? 0.86 : 1.14;
  const mx = view.x + ((clientX - rect.left) / rect.width) * view.w;
  const my = view.y + ((clientY - rect.top) / rect.height) * view.h;
  const nextW = view.w * factor;
  const nextH = view.h * factor;
  const ratioX = (mx - view.x) / view.w;
  const ratioY = (my - view.y) / view.h;
  return clampViewBox(
    { x: mx - ratioX * nextW, y: my - ratioY * nextH, w: nextW, h: nextH },
    baseW,
    baseH
  );
}

function chartHeightForNodes(nodeCount: number): number {
  const inner = nodeCount * (NODE_MIN_H + NODE_GAP) + PAD * 2;
  return Math.max(MIN_CHART_HEIGHT, Math.min(MAX_CHART_HEIGHT, inner));
}

function stackNodes(
  entries: Array<[string, number]>,
  startY: number,
  availableH: number
): Map<string, FlowDiagramNode> {
  const total = entries.reduce((sum, [, w]) => sum + w, 0) || 1;
  const gapTotal = Math.max(0, entries.length - 1) * NODE_GAP;
  const usable = Math.max(availableH - gapTotal, entries.length * NODE_MIN_H);
  const out = new Map<string, FlowDiagramNode>();
  let y = startY;

  for (const [id, weight] of entries) {
    const h = Math.max(NODE_MIN_H, (weight / total) * usable);
    out.set(id, {
      id,
      label: id,
      side: "source",
      y0: y,
      y1: y + h,
      cy: y + h / 2,
      total: weight,
    });
    y += h + NODE_GAP;
  }

  return out;
}

function layoutBipartiteFlow(
  links: NetworkFlowLink[],
  mode: FlowWeightMode,
  width: number,
  height: number
): {
  sources: FlowDiagramNode[];
  targets: FlowDiagramNode[];
  paths: FlowDiagramPath[];
  chartLeft: number;
  chartRight: number;
  topLinks: NetworkFlowLink[];
} {
  const weight = (l: NetworkFlowLink) => flowWeight(l, mode);
  const topLinks = [...links]
    .filter((l) => weight(l) > 0)
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, MAX_LINKS);

  const sourceTotals = new Map<string, number>();
  const targetTotals = new Map<string, number>();
  for (const link of topLinks) {
    const w = weight(link);
    sourceTotals.set(link.source, (sourceTotals.get(link.source) ?? 0) + w);
    targetTotals.set(link.target, (targetTotals.get(link.target) ?? 0) + w);
  }

  const sourceEntries = [...sourceTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, total]) => {
      const sample = topLinks.find((link) => link.source === id);
      const display = sample ? flowSourceDisplay(sample) : null;
      const label = display
        ? display.secondary
          ? `${display.primary} (${truncate(display.secondary, 16)})`
          : display.primary
        : flowSourceLabel(id);
      return [label, id, total] as const;
    });
  const staleAt = sourceEntries.findIndex(([, id]) => id === "stale");
  if (staleAt >= 0) {
    const [stale] = sourceEntries.splice(staleAt, 1);
    sourceEntries.push(stale);
  }
  const targetEntries = [...targetTotals.entries()].sort((a, b) => b[1] - a[1]);

  const chartTop = PAD + 14;
  const chartBottom = height - PAD;
  const availableH = chartBottom - chartTop;
  const chartLeft = LABEL_W + PAD;
  const chartRight = width - LABEL_W - PAD;

  const sourceStackEntries: Array<[string, number]> = sourceEntries.map(([, id, total]) => [id, total]);
  const sourceMap = stackNodes(sourceStackEntries, chartTop, availableH);
  for (const [label, id] of sourceEntries) {
    const node = sourceMap.get(id);
    if (node) node.label = label;
  }
  const targetMap = stackNodes(targetEntries, chartTop, availableH);
  for (const node of targetMap.values()) {
    node.side = "target";
    const sample = topLinks.find((link) => link.target === node.id);
    if (sample) node.label = flowTargetDisplay(sample);
  }

  const maxWeight = Math.max(...topLinks.map(weight), 1);
  const paths: FlowDiagramPath[] = topLinks.map((link) => {
    const sp = sourceMap.get(link.source)!;
    const tp = targetMap.get(link.target)!;
    const w = weight(link);
    const strokeWidth = Math.max(1.5, Math.min(10, (w / maxWeight) * 10));
    const x0 = chartLeft;
    const x1 = chartRight;
    const cx = (x0 + x1) / 2;
    const d = `M ${x0} ${sp.cy} C ${cx} ${sp.cy}, ${cx} ${tp.cy}, ${x1} ${tp.cy}`;
    return { link, d, strokeWidth, weight: w };
  });

  return {
    sources: [...sourceMap.values()],
    targets: [...targetMap.values()],
    paths,
    chartLeft,
    chartRight,
    topLinks,
  };
}

function formatWeight(link: NetworkFlowLink, mode: FlowWeightMode): string {
  if (mode === "bytes") return link.bytes > 0 ? formatBytes(link.bytes) : "0";
  return link.count.toLocaleString();
}

export function NetworkFlowDiagram({
  links,
  mode,
  activeKey,
  onActiveKeyChange,
  onFlowClick,
}: {
  links: NetworkFlowLink[];
  mode: FlowWeightMode;
  activeKey?: string | null;
  onActiveKeyChange?: (key: string | null) => void;
  onFlowClick?: (link: NetworkFlowLink) => void;
}) {
  const [viewBox, setViewBox] = useState<FlowViewBox | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; view: FlowViewBox } | null>(null);
  const width = CHART_WIDTH;

  const layout = useMemo(() => {
    const nodeCount = Math.max(
      new Set(links.map((l) => l.source)).size,
      new Set(links.map((l) => l.target)).size,
      3
    );
    const height = chartHeightForNodes(Math.min(nodeCount, MAX_LINKS));
    const laid = layoutBipartiteFlow(links, mode, width, height);
    return { ...laid, height };
  }, [links, mode, width]);

  const height = layout.height;

  useEffect(() => {
    setViewBox({ x: 0, y: 0, w: width, h: height });
  }, [links, mode, width, height]);

  const resetZoom = useCallback(() => {
    setViewBox({ x: 0, y: 0, w: width, h: height });
  }, [width, height]);

  const nudgeZoom = useCallback(
    (zoomIn: boolean) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      setViewBox((current) =>
        current ? zoomViewBox(current, width, height, cx, cy, rect, zoomIn) : current
      );
    },
    [width, height]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!viewBox || viewBox.w >= width - 1) return;
      dragRef.current = { x: e.clientX, y: e.clientY, view: viewBox };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [viewBox, width]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      const el = viewportRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      const dx = ((e.clientX - drag.x) / rect.width) * drag.view.w;
      const dy = ((e.clientY - drag.y) / rect.height) * drag.view.h;
      setViewBox(
        clampViewBox(
          { ...drag.view, x: drag.view.x - dx, y: drag.view.y - dy },
          width,
          height
        )
      );
    },
    [width, height]
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const zoomLevel = viewBox ? width / viewBox.w : 1;
  const isZoomed = zoomLevel > 1.02;

  const activeLink = useMemo(() => {
    if (!activeKey) return null;
    return layout.paths.find((p) => networkFlowRowKey(p.link) === activeKey)?.link ?? null;
  }, [activeKey, layout.paths]);

  const highlight = useMemo(() => {
    if (!activeKey) return { sources: new Set<string>(), targets: new Set<string>() };
    const link = layout.paths.find((p) => networkFlowRowKey(p.link) === activeKey)?.link;
    if (!link) return { sources: new Set<string>(), targets: new Set<string>() };
    return {
      sources: new Set([link.source]),
      targets: new Set([link.target]),
    };
  }, [activeKey, layout.paths]);

  if (!layout.paths.length) {
    return (
      <p className="network-flow-diagram__empty muted text-xs">
        No flows match the current filter. Adjust search or switch weight mode.
      </p>
    );
  }

  if (!viewBox) return null;

  return (
    <div className="network-flow-diagram">
      <div className="network-flow-diagram__chart-head">
        <span className="network-flow-diagram__chart-title text-xs muted">
          Top {layout.topLinks.length} flow{layout.topLinks.length === 1 ? "" : "s"} in chart
        </span>
        <div className="network-flow-diagram__zoom-controls">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            title="Zoom in"
            onClick={() => nudgeZoom(true)}
          >
            <Plus size={12} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            title="Zoom out"
            onClick={() => nudgeZoom(false)}
          >
            <Minus size={12} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            title="Reset zoom"
            disabled={!isZoomed}
            onClick={resetZoom}
          >
            <Maximize2 size={12} />
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className={`network-flow-diagram__viewport${isZoomed ? " network-flow-diagram__viewport--zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={resetZoom}
        title="Use +/- to zoom · drag to pan when zoomed · double-click to reset"
      >
        <svg
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="network-flow-diagram__svg"
          role="img"
          aria-label="Network flow diagram"
        >
          <text x={PAD + 4} y={PAD + 8} className="network-flow-diagram__col-title">
            App
          </text>
          <text
            x={width - PAD - 4}
            y={PAD + 8}
            className="network-flow-diagram__col-title network-flow-diagram__col-title--right"
            textAnchor="end"
          >
            Destination
          </text>

          {layout.paths.map((path) => {
            const key = networkFlowRowKey(path.link);
            const active = activeKey === key;
            const dim = activeKey != null && !active;
            const stale = path.link.isStale || path.link.source === "stale";
            const display = flowSourceDisplay(path.link);
            return (
              <path
                key={key}
                d={path.d}
                fill="none"
                strokeWidth={active ? path.strokeWidth + 1.5 : path.strokeWidth}
                strokeLinecap="round"
                strokeDasharray={stale ? "6 4" : undefined}
                opacity={dim ? 0.12 : active ? 0.95 : stale ? 0.55 : 0.8}
                className={`network-flow-diagram__link${stale ? " network-flow-diagram__link--stale" : ""}`}
                style={{ cursor: onFlowClick ? "pointer" : undefined }}
                onMouseEnter={() => onActiveKeyChange?.(key)}
                onMouseLeave={() => onActiveKeyChange?.(null)}
                onClick={() => onFlowClick?.(path.link)}
              >
                <title>
                  {display.primary}
                  {display.secondary ? ` (${display.secondary})` : ""} → {path.link.target} (
                  {formatWeight(path.link, mode)})
                  {stale ? " · stale" : ""}
                </title>
              </path>
            );
          })}

          {layout.sources.map((node) => {
            const lit = !activeKey || highlight.sources.has(node.id);
            const sample = layout.paths.find((p) => p.link.source === node.id)?.link;
            const stale = sample?.isStale || node.id === "stale";
            return (
              <g key={`src-${node.id}`} opacity={lit ? 1 : 0.35}>
                <title>
                  {sample
                    ? [node.id, sample.sourceDetail, sample.sourceExplanation].filter(Boolean).join(" · ")
                    : node.id}
                </title>
                <rect
                  x={PAD}
                  y={node.y0}
                  width={LABEL_W - 4}
                  height={node.y1 - node.y0}
                  rx={4}
                  className={`network-flow-diagram__node network-flow-diagram__node--source${
                    highlight.sources.has(node.id) ? " network-flow-diagram__node--lit" : ""
                  }${stale ? " network-flow-diagram__node--stale" : ""}`}
                />
                <text
                  x={PAD + 6}
                  y={node.cy}
                  className={`network-flow-diagram__label${stale ? " network-flow-diagram__label--stale" : ""}`}
                  dominantBaseline="middle"
                >
                  {truncate(node.label, 22)}
                </text>
              </g>
            );
          })}

          {layout.targets.map((node) => {
            const lit = !activeKey || highlight.targets.has(node.id);
            const link = layout.paths.find((p) => p.link.target === node.id)?.link;
            return (
              <g key={`dst-${node.id}`} opacity={lit ? 1 : 0.35}>
                <title>{link ? flowTargetTitle(link) : node.label}</title>
                <rect
                  x={width - LABEL_W - PAD + 4}
                  y={node.y0}
                  width={LABEL_W - 4}
                  height={node.y1 - node.y0}
                  rx={4}
                  className={`network-flow-diagram__node network-flow-diagram__node--target${
                    highlight.targets.has(node.id) ? " network-flow-diagram__node--lit" : ""
                  }`}
                />
                <text
                  x={width - PAD - 6}
                  y={node.cy}
                  className="network-flow-diagram__label network-flow-diagram__label--right"
                  dominantBaseline="middle"
                  textAnchor="end"
                >
                  {truncate(node.label, link?.targetKind === "domain" ? 30 : 42)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="network-flow-diagram__hint mono text-xs muted">
        {activeLink ? (
          <>
            {flowSourceDisplay(activeLink).primary}
            {activeLink.sourceExplanation || activeLink.sourceDetail
              ? ` (${activeLink.sourceExplanation || activeLink.sourceDetail})`
              : ""}{" "}
            → {flowTargetDisplay(activeLink)}
            {activeLink.targetKind === "domain" ? (
              <span className="network-flow-diagram__hint-badge">domain</span>
            ) : null}
            {activeLink.isStale ? <span className="network-flow-diagram__hint-badge network-flow-diagram__hint-badge--stale">stale</span> : null}
            · {formatWeight(activeLink, mode)}
            {onFlowClick ? " · click to search" : ""}
          </>
        ) : (
          <>
            Use +/- to zoom
            {isZoomed ? ` · ${zoomLevel.toFixed(1)}× · drag to pan` : ""}
            · hover chart or table row · scroll panel to see all flows
          </>
        )}
      </p>
    </div>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

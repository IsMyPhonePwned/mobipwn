import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { GitBranch, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSearchHref } from "@/lib/mplQuery";
import type { CaseEntitiesResponse } from "@/lib/cases";
import { entityTypeColor, entityRelColor } from "@/lib/entityColors";
import { connectedNodeIds } from "@/lib/entityFilter";
import {
  ENTITY_TYPE_LABELS,
  RELATIONSHIP_LABELS,
  entitySearchQuery,
  truncateLabel,
} from "@/lib/entitySearch";
import {
  ENTITY_GRAPH_LAYOUT_ALGOS,
  computeEntityGraphLayout,
  getStoredEntityGraphLayout,
  storeEntityGraphLayout,
  type EntityGraphLayoutAlgo,
} from "@/lib/entityGraphLayout";

type GraphNode = CaseEntitiesResponse["graph"]["nodes"][number];

type Props = {
  graph: CaseEntitiesResponse["graph"];
  primaryEntityId?: string | null;
  searchScope?: string;
  height?: number;
  selectedId?: string | null;
  highlightIds?: Set<string>;
  onSelect?: (id: string | null) => void;
};

type TooltipState = {
  node: GraphNode;
  x: number;
  y: number;
};

function edgeEndpoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r1: number,
  r2: number
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const arrowGap = 8;
  return {
    x1: x1 + ux * (r1 + 2),
    y1: y1 + uy * (r1 + 2),
    x2: x2 - ux * (r2 + arrowGap),
    y2: y2 - uy * (r2 + arrowGap),
  };
}

function curvedEdgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(48, len * 0.18);
  const cx = mx - (dy / len) * bend;
  const cy = my + (dx / len) * bend;
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

export function EntityGraph({
  graph,
  primaryEntityId = null,
  searchScope,
  height = 440,
  selectedId = null,
  highlightIds = new Set(),
  onSelect,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [showLabels, setShowLabels] = useState(true);
  const [minWeight, setMinWeight] = useState(1);
  const [hiddenRels, setHiddenRels] = useState<Set<string>>(() => new Set());
  const [layoutAlgo, setLayoutAlgo] = useState<EntityGraphLayoutAlgo>(() =>
    getStoredEntityGraphLayout()
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  zoomRef.current = zoom;
  panRef.current = pan;

  const onLayoutAlgoChange = useCallback((algo: EntityGraphLayoutAlgo) => {
    setLayoutAlgo(algo);
    storeEntityGraphLayout(algo);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Native wheel listener — React onWheel cannot preventDefault (passive). */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const svg = canvas.querySelector("svg.entity-graph");
      if (!svg) return;
      const svgRect = svg.getBoundingClientRect();
      if (svgRect.width <= 0 || svgRect.height <= 0) return;

      const localX = ((e.clientX - svgRect.left) / svgRect.width) * width;
      const localY = ((e.clientY - svgRect.top) / svgRect.height) * height;
      const z = zoomRef.current;
      const p = panRef.current;
      const graphX = (localX - p.x) / z;
      const graphY = (localY - p.y) / z;
      const newZoom = Math.min(2.5, Math.max(0.45, z - e.deltaY * 0.0015));
      setZoom(newZoom);
      setPan({
        x: localX - graphX * newZoom,
        y: localY - graphY * newZoom,
      });
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [width, height]);

  const relationshipTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of graph.edges) set.add(e.relationship || "related");
    return [...set].sort();
  }, [graph.edges]);

  const filteredEdges = useMemo(
    () =>
      graph.edges
        .map((e) => ({ ...e, relationship: e.relationship || "related" }))
        .filter((e) => e.weight >= minWeight && !hiddenRels.has(e.relationship)),
    [graph.edges, minWeight, hiddenRels]
  );

  const primaryId =
    primaryEntityId ?? graph.nodes.find((n) => n.is_primary)?.id ?? null;

  const layout = useMemo(
    () =>
      computeEntityGraphLayout(
        graph.nodes,
        filteredEdges,
        width,
        height,
        primaryId,
        layoutAlgo
      ),
    [graph.nodes, filteredEdges, width, height, primaryId, layoutAlgo]
  );

  const pos = useMemo(() => new Map(layout.map((n) => [n.id, n])), [layout]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  const maxWeight = Math.max(1, ...filteredEdges.map((e) => e.weight));

  const focusId = hoveredId ?? selectedId;
  const activeHighlight = useMemo(() => {
    if (focusId) return connectedNodeIds(graph, focusId);
    if (highlightIds.size > 0) return highlightIds;
    return new Set<string>();
  }, [focusId, graph, highlightIds]);

  const hasHighlight = activeHighlight.size > 0;

  const labelNodeIds = useMemo(() => {
    const ranked = [...layout].sort((a, b) => b.occurrence_count - a.occurrence_count);
    const ids = new Set<string>();
    if (primaryId) ids.add(primaryId);
    if (selectedId) ids.add(selectedId);
    if (hoveredId) ids.add(hoveredId);
    for (const id of activeHighlight) ids.add(id);
    for (const n of ranked.slice(0, 12)) ids.add(n.id);
    return ids;
  }, [layout, primaryId, selectedId, hoveredId, activeHighlight]);

  const toggleRel = useCallback((rel: string) => {
    setHiddenRels((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  }, []);

  const showNodeTooltip = useCallback(
    (node: GraphNode, svgX: number, svgY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / width;
      const scaleY = rect.height / height;
      const screenX = rect.left + (svgX * zoom + pan.x) * scaleX;
      const screenY = rect.top + (svgY * zoom + pan.y) * scaleY;
      setTooltip({ node, x: screenX, y: screenY });
    },
    [width, height, zoom, pan.x, pan.y]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      if (target.closest(".entity-graph-node")) return;
      dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pan]
  );

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({
      x: drag.panX + (e.clientX - drag.x),
      y: drag.panY + (e.clientY - drag.y),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handleNodeClick = useCallback(
    (id: string) => {
      onSelect?.(selectedId === id ? null : id);
    },
    [onSelect, selectedId]
  );

  if (!graph.nodes.length) {
    return <p className="muted">Graph needs at least one entity.</p>;
  }

  const visibleNodeTypes = [...new Set(graph.nodes.map((n) => n.entity_type))];

  return (
    <div className="entity-graph-panel" ref={wrapRef}>
      <div className="entity-graph-header">
        <div className="entity-graph-header__title">
          <GitBranch size={15} aria-hidden />
          <span>Relationship graph</span>
          <span className="entity-graph-header__meta muted">
            {graph.nodes.length} nodes · {filteredEdges.length} edges
          </span>
        </div>
        <div className="entity-graph-toolbar">
          <label className="entity-graph-toolbar-item entity-graph-toolbar-item--layout">
            Layout
            <select
              className="entity-graph-layout-select"
              value={layoutAlgo}
              onChange={(e) => onLayoutAlgoChange(e.target.value as EntityGraphLayoutAlgo)}
              aria-label="Graph layout algorithm"
            >
              {ENTITY_GRAPH_LAYOUT_ALGOS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="entity-graph-toolbar-item">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
            Labels
          </label>
          <label className="entity-graph-toolbar-item">
            Min weight
            <input
              type="range"
              min={1}
              max={Math.max(1, maxWeight)}
              value={minWeight}
              onChange={(e) => setMinWeight(Number(e.target.value))}
            />
            <span className="mono">{minWeight}</span>
          </label>
          <span className="entity-graph-zoom-level mono">{Math.round(zoom * 100)}%</span>
          <div className="entity-graph-zoom">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.15))}
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setZoom((z) => Math.max(0.45, z - 0.15))}
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              title="Reset view"
            >
              <Maximize2 size={14} />
            </Button>
          </div>
        </div>
      </div>

      <div className="entity-graph-canvas" ref={canvasRef}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="entity-graph"
          role="img"
          aria-label="Entity relationship graph"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <defs>
            <pattern
              id="entity-graph-grid"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="0.8" className="entity-graph-grid-dot" />
            </pattern>
            <filter id="entity-graph-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker
              id="entity-graph-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="entity-graph-arrowhead" />
            </marker>
          </defs>

          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            className="entity-graph-bg"
            fill="url(#entity-graph-grid)"
          />

          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {filteredEdges.map((e) => {
              const a = pos.get(e.source);
              const b = pos.get(e.target);
              if (!a || !b) return null;
              const rel = e.relationship || "related";
              const color = entityRelColor(rel);
              const edgeActive =
                !hasHighlight ||
                (activeHighlight.has(e.source) && activeHighlight.has(e.target));
              const pts = edgeEndpoints(a.x, a.y, b.x, b.y, a.r, b.r);
              const strokeW = 1.2 + (e.weight / maxWeight) * 2.8;
              return (
                <path
                  key={`${e.source}-${e.target}-${rel}`}
                  d={curvedEdgePath(pts.x1, pts.y1, pts.x2, pts.y2)}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeW}
                  strokeLinecap="round"
                  opacity={edgeActive ? 0.42 + (e.weight / maxWeight) * 0.45 : 0.07}
                  markerEnd="url(#entity-graph-arrow)"
                  className="entity-graph-edge"
                >
                  <title>
                    {RELATIONSHIP_LABELS[rel] ?? rel}: {e.weight} shared events
                  </title>
                </path>
              );
            })}

            {layout.map((n) => {
              const meta = nodeById.get(n.id);
              if (!meta) return null;
              const color = entityTypeColor(n.entity_type);
              const showLabel = showLabels && labelNodeIds.has(n.id);
              const nodeActive = !hasHighlight || activeHighlight.has(n.id);
              const isSelected = selectedId === n.id;
              const isHovered = hoveredId === n.id;
              const isPrimary = n.is_primary || n.id === primaryId;
              const label = truncateLabel(n.label, 22);

              return (
                <g
                  key={n.id}
                  className={`entity-graph-node${nodeActive ? "" : " entity-graph-node--dim"}${isSelected ? " entity-graph-node--selected" : ""}`}
                  onMouseEnter={() => {
                    setHoveredId(n.id);
                    showNodeTooltip(meta, n.x, n.y - n.r - 4);
                  }}
                  onMouseLeave={() => {
                    setHoveredId(null);
                    setTooltip(null);
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    handleNodeClick(n.id);
                  }}
                >
                  {(isPrimary || isSelected || isHovered) && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r + (isSelected ? 7 : 5)}
                      fill={color}
                      opacity={isSelected ? 0.22 : 0.14}
                      className="entity-graph-node-halo"
                    />
                  )}
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={isSelected || isHovered ? n.r + 1.5 : n.r}
                    fill={color}
                    stroke={
                      isSelected
                        ? "var(--foreground)"
                        : isPrimary
                          ? "#eab308"
                          : "var(--card)"
                    }
                    strokeWidth={isSelected ? 2.5 : isPrimary ? 2 : 1.25}
                    opacity={nodeActive ? 1 : 0.18}
                    filter={isPrimary ? "url(#entity-graph-glow)" : undefined}
                  />
                  {isPrimary && (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={n.r + 3}
                      fill="none"
                      stroke="#eab308"
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                      opacity={0.85}
                    />
                  )}
                  {showLabel && label && (
                    <g className="entity-graph-label-wrap" pointerEvents="none">
                      <rect
                        x={n.x - label.length * 3.1 - 6}
                        y={n.y + n.r + 5}
                        width={label.length * 6.2 + 12}
                        height={14}
                        rx={4}
                        className="entity-graph-label-bg"
                      />
                      <text
                        x={n.x}
                        y={n.y + n.r + 15}
                        textAnchor="middle"
                        className="entity-graph-label"
                      >
                        {label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {tooltip && (
          <div
            className="entity-graph-tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
            role="tooltip"
          >
            <span
              className="entity-graph-tooltip__type"
              style={{ color: entityTypeColor(tooltip.node.entity_type) }}
            >
              {ENTITY_TYPE_LABELS[tooltip.node.entity_type] ?? tooltip.node.entity_type}
            </span>
            <strong className="entity-graph-tooltip__value mono">{tooltip.node.label}</strong>
            <span className="entity-graph-tooltip__meta muted">
              {tooltip.node.occurrence_count.toLocaleString()} events
              {tooltip.node.is_primary ? " · Primary anchor" : ""}
            </span>
            <Link
              to={buildSearchHref(
                entitySearchQuery(tooltip.node.entity_type, tooltip.node.label, searchScope),
                { run: true }
              )}
              className="entity-graph-tooltip__link"
              onClick={(e) => e.stopPropagation()}
            >
              Investigate in Search →
            </Link>
          </div>
        )}
      </div>

      <div className="entity-graph-footer">
        <div className="entity-graph-legend muted text-xs">
          <span className="entity-graph-legend-heading">Nodes</span>
          {visibleNodeTypes.map((t) => (
            <span key={t} className="entity-graph-legend-item">
              <span className="entity-graph-dot" style={{ background: entityTypeColor(t) }} />
              {ENTITY_TYPE_LABELS[t] ?? t}
            </span>
          ))}
        </div>
        {relationshipTypes.length > 0 && (
          <div className="entity-graph-legend entity-graph-legend--rels muted text-xs">
            <span className="entity-graph-legend-heading">Relationships</span>
            {relationshipTypes.map((rel) => {
              const active = !hiddenRels.has(rel);
              return (
                <button
                  key={rel}
                  type="button"
                  className={`entity-graph-rel-chip${active ? "" : " entity-graph-rel-chip--off"}`}
                  onClick={() => toggleRel(rel)}
                  title={active ? "Hide relationship" : "Show relationship"}
                >
                  <span
                    className="entity-graph-rel-line"
                    style={{ background: entityRelColor(rel) }}
                  />
                  {RELATIONSHIP_LABELS[rel] ?? rel}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

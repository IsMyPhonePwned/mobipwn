export type LayoutNode = {
  id: string;
  entity_type: string;
  label: string;
  occurrence_count: number;
  is_primary: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

export type LayoutEdge = {
  source: string;
  target: string;
  weight: number;
  relationship: string;
};

export type EntityGraphLayoutAlgo = "force" | "radial" | "circular" | "by_type" | "tree";

export const ENTITY_GRAPH_LAYOUT_ALGOS: Array<{ id: EntityGraphLayoutAlgo; label: string }> = [
  { id: "force", label: "Force" },
  { id: "radial", label: "Radial hub" },
  { id: "circular", label: "Circle" },
  { id: "by_type", label: "By type" },
  { id: "tree", label: "Tree" },
];

const LAYOUT_STORAGE_KEY = "mobipwn-entity-graph-layout";

export function getStoredEntityGraphLayout(): EntityGraphLayoutAlgo {
  try {
    const v = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (ENTITY_GRAPH_LAYOUT_ALGOS.some((a) => a.id === v)) {
      return v as EntityGraphLayoutAlgo;
    }
  } catch {
    /* private browsing */
  }
  return "force";
}

export function storeEntityGraphLayout(algo: EntityGraphLayoutAlgo): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, algo);
  } catch {
    /* private browsing */
  }
}

type LayoutInput = Omit<LayoutNode, "x" | "y" | "vx" | "vy" | "r">;

function nodeRadius(occurrenceCount: number, primary: boolean): number {
  const base = primary ? 10 : 7;
  const boost = Math.min(primary ? 14 : 12, Math.log2(occurrenceCount + 1) * (primary ? 3 : 2.5));
  return base + boost;
}

function placeNode(
  n: LayoutInput,
  x: number,
  y: number,
  primary: boolean
): LayoutNode {
  return {
    ...n,
    x,
    y,
    vx: 0,
    vy: 0,
    r: nodeRadius(n.occurrence_count, primary),
  };
}

function clampPosition(n: LayoutNode, width: number, height: number): LayoutNode {
  return {
    ...n,
    x: Math.max(n.r + 8, Math.min(width - n.r - 8, n.x)),
    y: Math.max(n.r + 8, Math.min(height - n.r - 8, n.y)),
  };
}

function resolveHubId(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  primaryId?: string | null
): string | null {
  if (primaryId && nodes.some((n) => n.id === primaryId)) return primaryId;
  const primary = nodes.find((n) => n.is_primary);
  if (primary) return primary.id;
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestDeg = -1;
  for (const n of nodes) {
    const d = degree.get(n.id) ?? 0;
    if (d > bestDeg) {
      bestDeg = d;
      best = n.id;
    }
  }
  return best ?? nodes[0]?.id ?? null;
}

function layoutForce(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  width: number,
  height: number,
  primaryId?: string | null
): LayoutNode[] {
  if (!nodes.length) return [];

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.34;
  const hubId = resolveHubId(nodes, edges, primaryId);

  const simNodes: LayoutNode[] = nodes.map((n, i) => {
    const isHub = hubId ? n.id === hubId : n.is_primary;
    if (isHub) return placeNode(n, cx, cy, true);
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return placeNode(n, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), false);
  });

  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const maxWeight = Math.max(1, ...edges.map((e) => e.weight));
  const pinHub = hubId != null;

  for (let tick = 0; tick < 120; tick += 1) {
    const alpha = 1 - tick / 120;

    for (let i = 0; i < simNodes.length; i += 1) {
      for (let j = i + 1; j < simNodes.length; j += 1) {
        const a = simNodes[i];
        const b = simNodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1) dist = 1;
        const force = (220 * alpha) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        const pinA = pinHub && a.id === hubId;
        const pinB = pinHub && b.id === hubId;
        if (!pinA) {
          a.vx -= dx;
          a.vy -= dy;
        }
        if (!pinB) {
          b.vx += dx;
          b.vy += dy;
        }
      }
    }

    for (const edge of edges) {
      const a = byId.get(edge.source);
      const b = byId.get(edge.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 1) dist = 1;
      const ideal = 72 + (1 - edge.weight / maxWeight) * 36;
      const force = (dist - ideal) * 0.04 * alpha * (0.5 + edge.weight / maxWeight);
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      const pinA = pinHub && a.id === hubId;
      const pinB = pinHub && b.id === hubId;
      if (!pinA) {
        a.vx += dx;
        a.vy += dy;
      }
      if (!pinB) {
        b.vx -= dx;
        b.vy -= dy;
      }
    }

    for (const n of simNodes) {
      if (pinHub && n.id === hubId) continue;
      n.vx += (cx - n.x) * 0.002 * alpha;
      n.vy += (cy - n.y) * 0.002 * alpha;
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += n.vx;
      n.y += n.vy;
    }
  }

  return simNodes.map((n) => clampPosition(n, width, height));
}

function layoutCircular(
  nodes: LayoutInput[],
  width: number,
  height: number,
  primaryId?: string | null
): LayoutNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.36;
  const hubId = resolveHubId(nodes, [], primaryId);
  const others = nodes.filter((n) => n.id !== hubId);
  const hub = nodes.find((n) => n.id === hubId);

  const out: LayoutNode[] = [];
  if (hub) out.push(placeNode(hub, cx, cy, true));
  others.forEach((n, i) => {
    const angle = (i / Math.max(others.length, 1)) * Math.PI * 2 - Math.PI / 2;
    out.push(
      placeNode(n, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), false)
    );
  });
  return out;
}

function layoutRadial(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  width: number,
  height: number,
  primaryId?: string | null
): LayoutNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const hubId = resolveHubId(nodes, edges, primaryId);
  if (!hubId) return layoutCircular(nodes, width, height, primaryId);

  const neighborSet = new Set<string>();
  for (const e of edges) {
    if (e.source === hubId) neighborSet.add(e.target);
    if (e.target === hubId) neighborSet.add(e.source);
  }

  const neighbors = nodes.filter((n) => neighborSet.has(n.id));
  const rest = nodes.filter((n) => n.id !== hubId && !neighborSet.has(n.id));
  const innerR = Math.min(width, height) * 0.22;
  const outerR = Math.min(width, height) * 0.38;

  const out: LayoutNode[] = [];
  const hub = nodes.find((n) => n.id === hubId);
  if (hub) out.push(placeNode(hub, cx, cy, true));

  neighbors.forEach((n, i) => {
    const angle = (i / Math.max(neighbors.length, 1)) * Math.PI * 2 - Math.PI / 2;
    out.push(placeNode(n, cx + innerR * Math.cos(angle), cy + innerR * Math.sin(angle), false));
  });

  rest.forEach((n, i) => {
    const angle = (i / Math.max(rest.length, 1)) * Math.PI * 2 - Math.PI / 2;
    out.push(placeNode(n, cx + outerR * Math.cos(angle), cy + outerR * Math.sin(angle), false));
  });

  return out;
}

function layoutByType(nodes: LayoutInput[], width: number, height: number): LayoutNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.min(width, height) * 0.38;
  const innerR = Math.min(width, height) * 0.14;

  const typeOrder = ["host", "bundle", "user", "process", "ip", "domain", "hash", "file", "url", "email"];
  const groups = new Map<string, LayoutInput[]>();
  for (const n of nodes) {
    const list = groups.get(n.entity_type) ?? [];
    list.push(n);
    groups.set(n.entity_type, list);
  }

  const orderedTypes = [
    ...typeOrder.filter((t) => groups.has(t)),
    ...[...groups.keys()].filter((t) => !typeOrder.includes(t)).sort(),
  ];

  const out: LayoutNode[] = [];
  const sector = (Math.PI * 2) / Math.max(orderedTypes.length, 1);

  orderedTypes.forEach((type, ti) => {
    const group = groups.get(type) ?? [];
    const midAngle = ti * sector - Math.PI / 2 + sector / 2;
    group.forEach((n, gi) => {
      const ring = group.length > 4 ? innerR + (gi % 2) * (outerR - innerR) * 0.55 : innerR;
      const spread = sector * 0.7;
      const offset =
        group.length === 1 ? 0 : (gi / (group.length - 1) - 0.5) * spread;
      const angle = midAngle + offset;
      out.push(placeNode(n, cx + ring * Math.cos(angle), cy + ring * Math.sin(angle), n.is_primary));
    });
  });

  return out;
}

function layoutTree(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  width: number,
  height: number,
  primaryId?: string | null
): LayoutNode[] {
  const hubId = resolveHubId(nodes, edges, primaryId);
  if (!hubId || nodes.length === 1) {
    return layoutCircular(nodes, width, height, primaryId);
  }

  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    adj.set(e.source, (adj.get(e.source) ?? new Set()).add(e.target));
    adj.set(e.target, (adj.get(e.target) ?? new Set()).add(e.source));
  }

  const depth = new Map<string, number>();
  const queue = [hubId];
  depth.set(hubId, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of adj.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, (depth.get(id) ?? 0) + 1);
      queue.push(next);
    }
  }

  let maxDepth = 0;
  for (const n of nodes) {
    if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);
    maxDepth = Math.max(maxDepth, depth.get(n.id)!);
  }

  const layers = new Map<number, LayoutInput[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const layer = layers.get(d) ?? [];
    layer.push(n);
    layers.set(d, layer);
  }

  const marginX = 48;
  const marginY = 40;
  const out: LayoutNode[] = [];
  const layerCount = maxDepth + 1;
  const yStep = (height - marginY * 2) / Math.max(layerCount - 1, 1);

  for (let d = 0; d <= maxDepth; d += 1) {
    const layer = layers.get(d) ?? [];
    layer.sort((a, b) => a.label.localeCompare(b.label));
    const y = marginY + d * yStep;
    const xStep = (width - marginX * 2) / Math.max(layer.length, 1);
    layer.forEach((n, i) => {
      const x = marginX + (i + 0.5) * xStep;
      out.push(placeNode(n, x, y, n.id === hubId));
    });
  }

  return out;
}

export function computeEntityGraphLayout(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  width: number,
  height: number,
  primaryId?: string | null,
  algo: EntityGraphLayoutAlgo = "force"
): LayoutNode[] {
  switch (algo) {
    case "circular":
      return layoutCircular(nodes, width, height, primaryId);
    case "radial":
      return layoutRadial(nodes, edges, width, height, primaryId);
    case "by_type":
      return layoutByType(nodes, width, height);
    case "tree":
      return layoutTree(nodes, edges, width, height, primaryId);
    case "force":
    default:
      return layoutForce(nodes, edges, width, height, primaryId);
  }
}

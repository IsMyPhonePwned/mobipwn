import type { CaseEntitiesResponse } from "@/lib/cases";

export function entityNodeId(entityType: string, value: string): string {
  return `${entityType}:${value}`;
}

export function filterCaseEntities(
  data: CaseEntitiesResponse,
  query: string,
  activeTypes: Set<string> | null
): CaseEntitiesResponse {
  const q = query.trim().toLowerCase();
  const entities = data.entities
    .filter((g) => !activeTypes || activeTypes.size === 0 || activeTypes.has(g.entity_type))
    .map((g) => ({
      ...g,
      entities: g.entities.filter((e) => {
        if (q && !e.entity_value.toLowerCase().includes(q)) return false;
        return true;
      }),
    }))
    .filter((g) => g.entities.length > 0)
    .map((g) => ({ ...g, count: g.entities.length }));

  const visibleIds = new Set<string>();
  for (const g of entities) {
    for (const e of g.entities) {
      visibleIds.add(entityNodeId(g.entity_type, e.entity_value));
    }
  }

  const nodes = data.graph.nodes.filter((n) => visibleIds.has(n.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = data.graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  return {
    ...data,
    entities,
    graph: { nodes, edges },
  };
}

export function connectedNodeIds(
  graph: CaseEntitiesResponse["graph"],
  centerId: string | null
): Set<string> {
  const out = new Set<string>();
  if (!centerId) return out;
  out.add(centerId);
  for (const e of graph.edges) {
    if (e.source === centerId) out.add(e.target);
    if (e.target === centerId) out.add(e.source);
  }
  return out;
}

export function entityStats(data: CaseEntitiesResponse) {
  let total = 0;
  let occurrences = 0;
  for (const g of data.entities) {
    total += g.entities.length;
    for (const e of g.entities) occurrences += e.occurrence_count;
  }
  return {
    types: data.entities.length,
    entities: total,
    occurrences,
    relationships: data.graph.edges.length,
  };
}

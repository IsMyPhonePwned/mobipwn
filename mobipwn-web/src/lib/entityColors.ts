/** Shared palette for entity types across list, graph, and anchor UI. */
export const ENTITY_TYPE_COLORS: Record<string, string> = {
  user: "#a855f7",
  host: "#3b82f6",
  bundle: "#ec4899",
  ip: "#22c55e",
  domain: "#f97316",
  hash: "#94a3b8",
  url: "#c084fc",
  file: "#60a5fa",
  process: "#4ade80",
  email: "#fb923c",
};

export const ENTITY_REL_COLORS: Record<string, string> = {
  on_host: "#3b82f6",
  network: "#06b6d4",
  executed: "#a855f7",
  installed: "#ec4899",
  accessed: "#60a5fa",
  connected_to: "#22c55e",
  resolved_to: "#f97316",
  belongs_to: "#c084fc",
  hash_of: "#94a3b8",
  related: "#64748b",
};

export function entityTypeColor(entityType: string): string {
  return ENTITY_TYPE_COLORS[entityType] ?? "#64748b";
}

export function entityRelColor(relationship: string): string {
  return ENTITY_REL_COLORS[relationship] ?? ENTITY_REL_COLORS.related;
}

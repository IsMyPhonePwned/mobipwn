/** Asset-oriented search: hashes/IPs in scope; rarity clicks filter the timeline query. */

export function isAssetSearch(query: string): boolean {
  const q = query.toLowerCase();
  if (q.includes("file_hash") || q.includes("dest_ip")) return true;
  if (/provider\s*=\s*["']?asset/i.test(q)) return true;
  if (q.includes("_asset")) return true;
  return false;
}

export function hasArtifactColumns(rows: Record<string, unknown>[]): boolean {
  for (const row of rows) {
    const h = String(row.file_hash ?? "").trim();
    const ip = String(row.dest_ip ?? "").trim();
    if (h || ip) return true;
  }
  return false;
}

export function artifactFieldForType(t: "hash" | "ip"): string {
  return t === "hash" ? "file_hash" : "dest_ip";
}

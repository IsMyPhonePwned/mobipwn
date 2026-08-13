/** Inject a source scope for sandbox runs without mutating the saved rule query. */
export function withSandboxSource(query: string, source: string): string {
  const trimmed = query.trim();
  const src = source.trim();
  if (!trimmed || !src) return trimmed;
  if (/source\s*=\s*["']/.test(trimmed)) return trimmed;
  return `source="${src.replace(/"/g, '\\"')}" ${trimmed}`;
}

/** First 8 hex chars of a UUID — short enough to share, unique in practice. */
export function shortIdToken(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toLowerCase();
}

export function ruleShortPath(id: string): string {
  return `/r/${shortIdToken(id)}`;
}

export function alertShortPath(id: string): string {
  return `/a/${shortIdToken(id)}`;
}

export function ruleShortUrl(id: string): string {
  return `${window.location.origin}${ruleShortPath(id)}`;
}

export function alertShortUrl(id: string): string {
  return `${window.location.origin}${alertShortPath(id)}`;
}

async function resolveEntityId(path: string, token: string, label: string): Promise<string> {
  const res = await fetch(`${path}/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || res.statusText);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error(`${label} not found`);
  return data.id;
}

export async function resolveRuleId(token: string): Promise<string> {
  return resolveEntityId("/api/v1/rules/resolve", token, "rule");
}

export async function resolveAlertId(token: string): Promise<string> {
  return resolveEntityId("/api/v1/alerts/resolve", token, "alert");
}

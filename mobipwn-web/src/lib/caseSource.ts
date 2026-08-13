/** Template token embedded in example queries — replaced with a real source label in the UI. */
export const CASE_QUERY_TEMPLATE = "case-001";

const STORAGE_LAST = "mobipwn_last_source";

/** New ingest label: `case-` + 8 hex chars (e.g. case-a3f91b2c). */
export function randomCaseSource(): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `case-${hex}`;
}

/** Pick a label not present in `used` (ClickHouse source names, etc.). */
export function pickUnusedCaseSource(used: Iterable<string>): string {
  const taken = new Set(
    [...used].map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  for (let i = 0; i < 32; i++) {
    const candidate = randomCaseSource();
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `case-${crypto.randomUUID().replace(/-/g, "")}`;
}

export function rememberLastCaseSource(source: string): void {
  const s = source.trim();
  if (s) sessionStorage.setItem(STORAGE_LAST, s);
}

export function lastCaseSource(): string | null {
  return sessionStorage.getItem(STORAGE_LAST);
}

/** Prefer last successful ingest, else a random unused label. */
export function defaultCaseSource(used: Iterable<string>): string {
  const last = lastCaseSource();
  if (last) {
    const taken = new Set(
      [...used].map((s) => s.trim().toLowerCase()).filter(Boolean)
    );
    if (!taken.has(last.toLowerCase())) {
      return last;
    }
  }
  return pickUnusedCaseSource(used);
}

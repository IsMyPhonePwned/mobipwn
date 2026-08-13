export type ResultFilterMode = "none" | "text" | "regex";

export type CompiledResultFilter = {
  mode: ResultFilterMode;
  test: (haystack: string) => boolean;
  error?: string;
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Flatten visible columns into one searchable string per row. */
export function rowHaystack(row: Record<string, unknown>, columns: string[]): string {
  const cols = columns.length ? columns : Object.keys(row);
  return cols.map((c) => cellText(row[c])).join("\n");
}

/**
 * Compile a client-side results filter.
 * - Plain text: case-insensitive substring
 * - `/pattern/flags`: JavaScript RegExp
 * - Regex mode: whole input is a RegExp (default flag `i`)
 */
export function compileResultFilter(input: string, regexMode: boolean): CompiledResultFilter {
  const trimmed = input.trim();
  if (!trimmed) {
    return { mode: "none", test: () => true };
  }

  const slash = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  if (slash || regexMode) {
    try {
      const source = slash ? slash[1] : trimmed;
      let flags = slash ? slash[2] : "i";
      if (!flags.includes("i")) flags += "i";
      const re = new RegExp(source, flags);
      return { mode: "regex", test: (h) => re.test(h) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { mode: "regex", test: () => false, error: msg };
    }
  }

  const needle = trimmed.toLowerCase();
  return { mode: "text", test: (h) => h.toLowerCase().includes(needle) };
}

export function filterResultRows<T extends Record<string, unknown>>(
  rows: T[],
  columns: string[],
  compiled: CompiledResultFilter
): T[] {
  if (compiled.mode === "none" || compiled.error) return rows;
  return rows.filter((row) => compiled.test(rowHaystack(row, columns)));
}

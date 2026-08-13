import { extField, numField, parseExt, strField } from "@/lib/rowExt";

export type MemorySnapshot = {
  label: string;
  totalKb: number | null;
  availableKb: number | null;
  freeKb: number | null;
  cachedKb: number | null;
  fields: Array<{ key: string; value: string }>;
};

const MEMORY_KEYS = ["MemTotal", "MemFree", "MemAvailable", "Buffers", "Cached", "SwapTotal", "SwapFree"];

function parseMemoryFromExt(ext: Record<string, unknown>): Array<{ key: string; value: string }> {
  return Object.entries(ext)
    .filter(([k, v]) => k && v != null && String(v).trim())
    .map(([key, value]) => ({ key, value: String(value) }))
    .sort((a, b) => {
      const ai = MEMORY_KEYS.indexOf(a.key);
      const bi = MEMORY_KEYS.indexOf(b.key);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.key.localeCompare(b.key);
    });
}

export function parseMemorySnapshot(row: Record<string, unknown>, index: number): MemorySnapshot | null {
  const parser = strField(row, "parser");
  if (parser && parser !== "Memory") return null;
  const ext = parseExt(row);
  const fields = parseMemoryFromExt(ext);
  if (!fields.length) {
    const msg = strField(row, "message");
    if (!msg) return null;
    return { label: `Snapshot ${index + 1}`, totalKb: null, availableKb: null, freeKb: null, cachedKb: null, fields: [{ key: "raw", value: msg.slice(0, 400) }] };
  }
  return {
    label: `Snapshot ${index + 1}`,
    totalKb: numField(row, "MemTotal"),
    availableKb: numField(row, "MemAvailable"),
    freeKb: numField(row, "MemFree"),
    cachedKb: numField(row, "Cached"),
    fields: fields.slice(0, 12),
  };
}

export function formatKb(kb: number | null): string {
  if (kb == null) return "—";
  if (kb < 1024) return `${kb} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function memorySnapshots(rows: Record<string, unknown>[]): MemorySnapshot[] {
  return rows
    .map((row, i) => parseMemorySnapshot(row, i))
    .filter((s): s is MemorySnapshot => s != null);
}

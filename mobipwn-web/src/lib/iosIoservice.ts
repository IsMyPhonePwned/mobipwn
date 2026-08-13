import { parseHeaderExt } from "@/lib/bugreportHeader";

export type IoserviceProperty = { key: string; label: string; value: string };

export type IoserviceSnapshot = {
  nodeCount?: number;
  propertyCount?: number;
  treeTruncated: boolean;
  properties: IoserviceProperty[];
};

const LABELS: Record<string, string> = {
  ioplatformserialnumber: "Platform serial",
  model: "Model",
  "board-id": "Board ID",
  "product-name": "Product",
  "chip-id": "Chip ID",
  uniquechipid: "Unique chip ID",
};

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const ext = parseHeaderExt(row);
  for (const key of keys) {
    const v = ext[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  const ext = parseHeaderExt(row);
  for (const key of keys) {
    const v = ext[key];
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function labelForKey(key: string): string {
  return LABELS[key.toLowerCase()] ?? key.replace(/_/g, " ");
}

export function ioserviceSnapshotFromRows(rows: Record<string, unknown>[]): IoserviceSnapshot | null {
  if (!rows.length) return null;

  const summary = rows.find((r) => pickString(r, ["event_type"]) === "ioservice_summary");
  const propsRow = rows.find((r) => pickString(r, ["event_type"]) === "device_properties");

  const nodeCount = pickNumber(summary ?? rows[0], ["node_count"]);
  const propertyCount = pickNumber(summary ?? rows[0], ["property_count"]);
  const treeTruncated =
    pickString(summary ?? rows[0], ["tree_truncated"]) === "true" ||
    summary?.tree_truncated === true;

  const properties: IoserviceProperty[] = [];
  if (propsRow) {
    const ext = parseHeaderExt(propsRow);
    const skip = new Set(["event_type", "parser", "message", "datetime", "data_type", "sysdiagnose_parser"]);
    for (const [key, value] of Object.entries({ ...propsRow, ...ext })) {
      if (skip.has(key)) continue;
      if (typeof value !== "string" || !value.trim()) continue;
      properties.push({ key, label: labelForKey(key), value: value.trim() });
    }
  }

  if (!summary && !propsRow && properties.length === 0) return null;

  return {
    nodeCount,
    propertyCount,
    treeTruncated,
    properties,
  };
}

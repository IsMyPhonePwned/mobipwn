import { extField, parseExt, strField } from "@/lib/rowExt";

export type PrivacyLocationCoords = {
  latitude: number;
  longitude: number;
};

export type PrivacyProvider = {
  title: string;
  type: string;
  listenerCount: number;
  lastAvailability: string;
  lastLocationFine: string;
  lastLocationCoarse: string;
  fineCoords: PrivacyLocationCoords | null;
  coarseCoords: PrivacyLocationCoords | null;
  source: string;
};

function jsonPreview(value: unknown, max = 120): string {
  if (value == null) return "";
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  try {
    const s = JSON.stringify(value);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(value);
  }
}

export function parsePrivacyLocationCoords(value: unknown): PrivacyLocationCoords | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const latitude =
    typeof o.latitude === "number" ? o.latitude : Number.parseFloat(String(o.latitude ?? ""));
  const longitude =
    typeof o.longitude === "number" ? o.longitude : Number.parseFloat(String(o.longitude ?? ""));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** Open location in OpenStreetMap (new tab). */
export function openStreetMapUrl(latitude: number, longitude: number, zoom = 16): string {
  const lat = latitude.toFixed(6);
  const lon = longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

export function parsePrivacyProvider(row: Record<string, unknown>): PrivacyProvider | null {
  const parser = strField(row, "parser");
  if (parser && parser !== "Privacy") return null;
  const ext = parseExt(row);
  const type = extField(row, "type") || extField(row, "event_type") || "location";
  const listeners = ext.listeners;
  const listenerCount = Array.isArray(listeners) ? listeners.length : 0;
  const title =
    extField(row, "provider_name") ||
    extField(row, "name") ||
    (type === "fused_location_provider" ? "Fused Location Provider" : "Location provider");

  const availability = ext.last_availability;
  const lastAvailability =
    typeof availability === "boolean" ? (availability ? "available" : "unavailable") : extField(row, "last_availability");

  return {
    title,
    type,
    listenerCount,
    lastAvailability,
    lastLocationFine: jsonPreview(ext.last_location_fine),
    lastLocationCoarse: jsonPreview(ext.last_location_coarse),
    fineCoords: parsePrivacyLocationCoords(ext.last_location_fine),
    coarseCoords: parsePrivacyLocationCoords(ext.last_location_coarse),
    source: jsonPreview(ext.source, 80),
  };
}

export function privacyProviders(rows: Record<string, unknown>[]): PrivacyProvider[] {
  return rows
    .map(parsePrivacyProvider)
    .filter((p): p is PrivacyProvider => p != null);
}

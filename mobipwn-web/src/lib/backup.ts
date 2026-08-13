import { apiFetch, apiPost } from "@/lib/api";
import { authHeaders } from "@/lib/auth";

export type BackupSectionInfo = {
  id: string;
  label: string;
  description: string;
};

export type BackupBundle = {
  format_version: number;
  exported_at: string;
  sections_included: string[];
  data: Record<string, unknown>;
};

export type SectionImportResult = {
  section: string;
  tables: Record<string, number>;
};

export type ImportBackupResult = {
  imported_sections: SectionImportResult[];
  warnings: string[];
};

export type ImportMode = "replace" | "merge";

export async function fetchBackupSections() {
  return apiFetch<BackupSectionInfo[]>("/v1/backup/sections");
}

export async function exportBackup(sections: string[]) {
  const res = await fetch("/api/v1/backup/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ sections }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.text();
}

export async function importBackup(
  bundle: BackupBundle,
  sections: string[],
  mode: ImportMode
) {
  return apiPost<ImportBackupResult>("/v1/backup/import", {
    bundle,
    sections,
    mode,
  });
}

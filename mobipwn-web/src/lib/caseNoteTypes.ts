export const CASE_NOTE_TYPES = [
  { id: "information", label: "Information" },
  { id: "important", label: "Important" },
  { id: "alert", label: "Alert" },
  { id: "warning", label: "Warning" },
] as const;

export type CaseNoteType = (typeof CASE_NOTE_TYPES)[number]["id"];

export const DEFAULT_CASE_NOTE_TYPE: CaseNoteType = "information";

export function normalizeCaseNoteType(raw?: string | null): CaseNoteType {
  const id = raw?.trim().toLowerCase();
  if (id === "important" || id === "alert" || id === "warning") return id;
  return DEFAULT_CASE_NOTE_TYPE;
}

export function caseNoteTypeLabel(type: CaseNoteType): string {
  return CASE_NOTE_TYPES.find((t) => t.id === type)?.label ?? "Information";
}

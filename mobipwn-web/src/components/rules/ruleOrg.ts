export const DEFAULT_RULE_REPO = "11111111-1111-1111-1111-111111111101";
export const UNCATEGORIZED_FOLDER = "11111111-1111-1111-1111-111111111201";
export const AMNESTY_FOLDER = "11111111-1111-1111-1111-111111111202";
export const MOBILE_HUNTS_FOLDER = "11111111-1111-1111-1111-111111111203";
export const CVE_FOLDER = "11111111-1111-1111-1111-111111111204";
export const CVE_ANDROID_FOLDER = "11111111-1111-1111-1111-111111111205";
export const CVE_IOS_FOLDER = "11111111-1111-1111-1111-111111111206";

export type RuleRepository = {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  created_at: string;
  rule_count: number;
};

export type RuleFolder = {
  id: string;
  repository_id: string;
  parent_id?: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  rule_count: number;
};

export type RuleOrgBundle = {
  repositories: RuleRepository[];
  folders: RuleFolder[];
};

export type OrgFilter = {
  repositoryId: string | null;
  folderId: string | null;
  tag: string | null;
};

export function parseTagsInput(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i);
}

export function formatTagsInput(tags: string[] | undefined): string {
  return (tags ?? []).join(", ");
}

/** e.g. "CVE / Android" for nested folders in selects and breadcrumbs. */
export function folderPathLabel(folders: RuleFolder[], folderId: string): string {
  const parts: string[] = [];
  let current: RuleFolder | undefined = folders.find((f) => f.id === folderId);
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    parts.unshift(current.name);
    current = current.parent_id
      ? folders.find((f) => f.id === current!.parent_id)
      : undefined;
  }
  return parts.join(" / ");
}

export function childFolders(folders: RuleFolder[], parentId: string | null): RuleFolder[] {
  return folders
    .filter((f) => (f.parent_id ?? null) === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}

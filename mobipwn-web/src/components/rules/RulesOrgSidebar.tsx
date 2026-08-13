import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Library, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OrgFilter, RuleFolder, RuleOrgBundle } from "./ruleOrg";
import { childFolders } from "./ruleOrg";
import { cn } from "@/lib/utils";

const OPEN_REPOS_KEY = "mobipwn-rules-org-open";

function loadOpenRepos(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_REPOS_KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as string[];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveOpenRepos(ids: Set<string>) {
  localStorage.setItem(OPEN_REPOS_KEY, JSON.stringify([...ids]));
}

type Props = {
  bundle: RuleOrgBundle | null;
  filter: OrgFilter;
  allTags: string[];
  totalRules: number;
  loading?: boolean;
  onFilterChange: (next: OrgFilter) => void;
  onCreateFolder: (repositoryId: string, name: string) => Promise<void>;
  onCreateRepository: (name: string) => Promise<void>;
};

export function RulesOrgSidebar({
  bundle,
  filter,
  allTags,
  totalRules,
  loading,
  onFilterChange,
  onCreateFolder,
  onCreateRepository,
}: Props) {
  const [openRepos, setOpenRepos] = useState<Set<string>>(() => loadOpenRepos());

  useEffect(() => {
    if (!filter.repositoryId) return;
    setOpenRepos((prev) => {
      if (prev.has(filter.repositoryId!)) return prev;
      const next = new Set(prev).add(filter.repositoryId!);
      saveOpenRepos(next);
      return next;
    });
  }, [filter.repositoryId]);

  const foldersByRepo = useMemo(() => {
    const map = new Map<string, RuleFolder[]>();
    for (const f of bundle?.folders ?? []) {
      const list = map.get(f.repository_id) ?? [];
      list.push(f);
      map.set(f.repository_id, list);
    }
    return map;
  }, [bundle?.folders]);

  const renderFolderBranch = (repoId: string, folders: RuleFolder[], parentId: string | null, depth = 0) =>
    childFolders(folders, parentId).map((folder) => (
      <div key={folder.id}>
        <button
          type="button"
          className={cn(
            "rules-org-item rules-org-item--folder",
            depth > 0 && "rules-org-item--folder-nested",
            filter.folderId === folder.id && "rules-org-item--active"
          )}
          style={{ paddingLeft: `${0.65 + depth * 0.85}rem` }}
          onClick={() => selectFolder(repoId, folder.id)}
        >
          {filter.folderId === folder.id ? (
            <FolderOpen className="icon rules-org-item-icon" />
          ) : (
            <Folder className="icon rules-org-item-icon" />
          )}
          <span className="rules-org-item-label">{folder.name}</span>
          <span className="rules-org-item-count">{folder.rule_count}</span>
        </button>
        {renderFolderBranch(repoId, folders, folder.id, depth + 1)}
      </div>
    ));

  const toggleRepo = (id: string) => {
    setOpenRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveOpenRepos(next);
      return next;
    });
  };

  const selectAll = () => onFilterChange({ repositoryId: null, folderId: null, tag: filter.tag });

  const selectRepo = (repositoryId: string) => {
    setOpenRepos((prev) => {
      const next = new Set(prev).add(repositoryId);
      saveOpenRepos(next);
      return next;
    });
    onFilterChange({ repositoryId, folderId: null, tag: filter.tag });
  };

  const selectFolder = (repositoryId: string, folderId: string) => {
    setOpenRepos((prev) => {
      const next = new Set(prev).add(repositoryId);
      saveOpenRepos(next);
      return next;
    });
    onFilterChange({ repositoryId, folderId, tag: filter.tag });
  };

  const selectTag = (tag: string | null) => {
    onFilterChange({ ...filter, tag });
  };

  const handleNewFolder = async (repositoryId: string) => {
    const name = window.prompt("New folder name");
    if (!name?.trim()) return;
    await onCreateFolder(repositoryId, name.trim());
  };

  const handleNewRepo = async () => {
    const name = window.prompt("New repository name");
    if (!name?.trim()) return;
    await onCreateRepository(name.trim());
  };

  const activeAll = !filter.repositoryId && !filter.folderId;

  return (
    <aside className="rules-org-sidebar" aria-label="Rule libraries">
      <div className="rules-org-sidebar-head">
        <h2>Libraries</h2>
        <Button variant="ghost" size="sm" className="rules-org-icon-btn" onClick={() => void handleNewRepo()} title="New repository">
          <Plus className="icon" />
        </Button>
      </div>

      <nav className="rules-org-tree">
        <button
          type="button"
          className={cn("rules-org-item", activeAll && "rules-org-item--active")}
          onClick={selectAll}
        >
          <Library className="icon rules-org-item-icon" />
          <span className="rules-org-item-label">All rules</span>
          <span className="rules-org-item-count">{totalRules}</span>
        </button>

        {(bundle?.repositories ?? []).map((repo) => {
          const open = openRepos.has(repo.id);
          const folders = foldersByRepo.get(repo.id) ?? [];
          const repoActive = filter.repositoryId === repo.id && !filter.folderId;
          return (
            <div key={repo.id} className="rules-org-repo">
              <div className="rules-org-repo-row">
                <button
                  type="button"
                  className="rules-org-expand"
                  onClick={() => toggleRepo(repo.id)}
                  aria-expanded={open}
                  aria-label={open ? "Collapse" : "Expand"}
                >
                  <ChevronRight className={cn("icon", open && "rules-org-chevron-open")} />
                </button>
                <button
                  type="button"
                  className={cn("rules-org-item rules-org-item--repo", repoActive && "rules-org-item--active")}
                  onClick={() => selectRepo(repo.id)}
                >
                  <Library className="icon rules-org-item-icon" />
                  <span className="rules-org-item-label">{repo.name}</span>
                  <span className="rules-org-item-count">{repo.rule_count}</span>
                </button>
                <button
                  type="button"
                  className="rules-org-icon-btn"
                  onClick={() => void handleNewFolder(repo.id)}
                  title="New folder"
                >
                  <Plus className="icon" />
                </button>
              </div>
              {open && renderFolderBranch(repo.id, folders, null)}
            </div>
          );
        })}
        {loading && !bundle && <p className="muted rules-org-loading">Loading…</p>}
      </nav>

      {allTags.length > 0 && (
        <div className="rules-org-tags">
          <h3>Tags</h3>
          <div className="rules-org-tag-chips">
            <button
              type="button"
              className={cn("rules-org-tag", !filter.tag && "rules-org-tag--active")}
              onClick={() => selectTag(null)}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={cn("rules-org-tag", filter.tag === tag && "rules-org-tag--active")}
                onClick={() => selectTag(filter.tag === tag ? null : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

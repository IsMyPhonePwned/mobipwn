import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  ORIGIN_FILTER_OPTIONS,
  PLATFORM_FILTER_OPTIONS,
  SORT_OPTIONS,
  STATUS_FILTER_OPTIONS,
  type CaseOrigin,
  type CasePlatform,
  type CaseSortKey,
} from "@/lib/casePresentation";

type Props = {
  q: string;
  ownerFilter: string;
  statusFilter: string;
  originFilter: CaseOrigin | "all";
  platformFilter: CasePlatform | "all";
  sort: CaseSortKey;
  owners: string[];
  loading: boolean;
  onQChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onOriginChange: (value: CaseOrigin | "all") => void;
  onPlatformChange: (value: CasePlatform | "all") => void;
  onSortChange: (value: CaseSortKey) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
};

export function CaseSearchToolbar({
  q,
  ownerFilter,
  statusFilter,
  originFilter,
  platformFilter,
  sort,
  owners,
  loading,
  onQChange,
  onOwnerChange,
  onStatusChange,
  onOriginChange,
  onPlatformChange,
  onSortChange,
  onClearFilters,
  hasActiveFilters,
}: Props) {
  return (
    <section className="card case-search-toolbar">
      <div className="case-search-toolbar__head">
        <SlidersHorizontal size={16} aria-hidden />
        <span className="case-search-toolbar__title">Filters</span>
        {loading && <span className="muted text-xs case-search-toolbar__loading">Updating…</span>}
        {hasActiveFilters && (
          <button type="button" className="link-btn case-search-toolbar__clear" onClick={onClearFilters}>
            Clear all
          </button>
        )}
      </div>

      <div className="case-search-toolbar__grid">
        <label className="case-search-toolbar__field case-search-toolbar__field--search">
          <span className="case-search-toolbar__label">Search</span>
          <div className="case-search-toolbar__search-wrap">
            <Search size={14} className="case-search-toolbar__search-icon" aria-hidden />
            <Input
              value={q}
              onChange={(e) => onQChange(e.target.value)}
              placeholder="Title, ingest source, tags, owner…"
            />
          </div>
        </label>

        <label className="case-search-toolbar__field">
          <span className="case-search-toolbar__label">Device owner</span>
          <select
            value={ownerFilter}
            onChange={(e) => onOwnerChange(e.target.value)}
            className="case-search-toolbar__select"
          >
            <option value="">All owners</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>

        <label className="case-search-toolbar__field">
          <span className="case-search-toolbar__label">Status</span>
          <select
            value={statusFilter}
            onChange={(e) => onStatusChange(e.target.value)}
            className="case-search-toolbar__select"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="case-search-toolbar__field">
          <span className="case-search-toolbar__label">Origin</span>
          <select
            value={originFilter}
            onChange={(e) => onOriginChange(e.target.value as CaseOrigin | "all")}
            className="case-search-toolbar__select"
          >
            {ORIGIN_FILTER_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="case-search-toolbar__field">
          <span className="case-search-toolbar__label">Platform</span>
          <select
            value={platformFilter}
            onChange={(e) => onPlatformChange(e.target.value as CasePlatform | "all")}
            className="case-search-toolbar__select"
          >
            {PLATFORM_FILTER_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="case-search-toolbar__field">
          <span className="case-search-toolbar__label">Sort</span>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as CaseSortKey)}
            className="case-search-toolbar__select"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

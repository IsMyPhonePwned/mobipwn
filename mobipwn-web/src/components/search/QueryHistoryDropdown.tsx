import { useEffect, useRef, useState } from "react";
import { Bookmark, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRelativeCompact } from "@/lib/formatRelative";
import type { SearchHistoryEntry } from "@/hooks/useSearchHistory";
import { cn } from "@/lib/utils";

export type HistorySuggestion = {
  type: "saved" | "history";
  id: string;
  query: string;
  name?: string;
  timestamp?: Date;
};

type Props = {
  open: boolean;
  suggestions: HistorySuggestion[];
  totalCount: number;
  hasMore: boolean;
  selectedIndex: number;
  onSelectedIndexChange: (idx: number) => void;
  onSelect: (query: string) => void;
  onClose: () => void;
  onClear: () => void;
  onLoadMore: () => void;
  historyEnabled: boolean;
  onToggleEnabled: (v: boolean) => void;
  listRef?: React.RefObject<HTMLUListElement | null>;
};

export function QueryHistoryDropdown({
  open,
  suggestions,
  totalCount,
  hasMore,
  selectedIndex,
  onSelectedIndexChange,
  onSelect,
  onClose,
  onClear,
  onLoadMore,
  historyEnabled,
  onToggleEnabled,
  listRef,
}: Props) {
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const innerListRef = useRef<HTMLUListElement>(null);
  const ulRef = listRef ?? innerListRef;

  const filterLower = filter.toLowerCase().trim();
  const filtered = filterLower
    ? suggestions.filter(
        (s) =>
          s.query.toLowerCase().includes(filterLower) ||
          (s.name?.toLowerCase().includes(filterLower) ?? false)
      )
    : suggestions;

  useEffect(() => {
    if (open) {
      setFilter("");
      onSelectedIndexChange(0);
      setTimeout(() => filterRef.current?.focus(), 0);
    }
  }, [open, onSelectedIndexChange]);

  useEffect(() => {
    if (!open || !ulRef.current) return;
    const el = ulRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, open, ulRef]);

  if (!open) return null;

  const pick = (idx: number) => {
    const item = filtered[idx];
    if (!item) return;
    onSelect(item.query.trim());
    onClose();
  };

  return (
    <div className="search-history-dropdown" role="listbox" aria-label="Search history">
      <div className="search-history-dropdown-header">
        <span className="search-history-dropdown-title">Search history</span>
        <span className="search-history-kbd-hints">
          <kbd>↑↓</kbd> navigate · <kbd>↵</kbd> select · <kbd>esc</kbd> close
        </span>
        <button type="button" className="search-history-close" onClick={onClose} aria-label="Close">
          <X className="icon" />
        </button>
      </div>
      <div className="search-history-filter-row">
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            onSelectedIndexChange(0);
          }}
          placeholder="Filter history…"
          className="search-history-filter-input"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              onSelectedIndexChange(Math.min(selectedIndex + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              onSelectedIndexChange(Math.max(selectedIndex - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(selectedIndex);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
      </div>
      <ul className="search-history-list" ref={ulRef}>
        {filtered.length === 0 && (
          <li className="search-history-empty">
            {filter ? `No matches for "${filter}"` : "No history yet — run a search"}
          </li>
        )}
        {filtered.map((item, idx) => (
          <li key={`${item.type}-${item.id}`}>
            <button
              type="button"
              role="option"
              aria-selected={idx === selectedIndex}
              className={cn("search-history-item", idx === selectedIndex && "selected")}
              onMouseEnter={() => onSelectedIndexChange(idx)}
              onClick={() => pick(idx)}
            >
              {item.type === "saved" ? (
                <Bookmark className="search-history-item-icon" />
              ) : (
                <Clock className="search-history-item-icon" />
              )}
              <span className="search-history-item-body">
                {item.name && <span className="search-history-item-name">{item.name}</span>}
                <span className="search-history-item-query">{item.query}</span>
              </span>
              {item.timestamp && (
                <span className="search-history-item-time">
                  {formatRelativeCompact(item.timestamp)}
                </span>
              )}
            </button>
          </li>
        ))}
        {hasMore && !filterLower && (
          <li>
            <button type="button" className="search-history-load-more" onClick={onLoadMore}>
              Load more ({totalCount - suggestions.length} remaining)
            </button>
          </li>
        )}
      </ul>
      <div className="search-history-footer">
        <span>
          {totalCount} {totalCount === 1 ? "entry" : "entries"}
          {hasMore && ` · showing ${suggestions.length}`}
        </span>
        <div className="search-history-footer-actions">
          <Button variant="ghost" size="sm" onClick={() => onToggleEnabled(!historyEnabled)}>
            {historyEnabled ? "Disable" : "Enable"}
          </Button>
          {totalCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear all
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useMemo, useRef, useState } from "react";
import { Clock, History } from "lucide-react";
import { SearchQueryEditor, type SearchQueryEditorRef } from "@/components/editor/SearchQueryEditor";
import {
  QueryHistoryDropdown,
  type HistorySuggestion,
} from "./QueryHistoryDropdown";
import type { SearchHistoryEntry } from "@/hooks/useSearchHistory";

type SavedSuggestion = { id: string; name: string; query: string };

export function SearchQueryInput({
  query,
  onQueryChange,
  onSearch,
  searchHistory,
  savedSearches = [],
  historyEnabled,
  onToggleHistoryEnabled,
  onClearAllHistory,
  onHistorySelect,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  searchHistory: SearchHistoryEntry[];
  savedSearches?: SavedSuggestion[];
  historyEnabled: boolean;
  onToggleHistoryEnabled: (v: boolean) => void;
  onClearAllHistory: () => void;
  /** When set, selecting history runs the query (not just fills the bar). */
  onHistorySelect?: (q: string) => void;
}) {
  const editorRef = useRef<SearchQueryEditorRef>(null);
  const historyListRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(40);

  const { suggestions, totalCount, hasMore } = useMemo(() => {
    const items: HistorySuggestion[] = [];
    for (const s of savedSearches) {
      items.push({ type: "saved", id: s.id, query: s.query, name: s.name });
    }
    for (const h of searchHistory) {
      if (items.some((i) => i.query === h.query)) continue;
      items.push({
        type: "history",
        id: h.id,
        query: h.query,
        timestamp: h.timestamp,
      });
    }
    const total = items.length;
    return {
      suggestions: items.slice(0, historyLimit),
      totalCount: total,
      hasMore: total > historyLimit,
    };
  }, [searchHistory, savedSearches, historyLimit]);

  const applyQuery = useCallback(
    (q: string) => {
      const clean = q.trim();
      if (onHistorySelect) onHistorySelect(clean);
      else onQueryChange(clean);
      setShowHistory(false);
      editorRef.current?.focus();
    },
    [onHistorySelect, onQueryChange]
  );

  const runSearch = useCallback(() => {
    setShowHistory(false);
    onSearch();
  }, [onSearch]);

  const openHistory = useCallback(() => {
    if (suggestions.length > 0 || searchHistory.length > 0 || savedSearches.length > 0) {
      setShowHistory(true);
      setSelectedIndex(0);
    }
  }, [suggestions.length, searchHistory.length, savedSearches.length]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" && !showHistory) {
        const pos = editorRef.current?.getCursorPosition() ?? 0;
        if ((pos === 0 || !query.trim()) && totalCount > 0) {
          openHistory();
          return true;
        }
      }
      if (showHistory && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) {
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey && !(event.metaKey || event.ctrlKey)) {
          const item = suggestions[selectedIndex];
          if (item) {
            applyQuery(item.query);
            return true;
          }
        }
        if (event.key === "Escape") {
          setShowHistory(false);
          return true;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        runSearch();
        return true;
      }
      return false;
    },
    [query, showHistory, totalCount, openHistory, suggestions, selectedIndex, applyQuery, runSearch]
  );

  return (
    <div ref={wrapRef} className="search-query-area">
      <div className="search-query-shell">
        <SearchQueryEditor
          ref={editorRef}
          value={query}
          onChange={onQueryChange}
          placeholder='last 24h platform="android" | timechart span=1h count by parser limit=8'
          onKeyDown={handleKeyDown}
          onSubmit={runSearch}
          onFocus={() => {
            if (!query.trim() && totalCount > 0) openHistory();
          }}
          onBlur={() => {
            setTimeout(() => {
              if (!wrapRef.current?.contains(document.activeElement)) {
                setShowHistory(false);
              }
            }, 160);
          }}
        />
        <div className="search-query-bar">
          <div className="search-query-hints">
            <span>
              <kbd>⌘↵</kbd> run
            </span>
            <span>·</span>
            <span>
              <kbd>↓</kbd> history
            </span>
            <span>·</span>
            <span>
              <kbd>Ctrl</kbd>-<kbd>Space</kbd> fields
            </span>
          </div>
          <button
            type="button"
            className="search-history-toggle"
            onClick={() => (showHistory ? setShowHistory(false) : openHistory())}
            title="Search history"
            aria-expanded={showHistory}
            disabled={totalCount === 0 && searchHistory.length === 0}
          >
            <History className="icon" />
            {searchHistory.length > 0 && (
              <span className="search-history-badge">{searchHistory.length}</span>
            )}
          </button>
        </div>
        <QueryHistoryDropdown
          open={showHistory}
          suggestions={suggestions}
          totalCount={totalCount}
          hasMore={hasMore}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={setSelectedIndex}
          onSelect={applyQuery}
          onClose={() => {
            setShowHistory(false);
            editorRef.current?.focus();
          }}
          onClear={onClearAllHistory}
          onLoadMore={() => setHistoryLimit((n) => n + 20)}
          historyEnabled={historyEnabled}
          onToggleEnabled={onToggleHistoryEnabled}
          listRef={historyListRef}
        />
      </div>
      {searchHistory.length > 0 && !showHistory && (
        <div className="search-recent-strip" aria-label="Recent searches">
          <Clock className="search-recent-strip-icon" />
          {searchHistory.slice(0, 4).map((h) => (
            <button
              key={h.id}
              type="button"
              className="search-recent-chip"
              title={h.query}
              onClick={() => applyQuery(h.query)}
            >
              {h.query.length > 48 ? `${h.query.slice(0, 48)}…` : h.query}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { Search } from "lucide-react";

/** Compact filter input for case dashboard list panels. */
export function CasePanelSearchBar({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={`case-panel-search${className ? ` ${className}` : ""}`}>
      <Search size={14} aria-hidden className="case-panel-search__icon" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="case-panel-search__input"
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
}

/** Case-insensitive substring match against one or more haystacks. */
export function panelSearchMatch(needle: string, ...parts: Array<string | number | null | undefined>): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return parts.some((part) => {
    if (part == null) return false;
    return String(part).toLowerCase().includes(q);
  });
}

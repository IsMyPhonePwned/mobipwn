import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

export type AssigneeUser = {
  id: string;
  username: string;
};

type Props = {
  value: string;
  onChange: (username: string) => void;
  users: AssigneeUser[];
  loading?: boolean;
  placeholder?: string;
  className?: string;
};

export function AssigneePicker({
  value,
  onChange,
  users,
  loading = false,
  placeholder = "Select assignee…",
  className = "",
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const unknownAssignee = value.trim() && !users.some((u) => u.username === value.trim());

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? users.filter((u) => u.username.toLowerCase().includes(q))
      : users;
    return [{ id: "", username: "" }, ...filtered];
  }, [query, users]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const displayValue = open ? query : value;

  const selectOption = (username: string) => {
    onChange(username);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((i) => Math.min(i + 1, options.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = options[activeIndex];
      if (pick) selectOption(pick.username);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={wrapRef} className={`assignee-picker ${open ? "assignee-picker--open" : ""} ${className}`.trim()}>
      <div className="assignee-picker__control">
        <input
          ref={inputRef}
          type="search"
          className="assignee-picker__input alert-detail-input"
          value={displayValue}
          placeholder={value ? value : placeholder}
          disabled={loading}
          onFocus={() => {
            setQuery(value);
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
        />
        {value ? (
          <button
            type="button"
            className="assignee-picker__clear"
            aria-label="Clear assignee"
            onClick={() => {
              onChange("");
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={14} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="assignee-picker__toggle"
            aria-label="Show users"
            onClick={() => {
              setOpen((v) => !v);
              inputRef.current?.focus();
            }}
          >
            <ChevronDown size={14} aria-hidden />
          </button>
        )}
      </div>

      {unknownAssignee && !open && (
        <p className="assignee-picker__hint muted">Current assignee is not a known user.</p>
      )}

      {open && (
        <ul className="assignee-picker__list" role="listbox">
          {options.length === 0 && <li className="assignee-picker__empty muted">No users match.</li>}
          {options.map((opt, idx) => (
            <li key={opt.id || "unassigned"}>
              <button
                type="button"
                role="option"
                aria-selected={idx === activeIndex}
                className={`assignee-picker__option${idx === activeIndex ? " assignee-picker__option--active" : ""}${
                  opt.username === value ? " assignee-picker__option--selected" : ""
                }`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => selectOption(opt.username)}
              >
                {opt.username || "Unassigned"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SEV_META, type SeverityKey } from "./helpers";

export type SevFilter = "all" | SeverityKey;

const SEV_SEGMENTS: Array<{ id: SevFilter; label: string; color?: string }> = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical", color: SEV_META.critical.color },
  { id: "high", label: "High", color: SEV_META.high.color },
  { id: "medium", label: "Medium", color: SEV_META.medium.color },
  { id: "low", label: "Low", color: SEV_META.low.color },
];

export function SegmentedSev({ value, onChange }: { value: SevFilter; onChange: (v: SevFilter) => void }) {
  return (
    <div className="rules-seg-sev" role="group" aria-label="Severity">
      {SEV_SEGMENTS.map((o) => (
        <button
          key={o.id}
          type="button"
          className={cn(value === o.id && "active")}
          onClick={() => onChange(o.id)}
        >
          {o.color && <span className="rules-seg-dot" style={{ background: o.color }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.id === value)?.label ?? "All";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rules-filter-select">
          <span className="rules-filter-select-label">{label}</span>
          <span className="rules-filter-select-value">{current}</span>
          <ChevronDown className="rules-filter-select-chevron" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="rules-filter-select-menu">
        {options.map((o) => (
          <DropdownMenuItem
            key={o.id}
            className={cn(value === o.id && "active")}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

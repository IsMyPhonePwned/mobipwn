import { useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatRangeTrigger,
  parseDatetimeLocal,
  TIME_RANGE_PRESETS,
  toDatetimeLocal,
  type TimeRangeValue,
} from "@/lib/timeRange";
import { cn } from "@/lib/utils";

type DateTimeRangePickerProps = {
  value: TimeRangeValue;
  onChange: (value: TimeRangeValue) => void;
  onPreset?: (minutes: number) => void;
  className?: string;
  disabled?: boolean;
};

export function DateTimeRangePicker({
  value,
  onChange,
  onPreset,
  className,
  disabled,
}: DateTimeRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(value.from);
  const [draftTo, setDraftTo] = useState(value.to);

  const syncDraft = () => {
    setDraftFrom(value.from);
    setDraftTo(value.to);
  };

  const applyCustom = () => {
    onChange({ from: draftFrom, to: draftTo });
    setOpen(false);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) syncDraft();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          className={cn("datetime-range-trigger", className)}
        >
          <Clock className="icon" aria-hidden />
          <span className="datetime-range-label">{formatRangeTrigger(value)}</span>
          <ChevronDown className="icon chevron" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="datetime-range-menu">
        <div className="datetime-range-section-label">Relative</div>
        {TIME_RANGE_PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.label}
            onClick={() => {
              if (onPreset) {
                onPreset(p.minutes);
              } else {
                const to = new Date();
                const from = new Date(to.getTime() - p.minutes * 60 * 1000);
                onChange({ from: toDatetimeLocal(from), to: toDatetimeLocal(to) });
              }
              setOpen(false);
            }}
          >
            Last {p.label}
          </DropdownMenuItem>
        ))}
        <div className="datetime-range-divider" />
        <div className="datetime-range-section-label">Custom</div>
        <div className="datetime-range-custom" onClick={(e) => e.stopPropagation()}>
          <label>
            <span>From</span>
            <input
              type="datetime-local"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="datetime-local"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
            />
          </label>
          <div className="datetime-range-custom-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                !draftFrom ||
                !draftTo ||
                (parseDatetimeLocal(draftFrom)?.getTime() ?? 0) >
                  (parseDatetimeLocal(draftTo)?.getTime() ?? 0)
              }
              onClick={applyCustom}
            >
              Apply
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

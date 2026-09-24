import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { ActivityEntry, LogLevel } from "@/lib/activity-log";

const LEVELS: (LogLevel | "all")[] = ["all", "error", "warn", "info", "debug"];

function levelClass(level: LogLevel): string {
  switch (level) {
    case "error":
      return "log-line--error";
    case "warn":
      return "log-line--warn";
    case "info":
      return "log-line--info";
    default:
      return "";
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function LogLine({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`log-line ${levelClass(entry.level)}`}>
      <button type="button" className="log-line-head" onClick={() => setOpen((v) => !v)}>
        <span className="log-time">{formatTime(entry.ts)}</span>
        <span className="log-level">{entry.level}</span>
        <span className="log-source">{entry.source}</span>
        <span className="log-msg">{entry.message}</span>
        {entry.durationMs != null && <span className="log-meta">{entry.durationMs}ms</span>}
      </button>
      {(entry.level === "error" || open) && entry.detail && (
        <pre className="log-detail mono">{entry.detail}</pre>
      )}
    </div>
  );
}

export function ActivityLogPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { entries, clear, log } = useActivityLog();
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [source, setSource] = useState<"all" | ActivityEntry["source"]>("all");

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (filter !== "all" && e.level !== filter) return false;
        if (source !== "all" && e.source !== source) return false;
        return true;
      }),
    [entries, filter, source]
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="activity-log-sheet w-full max-w-xl sm:max-w-xl"
      >
        <div className="flex items-center justify-between pr-8">
          <h2 className="text-sm font-medium">Activity log</h2>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                log("info", "Clear client activity log");
                clear();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          API requests, app events, and errors from this session. Click a line for details.
        </p>
        <div className="log-filters">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              className={filter === l ? "active" : ""}
              onClick={() => setFilter(l)}
            >
              {l}
            </button>
          ))}
          <span className="log-filter-sep">|</span>
          {(["all", "api", "app", "server"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={source === s ? "active" : ""}
              onClick={() => setSource(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <ScrollArea className="log-scroll mt-2">
          {filtered.length === 0 ? (
            <p className="muted p-4 text-xs">No entries match the filter.</p>
          ) : (
            filtered.map((e) => <LogLine key={e.id} entry={e} />)
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export function ActivityLogButton() {
  const { errorCount, log } = useActivityLog();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          log("info", "Open activity log panel");
          setOpen(true);
        }}
        className={errorCount > 0 ? "log-btn--has-errors" : ""}
      >
        Logs
        {errorCount > 0 && <span className="log-badge">{errorCount}</span>}
      </Button>
      <ActivityLogPanel open={open} onOpenChange={setOpen} />
    </>
  );
}

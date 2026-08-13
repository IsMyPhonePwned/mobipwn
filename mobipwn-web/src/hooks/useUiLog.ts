import { useCallback } from "react";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import type { LogLevel } from "@/lib/activity-log";

/** Log a user-driven UI action (shown on the Logs page under Client activity). */
export function useUiLog() {
  const { log, clear, entries, errorCount } = useActivityLog();

  const action = useCallback(
    (message: string, detail?: string, level: LogLevel = "info") => {
      log(level, message, detail);
    },
    [log]
  );

  return { log: action, clear, entries, errorCount };
}

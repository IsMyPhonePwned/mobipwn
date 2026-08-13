import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearActivityLog,
  countErrors,
  getActivityEntries,
  installFetchLogger,
  pushActivity,
  subscribeActivityLog,
  type ActivityEntry,
  type LogLevel,
} from "@/lib/activity-log";

type ActivityLogContextValue = {
  entries: readonly ActivityEntry[];
  errorCount: number;
  clear: () => void;
  log: (
    level: LogLevel,
    message: string,
    detail?: string
  ) => void;
};

const ActivityLogContext = createContext<ActivityLogContextValue | null>(null);

export function ActivityLogProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    installFetchLogger();
    pushActivity("info", "app", "Activity log started — API calls and errors appear here");
    return subscribeActivityLog(() => setTick((n) => n + 1));
  }, []);

  // Stable callbacks — must not change when `tick` updates or effects that depend on `log` re-fire in a loop.
  const log = useCallback(
    (level: LogLevel, message: string, detail?: string) =>
      pushActivity(level, "app", message, { detail }),
    []
  );

  const clear = useCallback(() => {
    clearActivityLog();
    pushActivity("info", "app", "Activity log cleared");
  }, []);

  const value = useMemo(
    () => ({
      entries: getActivityEntries(),
      errorCount: countErrors(),
      clear,
      log,
    }),
    [tick, clear, log]
  );

  return (
    <ActivityLogContext.Provider value={value}>{children}</ActivityLogContext.Provider>
  );
}

export function useActivityLog() {
  const ctx = useContext(ActivityLogContext);
  if (!ctx) throw new Error("useActivityLog requires ActivityLogProvider");
  return ctx;
}

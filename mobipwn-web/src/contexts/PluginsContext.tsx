import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchPlugins,
  IRONSIFT_PLUGIN_ID,
  COLLECTOR_PLUGIN_ID,
  CASE_COMPARISON_PLUGIN_ID,
  DEVICE_ADVANCED_PLUGIN_ID,
  isPluginRouteEnabled,
  setPluginEnabled,
  type PluginInfo,
} from "@/lib/plugins";

/** When a plugin is missing from the API list, match server `default_enabled` flags. */
const PLUGIN_DEFAULT_ENABLED: Record<string, boolean> = {
  [IRONSIFT_PLUGIN_ID]: true,
  [CASE_COMPARISON_PLUGIN_ID]: true,
  [COLLECTOR_PLUGIN_ID]: false,
  [DEVICE_ADVANCED_PLUGIN_ID]: false,
};

function pluginDefaultEnabled(id: string): boolean {
  return PLUGIN_DEFAULT_ENABLED[id] ?? false;
}

type PluginsContextValue = {
  plugins: PluginInfo[];
  loaded: boolean;
  refresh: () => Promise<void>;
  isEnabled: (id: string) => boolean;
  isRouteEnabled: (path: string) => boolean;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
};

const PluginsContext = createContext<PluginsContextValue | null>(null);

export function PluginsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setPlugins([]);
      setLoaded(true);
      return;
    }
    try {
      setPlugins(await fetchPlugins());
    } catch {
      setPlugins([]);
    } finally {
      setLoaded(true);
    }
  }, [user]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
  }, [refresh]);

  const setEnabled = useCallback(async (id: string, enabled: boolean) => {
    const updated = await setPluginEnabled(id, enabled);
    setPlugins((prev) => prev.map((p) => (p.id === id ? updated : p)));
  }, []);

  const value = useMemo<PluginsContextValue>(
    () => ({
      plugins,
      loaded,
      refresh,
      isEnabled: (id) =>
        plugins.find((p) => p.id === id)?.enabled ?? pluginDefaultEnabled(id),
      isRouteEnabled: (path) => isPluginRouteEnabled(plugins, path),
      setEnabled,
    }),
    [plugins, loaded, refresh, setEnabled]
  );

  return <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>;
}

export function usePlugins() {
  const ctx = useContext(PluginsContext);
  if (!ctx) {
    throw new Error("usePlugins must be used within PluginsProvider");
  }
  return ctx;
}

export function useIronSiftPluginEnabled() {
  const { isEnabled, loaded } = usePlugins();
  return { enabled: isEnabled(IRONSIFT_PLUGIN_ID), loaded };
}

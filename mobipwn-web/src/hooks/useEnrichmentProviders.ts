import { useCallback, useEffect, useMemo, useState } from "react";
import type { EnrichmentProvider } from "@/lib/enrichment";

type Coverage = { coverage_percent?: number };

export function useEnrichmentProviders() {
  const [providers, setProviders] = useState<EnrichmentProvider[]>([]);
  const [coveragePct, setCoveragePct] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, cRes] = await Promise.all([
        fetch("/api/v1/marketplace/providers"),
        fetch("/api/v1/marketplace/coverage"),
      ]);
      if (pRes.ok) setProviders((await pRes.json()) as EnrichmentProvider[]);
      if (cRes.ok) {
        const c = (await cRes.json()) as Coverage;
        setCoveragePct(c.coverage_percent ?? null);
      }
    } catch {
      setProviders([]);
      setCoveragePct(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enabled = useMemo(() => providers.filter((p) => p.enabled), [providers]);
  return { providers, enabled, coveragePct, loading, refresh };
}

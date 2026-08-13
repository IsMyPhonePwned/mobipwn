import { useCallback, useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import type { Validation } from "./RuleEditorPanel";

const PREVIEW_DEBOUNCE_MS = 900;

export function useRulePreview(opts: {
  ruleId: string | null;
  query: string;
  mode: string;
  enabled?: boolean;
  /** When false, only manual `runPreview` triggers fetches (e.g. expanded table row). */
  autoDebounce?: boolean;
}) {
  const { ruleId, query, mode, enabled = true, autoDebounce = false } = opts;
  const [preview, setPreview] = useState<Validation | null>(null);
  const [previewQuery, setPreviewQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const runPreview = useCallback(
    async (q?: string) => {
      const text = (q ?? query).trim();
      if (!text) {
        setPreview(null);
        setPreviewQuery(null);
        setError("");
        return;
      }
      const reqId = ++requestIdRef.current;
      setLoading(true);
      setError("");
      try {
        const path = ruleId ? `/v1/rules/${ruleId}/validate` : "/v1/rules/validate-query";
        const data = await apiPost<Validation>(path, { query: text, mode });
        if (reqId !== requestIdRef.current) return;
        setPreview(data);
        setPreviewQuery(text);
      } catch (e) {
        if (reqId !== requestIdRef.current) return;
        setPreview(null);
        setPreviewQuery(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (reqId === requestIdRef.current) setLoading(false);
      }
    },
    [query, mode, ruleId]
  );

  useEffect(() => {
    if (!enabled || !autoDebounce) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setPreview(null);
      setPreviewQuery(null);
      setError("");
      return;
    }
    if (trimmed === previewQuery) return;
    debounceRef.current = setTimeout(() => {
      void runPreview(trimmed);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, enabled, autoDebounce, previewQuery, runPreview]);

  const clearPreview = useCallback(() => {
    requestIdRef.current += 1;
    setPreview(null);
    setPreviewQuery(null);
    setError("");
    setLoading(false);
  }, []);

  return { preview, previewQuery, loading, error, runPreview, clearPreview };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderSearch } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { CaseSearchRow } from "@/components/cases/CaseSearchRow";
import { CaseSearchToolbar } from "@/components/cases/CaseSearchToolbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { useActivityLog } from "@/contexts/ActivityLogContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch, apiPost } from "@/lib/api";
import { deleteCase, type CaseRecord } from "@/lib/cases";
import {
  countCasesByOrigin,
  matchesOriginFilter,
  matchesPlatformFilter,
  sortCases,
  type CaseOrigin,
  type CasePlatform,
  type CaseSortKey,
} from "@/lib/casePresentation";
import { hasPermission } from "@/lib/permissions";

function isIngestedCase(c: CaseRecord): boolean {
  return (c.tags?.includes("ingested") ?? false) || (c.event_count ?? 0) > 0;
}

function parseOrigin(value: string | null): CaseOrigin | "all" {
  if (value === "collector" || value === "ingest" || value === "endpoint" || value === "demo") {
    return value;
  }
  return "all";
}

function parsePlatform(value: string | null): CasePlatform | "all" {
  if (value === "android" || value === "ios" || value === "endpoint") return value;
  return "all";
}

function parseSort(value: string | null): CaseSortKey {
  if (value === "created" || value === "events" || value === "alerts" || value === "title") {
    return value;
  }
  return "updated";
}

export default function CasesSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");
  const [ownerFilter, setOwnerFilter] = useState(() => searchParams.get("owner") ?? "");
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") ?? "all");
  const [originFilter, setOriginFilter] = useState<CaseOrigin | "all">(() =>
    parseOrigin(searchParams.get("origin"))
  );
  const [platformFilter, setPlatformFilter] = useState<CasePlatform | "all">(() =>
    parsePlatform(searchParams.get("platform"))
  );
  const [sort, setSort] = useState<CaseSortKey>(() => parseSort(searchParams.get("sort")));
  const [owners, setOwners] = useState<string[]>([]);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [showExamples, setShowExamples] = useState(() => searchParams.get("samples") === "1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingUser, setEditingUser] = useState<{ id: string; value: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { log } = useActivityLog();
  const { user } = useAuth();
  const canWriteCases = hasPermission(user, "cases_write");
  const syncingUrl = useRef(false);

  const syncUrl = useCallback(
    (next: {
      q: string;
      owner: string;
      status: string;
      origin: CaseOrigin | "all";
      platform: CasePlatform | "all";
      sort: CaseSortKey;
      samples: boolean;
    }) => {
      syncingUrl.current = true;
      const params = new URLSearchParams();
      if (next.q.trim()) params.set("q", next.q.trim());
      if (next.owner.trim()) params.set("owner", next.owner.trim());
      if (next.status !== "all") params.set("status", next.status);
      if (next.origin !== "all") params.set("origin", next.origin);
      if (next.platform !== "all") params.set("platform", next.platform);
      if (next.sort !== "updated") params.set("sort", next.sort);
      if (next.samples) params.set("samples", "1");
      setSearchParams(params, { replace: true });
      queueMicrotask(() => {
        syncingUrl.current = false;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (syncingUrl.current) return;
    setQ(searchParams.get("q") ?? "");
    setOwnerFilter(searchParams.get("owner") ?? "");
    setStatusFilter(searchParams.get("status") ?? "all");
    setOriginFilter(parseOrigin(searchParams.get("origin")));
    setPlatformFilter(parsePlatform(searchParams.get("platform")));
    setSort(parseSort(searchParams.get("sort")));
    setShowExamples(searchParams.get("samples") === "1");
  }, [searchParams]);

  const ingestedCases = useMemo(
    () => cases.filter((c) => showExamples || isIngestedCase(c)),
    [cases, showExamples]
  );

  const filteredCases = useMemo(() => {
    const filtered = ingestedCases.filter(
      (c) =>
        matchesOriginFilter(c, originFilter) && matchesPlatformFilter(c, platformFilter)
    );
    return sortCases(filtered, sort);
  }, [ingestedCases, originFilter, platformFilter, sort]);

  const originCounts = useMemo(() => countCasesByOrigin(ingestedCases), [ingestedCases]);
  const hiddenDemoCount = cases.length - ingestedCases.length;

  const hasActiveFilters =
    q.trim().length > 0 ||
    ownerFilter.trim().length > 0 ||
    statusFilter !== "all" ||
    originFilter !== "all" ||
    platformFilter !== "all" ||
    sort !== "updated";

  const loadOwners = useCallback(() => {
    apiFetch<string[]>("/v1/cases/owners")
      .then(setOwners)
      .catch(() => setOwners([]));
  }, []);

  const searchSeq = useRef(0);

  const runSearch = useCallback(
    (query: string, owner: string, status: string) => {
      const trimmedQ = query.trim();
      const trimmedOwner = owner.trim();
      const params = new URLSearchParams();
      if (trimmedQ) params.set("q", trimmedQ);
      if (trimmedOwner) params.set("owner", trimmedOwner);
      if (status !== "all") params.set("status", status);
      const qs = params.toString();
      const seq = ++searchSeq.current;

      setLoading(true);
      setError("");
      apiFetch<CaseRecord[]>(`/v1/cases${qs ? `?${qs}` : ""}`)
        .then((list) => {
          if (seq !== searchSeq.current) return;
          setCases(list);
        })
        .catch((e) => {
          if (seq !== searchSeq.current) return;
          setCases([]);
          setError(String(e));
          log("error", "Case search failed", String(e));
        })
        .finally(() => {
          if (seq === searchSeq.current) setLoading(false);
        });
    },
    [log]
  );

  useEffect(() => {
    loadOwners();
  }, [loadOwners]);

  useEffect(() => {
    const t = setTimeout(() => runSearch(q, ownerFilter, statusFilter), 300);
    return () => clearTimeout(t);
  }, [q, ownerFilter, statusFilter, runSearch]);

  useEffect(() => {
    syncUrl({ q, owner: ownerFilter, status: statusFilter, origin: originFilter, platform: platformFilter, sort, samples: showExamples });
  }, [q, ownerFilter, statusFilter, originFilter, platformFilter, sort, showExamples, syncUrl]);

  const refreshAfterEdit = () => {
    loadOwners();
    runSearch(q, ownerFilter, statusFilter);
  };

  const saveOwner = async (caseRec: CaseRecord, owner: string) => {
    log("info", `Update case device owner: ${caseRec.title}`, owner);
    try {
      await apiPost(`/v1/cases/${caseRec.id}`, { user: owner });
      setEditingUser(null);
      refreshAfterEdit();
    } catch (e) {
      setError(String(e));
      log("error", "Update case owner failed", String(e));
    }
  };

  const handleDeleteCase = async (caseRec: CaseRecord) => {
    log("info", `Delete case: ${caseRec.title}`, caseRec.ingest_source || caseRec.id);
    setDeletingId(caseRec.id);
    setError("");
    try {
      await deleteCase(caseRec.id, !!caseRec.ingest_source);
      setCases((prev) => prev.filter((c) => c.id !== caseRec.id));
      if (editingUser?.id === caseRec.id) setEditingUser(null);
      loadOwners();
      log("info", `Deleted case: ${caseRec.title}`);
    } catch (e) {
      setError(String(e));
      log("error", "Delete case failed", String(e));
    } finally {
      setDeletingId(null);
    }
  };

  const clearFilters = () => {
    setQ("");
    setOwnerFilter("");
    setStatusFilter("all");
    setOriginFilter("all");
    setPlatformFilter("all");
    setSort("updated");
  };

  const toggleOriginChip = (origin: CaseOrigin) => {
    setOriginFilter((prev) => (prev === origin ? "all" : origin));
  };

  return (
    <>
      <PageHeader
        title="Case search"
        description={
          <>
            Browse investigation cases with ingest source, platform, and origin (Collector, Ingest,
            Endpoint). Event data lives in <Link to="/data">Data</Link> /{" "}
            <Link to="/search">Search</Link>.
          </>
        }
      />

      <CaseSearchToolbar
        q={q}
        ownerFilter={ownerFilter}
        statusFilter={statusFilter}
        originFilter={originFilter}
        platformFilter={platformFilter}
        sort={sort}
        owners={owners}
        loading={loading}
        onQChange={setQ}
        onOwnerChange={setOwnerFilter}
        onStatusChange={setStatusFilter}
        onOriginChange={setOriginFilter}
        onPlatformChange={setPlatformFilter}
        onSortChange={setSort}
        onClearFilters={clearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {!loading && ingestedCases.length > 0 && (
        <div className="case-search-summary" role="group" aria-label="Cases by origin">
          <span className="case-search-summary__label muted text-xs">
            {filteredCases.length} of {ingestedCases.length} shown
          </span>
          {(Object.keys(originCounts) as CaseOrigin[]).map((origin) => {
            const count = originCounts[origin];
            if (count === 0) return null;
            const active = originFilter === origin;
            return (
              <button
                key={origin}
                type="button"
                className={`case-search-summary__chip case-search-summary__chip--${origin}${active ? " case-search-summary__chip--active" : ""}`}
                onClick={() => toggleOriginChip(origin)}
              >
                {origin === "collector"
                  ? "Collector"
                  : origin === "ingest"
                    ? "Ingest"
                    : origin === "endpoint"
                      ? "Endpoint"
                      : "Sample"}{" "}
                <span className="case-search-summary__count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="error text-sm mb-2">{error}</p>}

      {hiddenDemoCount > 0 && !showExamples && (
        <p className="muted text-sm mb-2">
          Hiding {hiddenDemoCount} sample case{hiddenDemoCount === 1 ? "" : "s"} from dev migrations.{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              log("info", "Show sample cases");
              setShowExamples(true);
            }}
          >
            Show samples
          </button>
        </p>
      )}

      <div className="case-search-list">
        {filteredCases.map((c) => (
          <CaseSearchRow
            key={c.id}
            caseRec={c}
            editingUser={editingUser}
            onStartEditUser={(caseRec) => {
              log("info", `Edit device owner: ${caseRec.title}`);
              setEditingUser({ id: caseRec.id, value: caseRec.user ?? "" });
            }}
            onEditUserChange={(value) =>
              setEditingUser((prev) => (prev ? { ...prev, value } : prev))
            }
            onCancelEditUser={() => setEditingUser(null)}
            onSaveUser={saveOwner}
            onFilterOwner={(owner) => setOwnerFilter(owner)}
            onFilterTag={(tag) => setQ(tag)}
            onCopySource={(source) => log("info", `Copied ingest source: ${source}`)}
            onDelete={canWriteCases ? handleDeleteCase : undefined}
            deleting={deletingId === c.id}
          />
        ))}
        {!loading && filteredCases.length === 0 && (
          <EmptyState
            icon={FolderSearch}
            title="No cases match the current filters"
            description={
              !hasActiveFilters
                ? "After ingest, search for your source label or open Data to browse events."
                : undefined
            }
          >
            {hasActiveFilters ? (
              <Button variant="secondary" size="sm" type="button" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button variant="secondary" size="sm" asChild>
                <Link to="/data">Open Data</Link>
              </Button>
            )}
          </EmptyState>
        )}
      </div>
    </>
  );
}

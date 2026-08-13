import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Anchor, ChevronDown, Loader2, Search, X } from "lucide-react";
import { buildSearchHref } from "@/lib/mplQuery";
import type { CaseEntitiesResponse } from "@/lib/cases";
import { clearCasePrimaryAnchor, setCasePrimaryAnchor } from "@/lib/cases";
import { EntitiesPanel } from "@/components/cases/EntitiesPanel";
import { EntityGraph } from "@/components/cases/EntityGraph";
import { entityTypeColor } from "@/lib/entityColors";
import {
  ENTITY_TYPE_LABELS,
  entitySearchQuery,
} from "@/lib/entitySearch";
import {
  connectedNodeIds,
  entityNodeId,
  entityStats,
  filterCaseEntities,
} from "@/lib/entityFilter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type FlatEntity = {
  entity_type: string;
  entity_value: string;
  occurrence_count: number;
};

type Props = {
  caseId: string;
  data: CaseEntitiesResponse;
  searchScope?: string;
  canWrite?: boolean;
  onEntitiesChange?: (data: CaseEntitiesResponse) => void;
};

export function EntitiesSection({
  caseId,
  data,
  searchScope,
  canWrite = false,
  onEntitiesChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [anchorBusy, setAnchorBusy] = useState(false);
  const [anchorError, setAnchorError] = useState("");

  const filtered = useMemo(
    () => filterCaseEntities(data, query, activeTypes.size > 0 ? activeTypes : null),
    [data, query, activeTypes]
  );

  const stats = useMemo(() => entityStats(data), [data]);
  const filteredStats = useMemo(() => entityStats(filtered), [filtered]);

  const highlightIds = useMemo(
    () => connectedNodeIds(filtered.graph, selectedId),
    [filtered.graph, selectedId]
  );

  const primaryId = data.primary_entity
    ? entityNodeId(data.primary_entity.entity_type, data.primary_entity.entity_value)
    : null;

  const allEntities = useMemo((): FlatEntity[] => {
    const rows: FlatEntity[] = [];
    for (const group of data.entities) {
      for (const entity of group.entities) {
        rows.push({
          entity_type: group.entity_type,
          entity_value: entity.entity_value,
          occurrence_count: entity.occurrence_count,
        });
      }
    }
    rows.sort((a, b) => b.occurrence_count - a.occurrence_count);
    return rows;
  }, [data.entities]);

  const pickerEntities = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return allEntities;
    return allEntities.filter(
      (e) =>
        e.entity_value.toLowerCase().includes(q) ||
        e.entity_type.toLowerCase().includes(q) ||
        (ENTITY_TYPE_LABELS[e.entity_type] ?? "").toLowerCase().includes(q)
    );
  }, [allEntities, pickerQuery]);

  const toggleType = (type: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const applyAnchor = async (entity_type: string, entity_value: string) => {
    setAnchorBusy(true);
    setAnchorError("");
    try {
      const updated = await setCasePrimaryAnchor(caseId, entity_type, entity_value);
      onEntitiesChange?.(updated);
      setPickerOpen(false);
      setPickerQuery("");
    } catch (e) {
      setAnchorError(String(e));
    } finally {
      setAnchorBusy(false);
    }
  };

  const resetAnchor = async () => {
    setAnchorBusy(true);
    setAnchorError("");
    try {
      const updated = await clearCasePrimaryAnchor(caseId);
      onEntitiesChange?.(updated);
      setPickerOpen(false);
    } catch (e) {
      setAnchorError(String(e));
    } finally {
      setAnchorBusy(false);
    }
  };

  if (!data.entities.length) {
    return <p className="muted">No entities extracted from case events yet.</p>;
  }

  const isManual = data.primary_entity_source === "manual";

  return (
    <div className="entities-section">
      <div className="entities-section__stats muted text-xs">
        <span>{stats.entities} entities</span>
        <span>·</span>
        <span>{stats.types} types</span>
        <span>·</span>
        <span>{stats.relationships} relationships</span>
        {(query || activeTypes.size > 0) && (
          <>
            <span>·</span>
            <span>
              showing {filteredStats.entities} / {stats.entities}
            </span>
          </>
        )}
      </div>

      {data.primary_entity && (
        <div className="entities-primary-card">
          <div
            className="entities-primary-card__dot"
            style={{ background: entityTypeColor(data.primary_entity.entity_type) }}
            aria-hidden
          />
          <div className="entities-primary-card__body">
            <div className="entities-primary-card__meta">
              <span className="entities-primary-card__type badge">
                {ENTITY_TYPE_LABELS[data.primary_entity.entity_type] ??
                  data.primary_entity.entity_type}
              </span>
              <span
                className={`entities-primary-card__source badge${
                  isManual ? " entities-primary-card__source--manual" : ""
                }`}
              >
                {isManual ? "Manual anchor" : "Auto-selected"}
              </span>
            </div>
            <strong className="entities-primary-card__value mono">
              {data.primary_entity.entity_value}
            </strong>
            <span className="muted text-xs">Primary investigation anchor</span>
            {isManual && data.auto_primary_entity && (
              <span className="muted text-xs">
                Auto would be{" "}
                <span className="mono">
                  {data.auto_primary_entity.entity_value}
                </span>{" "}
                ({data.auto_primary_entity.entity_type})
              </span>
            )}
          </div>
          <div className="entities-primary-card__actions">
            {canWrite && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={anchorBusy}
                onClick={() => {
                  setPickerOpen((open) => !open);
                  setAnchorError("");
                }}
              >
                <Anchor size={14} aria-hidden />
                Change
                <ChevronDown
                  size={14}
                  aria-hidden
                  className={pickerOpen ? "entities-primary-card__chevron--open" : undefined}
                />
              </Button>
            )}
            <Link
              className="btn btn-secondary btn-sm"
              to={buildSearchHref(
                entitySearchQuery(
                  data.primary_entity.entity_type,
                  data.primary_entity.entity_value,
                  searchScope
                ),
                { run: true }
              )}
            >
              Investigate
            </Link>
          </div>
        </div>
      )}

      {canWrite && pickerOpen && (
        <div className="entities-anchor-picker">
          <div className="entities-anchor-picker__head">
            <strong className="text-sm">Choose investigation anchor</strong>
            <button
              type="button"
              className="entities-anchor-picker__close"
              aria-label="Close anchor picker"
              onClick={() => setPickerOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="entities-anchor-picker__search">
            <Search size={14} aria-hidden />
            <Input
              type="search"
              placeholder="Search entities…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              className="entities-anchor-picker__search-input"
            />
          </div>
          <ul className="entities-anchor-picker__list">
            {pickerEntities.map((entity) => {
              const isCurrent =
                data.primary_entity?.entity_type === entity.entity_type &&
                data.primary_entity?.entity_value === entity.entity_value;
              return (
                <li key={`${entity.entity_type}:${entity.entity_value}`}>
                  <button
                    type="button"
                    className={`entities-anchor-picker__option${isCurrent ? " entities-anchor-picker__option--current" : ""}`}
                    disabled={anchorBusy || isCurrent}
                    onClick={() => void applyAnchor(entity.entity_type, entity.entity_value)}
                  >
                    <span
                      className="entities-anchor-picker__dot"
                      style={{ background: entityTypeColor(entity.entity_type) }}
                      aria-hidden
                    />
                    <span className="entities-anchor-picker__type badge">{entity.entity_type}</span>
                    <span className="entities-anchor-picker__value mono">{entity.entity_value}</span>
                    <span className="muted entities-anchor-picker__count">{entity.occurrence_count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {pickerEntities.length === 0 && (
            <p className="entities-anchor-picker__empty muted text-xs">No entities match your search.</p>
          )}
          {isManual && (
            <div className="entities-anchor-picker__footer">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={anchorBusy}
                onClick={() => void resetAnchor()}
              >
                Reset to automatic
              </Button>
            </div>
          )}
          {anchorBusy && (
            <div className="entities-anchor-picker__busy">
              <Loader2 size={14} className="animate-spin" />
            </div>
          )}
          {anchorError && <p className="error text-xs">{anchorError}</p>}
        </div>
      )}

      <div className="entities-section__toolbar">
        <div className="entities-section__search">
          <Search size={14} aria-hidden className="entities-section__search-icon" />
          <Input
            type="search"
            placeholder="Filter entities…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="entities-section__search-input"
          />
        </div>
        <div className="entities-section__types" role="group" aria-label="Entity types">
          {data.entities.map((g) => {
            const active = activeTypes.size === 0 || activeTypes.has(g.entity_type);
            const color = entityTypeColor(g.entity_type);
            return (
              <button
                key={g.entity_type}
                type="button"
                className={`entities-type-chip${active ? "" : " entities-type-chip--off"}`}
                onClick={() => toggleType(g.entity_type)}
              >
                <span className="entities-type-chip__dot" style={{ background: color }} />
                {ENTITY_TYPE_LABELS[g.entity_type] ?? g.entity_type}
                <span className="entities-type-chip__count">{g.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="case-detail-entities__layout">
        <div className="case-detail-entities__list">
          <EntitiesPanel
            data={filtered}
            searchScope={searchScope}
            selectedId={selectedId}
            onSelect={setSelectedId}
            hidePrimaryBanner
            canSetAnchor={canWrite}
            onSetAnchor={(entity_type, entity_value) => void applyAnchor(entity_type, entity_value)}
          />
        </div>
        {filtered.graph.nodes.length > 0 && (
          <div className="case-detail-entities__graph">
            <EntityGraph
              graph={filtered.graph}
              primaryEntityId={primaryId}
              searchScope={searchScope}
              selectedId={selectedId}
              highlightIds={highlightIds}
              onSelect={setSelectedId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { Anchor, ExternalLink, Star } from "lucide-react";
import { buildSearchHref } from "@/lib/mplQuery";
import type { CaseEntitiesResponse } from "@/lib/cases";
import { entityTypeColor } from "@/lib/entityColors";
import { ENTITY_TYPE_LABELS, entitySearchQuery } from "@/lib/entitySearch";
import { entityNodeId } from "@/lib/entityFilter";

type Props = {
  data: CaseEntitiesResponse;
  searchScope?: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  hidePrimaryBanner?: boolean;
  canSetAnchor?: boolean;
  onSetAnchor?: (entityType: string, entityValue: string) => void;
};

export function EntitiesPanel({
  data,
  searchScope,
  selectedId = null,
  onSelect,
  hidePrimaryBanner = false,
  canSetAnchor = false,
  onSetAnchor,
}: Props) {
  if (!data.entities.length) {
    return <p className="muted text-xs">No entities match the current filter.</p>;
  }

  return (
    <div className="entities-panel">
      {!hidePrimaryBanner && data.primary_entity && (
        <p className="muted text-xs" style={{ marginBottom: 12 }}>
          Primary entity:{" "}
          <strong>{data.primary_entity.entity_value}</strong>{" "}
          <span className="badge">{data.primary_entity.entity_type}</span>
        </p>
      )}
      {data.entities.map((group) => (
        <details key={group.entity_type} className="entities-group" open>
          <summary>
            <span
              className="entities-group__dot"
              style={{ background: entityTypeColor(group.entity_type) }}
              aria-hidden
            />
            {ENTITY_TYPE_LABELS[group.entity_type] ?? group.entity_type}
            <span className="entities-group__count">{group.count}</span>
          </summary>
          <ul className="entities-list">
            {group.entities.map((e) => {
              const id = entityNodeId(group.entity_type, e.entity_value);
              const selected = selectedId === id;
              const searchHref = buildSearchHref(
                entitySearchQuery(group.entity_type, e.entity_value, searchScope),
                { run: true }
              );
              return (
                <li key={id} className="entities-list-item">
                  <button
                    type="button"
                    className={`entities-link${selected ? " entities-link--selected" : ""}`}
                    title="Highlight in graph"
                    onClick={() => onSelect?.(selected ? null : id)}
                  >
                    {e.is_primary && (
                      <Star size={12} aria-label="Primary entity" className="entities-primary-icon" />
                    )}
                    <span className="entities-link__type badge">{group.entity_type}</span>
                    <span className="mono entities-link__value">{e.entity_value}</span>
                    <span className="muted entities-link__count">{e.occurrence_count}</span>
                  </button>
                  <Link
                    to={searchHref}
                    className="entities-link-search"
                    title="Open search for this entity"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <ExternalLink size={12} aria-hidden />
                  </Link>
                  {canSetAnchor && onSetAnchor && !e.is_primary && (
                    <button
                      type="button"
                      className="entities-set-anchor"
                      title="Set as investigation anchor"
                      aria-label={`Set ${e.entity_value} as investigation anchor`}
                      onClick={() => onSetAnchor(group.entity_type, e.entity_value)}
                    >
                      <Anchor size={12} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </div>
  );
}

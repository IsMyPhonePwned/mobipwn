import type { CaseWallEntry } from "@/lib/cases";
import {
  caseNoteTypeLabel,
  normalizeCaseNoteType,
  type CaseNoteType,
} from "@/lib/caseNoteTypes";
import { formatRelativeCompact, formatWallTimestamp } from "@/lib/formatRelative";
import {
  WALL_ACTION_ICONS,
  WALL_ACTION_LABELS,
  WALL_ACTION_TONE,
} from "@/components/cases/caseWallMeta";

function commentNoteType(e: CaseWallEntry): CaseNoteType {
  return normalizeCaseNoteType(e.note_type);
}

function entryBody(e: CaseWallEntry): string {
  if (e.action === "comment") {
    return e.notes ?? e.message;
  }
  return e.message;
}

export function CaseWall({
  entries,
  variant = "list",
}: {
  entries: CaseWallEntry[];
  variant?: "list" | "timeline";
}) {
  if (entries.length === 0) {
    return (
      <p className="muted case-wall-empty">
        No activity yet. Post a note, link alerts, or change case status to build the timeline.
      </p>
    );
  }

  if (variant === "timeline") {
    return (
      <ol className="case-wall-timeline">
        {entries.map((e) => {
          const isComment = e.action === "comment";
          const noteType = isComment ? commentNoteType(e) : null;
          const tone = isComment ? `note-${noteType}` : (WALL_ACTION_TONE[e.action] ?? "system");
          const Icon = WALL_ACTION_ICONS[e.action];
          return (
            <li
              key={e.id}
              className={`case-wall-timeline__item case-wall-timeline__item--${tone}`}
            >
              <span className="case-wall-timeline__marker" aria-hidden>
                {Icon ? <Icon size={14} /> : <span className="case-wall-timeline__dot" />}
              </span>
              <div className="case-wall-timeline__content">
                <div className="case-wall-timeline__meta">
                  <span className="case-wall-timeline__action">
                    {WALL_ACTION_LABELS[e.action] ?? e.action}
                  </span>
                  {noteType && (
                    <span className={`case-note-type-badge case-note-type-badge--${noteType}`}>
                      {caseNoteTypeLabel(noteType)}
                    </span>
                  )}
                  <time className="mono muted text-xs" title={e.timestamp}>
                    {formatRelativeCompact(new Date(e.timestamp))}
                  </time>
                </div>
                <p
                  className={`case-wall-timeline__message${isComment ? ` case-wall-timeline__message--comment case-wall-timeline__message--note-${noteType}` : ""}`}
                >
                  {entryBody(e)}
                </p>
                {(e.actor_name || isComment) && (
                  <p className="case-wall-timeline__actor muted text-xs">
                    {e.actor_name && <>By {e.actor_name}</>}
                    {isComment && (
                      <>
                        {e.actor_name && " · "}
                        <time className="mono" dateTime={e.timestamp}>
                          {formatWallTimestamp(e.timestamp)}
                        </time>
                      </>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol className="case-wall">
      {entries.map((e) => {
        const isComment = e.action === "comment";
        const noteType = isComment ? commentNoteType(e) : null;
        return (
          <li
            key={e.id}
            className={`case-wall-entry${isComment ? ` case-wall-entry--comment case-wall-entry--note-${noteType}` : ""}`}
          >
            <div className="case-wall-meta">
              <span className="case-wall-action">{WALL_ACTION_LABELS[e.action] ?? e.action}</span>
              {noteType && (
                <span className={`case-note-type-badge case-note-type-badge--${noteType}`}>
                  {caseNoteTypeLabel(noteType)}
                </span>
              )}
              <time className="mono muted">{e.timestamp.slice(0, 19).replace("T", " ")}</time>
            </div>
            <p
              className={`case-wall-message${isComment ? ` case-wall-message--comment case-wall-message--note-${noteType}` : ""}`}
            >
              {entryBody(e)}
            </p>
            <div className="case-wall-details muted text-xs">
              {e.actor_name && <span>By {e.actor_name}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

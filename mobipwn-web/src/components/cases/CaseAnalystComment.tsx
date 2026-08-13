import { useState } from "react";
import { Button } from "@/components/ui/button";
import { addCaseComment, type CaseWallEntry } from "@/lib/cases";
import {
  CASE_NOTE_TYPES,
  DEFAULT_CASE_NOTE_TYPE,
  type CaseNoteType,
} from "@/lib/caseNoteTypes";

export function CaseAnalystComment({
  caseId,
  onCommentAdded,
}: {
  caseId: string;
  onCommentAdded?: (entry: CaseWallEntry) => void;
}) {
  const [draft, setDraft] = useState("");
  const [noteType, setNoteType] = useState<CaseNoteType>(DEFAULT_CASE_NOTE_TYPE);
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");

  const submitComment = async () => {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    setCommentError("");
    try {
      const entry = await addCaseComment(caseId, body, noteType);
      setDraft("");
      setNoteType(DEFAULT_CASE_NOTE_TYPE);
      onCommentAdded?.(entry);
    } catch (e) {
      setCommentError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="case-wall-compose">
      <div
        className="case-note-type-picker"
        role="radiogroup"
        aria-label="Note importance"
      >
        {CASE_NOTE_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={noteType === t.id}
            className={`case-note-type-picker__btn case-note-type-picker__btn--${t.id}${noteType === t.id ? " case-note-type-picker__btn--active" : ""}`}
            onClick={() => setNoteType(t.id)}
            disabled={submitting}
          >
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        id={`case-comment-${caseId}`}
        className={`case-wall-compose__input case-wall-compose__input--${noteType}`}
        rows={3}
        placeholder="Document findings, next steps, or context for other analysts…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={submitting}
        aria-label="Analyst note"
      />
      <div className="case-wall-compose__actions">
        <span className="muted text-xs case-wall-compose__hint">
          Visible on the case activity timeline
        </span>
        <Button
          type="button"
          size="sm"
          disabled={submitting || !draft.trim()}
          onClick={() => void submitComment()}
        >
          {submitting ? "Posting…" : "Post note"}
        </Button>
      </div>
      {commentError && <p className="error text-xs case-wall-compose__error">{commentError}</p>}
    </div>
  );
}

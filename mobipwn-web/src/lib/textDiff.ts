import { diffChars, diffWordsWithSpace, type Change } from "diff";

export type DiffSpanKind = "unchanged" | "removed" | "added";

export type DiffSpan = {
  kind: DiffSpanKind;
  text: string;
};

export type InlineQueryDiff = {
  before: DiffSpan[];
  after: DiffSpan[];
};

export function buildQueryInlineDiff(before: string, after: string): InlineQueryDiff {
  const parts = refineAdjacentChanges(
    diffWordsWithSpace(normalizeDiffText(before), normalizeDiffText(after))
  );
  return partsToBeforeAfter(parts);
}

export function diffHasChanges(diff: InlineQueryDiff): boolean {
  return (
    diff.before.some((span) => span.kind !== "unchanged") ||
    diff.after.some((span) => span.kind !== "unchanged")
  );
}

/** Focus the diff on changed tokens with a little surrounding context. */
export function trimDiffSpans(
  before: DiffSpan[],
  after: DiffSpan[],
  contextChars = 28
): InlineQueryDiff {
  const changedBefore = before.some((span) => span.kind !== "unchanged");
  const changedAfter = after.some((span) => span.kind !== "unchanged");
  if (!changedBefore && !changedAfter) return { before, after };

  const first = Math.min(
    before.findIndex((span) => span.kind !== "unchanged"),
    after.findIndex((span) => span.kind !== "unchanged")
  );
  const lastBefore = findLastChangedIndex(before);
  const lastAfter = findLastChangedIndex(after);
  const last = Math.max(lastBefore, lastAfter);
  if (first < 0 || last < 0) return { before, after };

  return {
    before: trimSide(before, first, last, contextChars),
    after: trimSide(after, first, last, contextChars),
  };
}

function normalizeDiffText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Re-diff adjacent removed/added chunks at character level for small edits. */
function refineAdjacentChanges(parts: Change[]): Change[] {
  const out: Change[] = [];
  let i = 0;
  while (i < parts.length) {
    const cur = parts[i]!;
    const next = parts[i + 1];
    if (cur.removed && next?.added) {
      out.push(...diffChars(cur.value, next.value));
      i += 2;
      continue;
    }
    out.push(cur);
    i += 1;
  }
  return out;
}

function partsToBeforeAfter(parts: Change[]): InlineQueryDiff {
  const before: DiffSpan[] = [];
  const after: DiffSpan[] = [];

  for (const part of parts) {
    if (part.removed) {
      before.push({ kind: "removed", text: part.value });
    } else if (part.added) {
      after.push({ kind: "added", text: part.value });
    } else {
      before.push({ kind: "unchanged", text: part.value });
      after.push({ kind: "unchanged", text: part.value });
    }
  }

  return { before, after };
}

function findLastChangedIndex(spans: DiffSpan[]): number {
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    if (spans[i]?.kind !== "unchanged") return i;
  }
  return -1;
}

function trimSide(spans: DiffSpan[], first: number, last: number, contextChars: number): DiffSpan[] {
  const out: DiffSpan[] = [];
  let prefix = "";
  let suffix = "";

  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i]!;
    if (i < first) {
      if (span.kind === "unchanged") {
        prefix += span.text;
      } else {
        out.push(span);
      }
      continue;
    }
    if (i > last) {
      if (span.kind === "unchanged") {
        suffix += span.text;
      } else {
        out.push(span);
      }
      continue;
    }
    out.push(span);
  }

  const prefixTail = tailChars(prefix, contextChars);
  const suffixHead = headChars(suffix, contextChars);
  const trimmed: DiffSpan[] = [];

  if (prefix.length > prefixTail.length) {
    trimmed.push({ kind: "unchanged", text: "…" });
  }
  if (prefixTail) {
    trimmed.push({ kind: "unchanged", text: prefixTail });
  }
  trimmed.push(...out);
  if (suffixHead) {
    trimmed.push({ kind: "unchanged", text: suffixHead });
  }
  if (suffix.length > suffixHead.length) {
    trimmed.push({ kind: "unchanged", text: "…" });
  }

  return trimmed;
}

function tailChars(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(-max);
}

function headChars(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

export type MplTokenKind =
  | "time"
  | "pipe"
  | "command"
  | "keyword"
  | "field"
  | "string"
  | "operator"
  | "wildcard"
  | "text";

export type MplToken = { kind: MplTokenKind; value: string };

const COMMANDS = new Set([
  "where",
  "stats",
  "head",
  "sort",
  "eval",
  "dedup",
  "rex",
  "join",
  "fields",
  "timechart",
  "rename",
  "lookup",
  "count",
  "by",
  "span",
  "limit",
  "type",
  "inner",
  "left",
  "useother",
  "field",
  "IN",
  "NOT",
  "AND",
  "OR",
  "AS",
]);

const TIME_RE = /^(?:@timestamp\s+)?(?:last|now-\d+[mhdw](?:\s+|$))/i;

/** Lightweight mPL syntax coloring for guide examples. */
export function tokenizeMplQuery(query: string): MplToken[] {
  const tokens: MplToken[] = [];
  let i = 0;
  let atStart = true;

  while (i < query.length) {
    const rest = query.slice(i);

    if (/^\s+/.test(rest)) {
      const m = rest.match(/^\s+/)!;
      tokens.push({ kind: "text", value: m[0] });
      i += m[0].length;
      continue;
    }

    if (atStart) {
      const tm = rest.match(TIME_RE);
      if (tm) {
        tokens.push({ kind: "time", value: tm[0] });
        i += tm[0].length;
        atStart = false;
        continue;
      }
    }

    if (rest[0] === "|") {
      tokens.push({ kind: "pipe", value: "|" });
      i += 1;
      atStart = false;
      continue;
    }

    const strMatch = rest.match(/^"[^"]*"|^'[^']*'/);
    if (strMatch) {
      tokens.push({ kind: "string", value: strMatch[0] });
      i += strMatch[0].length;
      atStart = false;
      continue;
    }

    const wordMatch = rest.match(/^[a-zA-Z_][a-zA-Z0-9_.]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      const lower = word.toLowerCase();
      const after = rest.slice(word.length);
      const isField = /^[=!<>]/.test(after) || word.includes(".");
      if (COMMANDS.has(word) || COMMANDS.has(lower)) {
        tokens.push({
          kind: word === "IN" || lower === "in" ? "keyword" : "command",
          value: word,
        });
      } else if (isField) {
        tokens.push({ kind: "field", value: word });
      } else {
        tokens.push({ kind: "text", value: word });
      }
      i += word.length;
      atStart = false;
      continue;
    }

    const opMatch = rest.match(/^!=|^[<>]=?|^=/);
    if (opMatch) {
      tokens.push({ kind: "operator", value: opMatch[0] });
      i += opMatch[0].length;
      continue;
    }

    if (rest[0] === "*" || rest[0] === "?") {
      tokens.push({ kind: "wildcard", value: rest[0] });
      i += 1;
      continue;
    }

    if (rest[0] === "!" && rest[1] !== "=") {
      tokens.push({ kind: "operator", value: "!" });
      i += 1;
      continue;
    }

    if (/^[()[\],]/.test(rest)) {
      tokens.push({ kind: "text", value: rest[0] });
      i += 1;
      continue;
    }

    tokens.push({ kind: "text", value: rest[0] });
    i += 1;
    atStart = false;
  }

  return tokens;
}

import { COMMAND_PARAMS, EVAL_FUNCTIONS, PIPE_COMMANDS } from "@/lib/mpl-tokens";
import { MUDM_COLUMNS } from "@/lib/mpl-fields";

export type AutocompleteOption = {
  value: string;
  description?: string;
  context?: "command" | "field" | "keyword";
};

export function getMplAutocomplete(doc: string, pos: number): {
  from: number;
  options: AutocompleteOption[];
  context: string | null;
} {
  const before = doc.slice(0, pos);
  const afterPipe = before.lastIndexOf("|");
  const segment = afterPipe >= 0 ? before.slice(afterPipe + 1) : before;
  const trimmed = segment.trimStart();
  const wordMatch = before.match(/[\w.]+$/);
  const from = wordMatch ? pos - wordMatch[0].length : pos;
  const word = (wordMatch?.[0] ?? "").toLowerCase();

  if (afterPipe >= 0 && trimmed.length === 0) {
    return {
      from: pos,
      options: PIPE_COMMANDS.map((c) => ({ value: c, context: "command" as const })),
      context: "command",
    };
  }

  if (afterPipe >= 0) {
    const cmd = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!cmd || (PIPE_COMMANDS as readonly string[]).includes(cmd)) {
      const options = PIPE_COMMANDS.filter((c) => !word || c.startsWith(word)).map((c) => ({
        value: c,
        context: "command" as const,
      }));
      if (options.length) return { from, options, context: "command" };
    }
    const params = COMMAND_PARAMS.filter((p) => !word || p.startsWith(word)).map((p) => ({
      value: p,
      description: "parameter",
      context: "field" as const,
    }));
    if (params.length && /\s/.test(trimmed)) {
      return { from, options: params, context: "field" };
    }
  }

  const fields = [...MUDM_COLUMNS].filter((f) => !word || f.toLowerCase().startsWith(word));
  if (fields.length) {
    return {
      from,
      options: fields.map((f) => ({ value: f, context: "field" as const })),
      context: "field",
    };
  }

  const kws = ["AND", "OR", "NOT", "last"].filter((k) => !word || k.toLowerCase().startsWith(word));
  if (kws.length) {
    return {
      from,
      options: kws.map((k) => ({ value: k, context: "keyword" as const })),
      context: "keyword",
    };
  }

  const fns = EVAL_FUNCTIONS.filter((f) => !word || f.startsWith(word)).map((f) => ({
    value: f,
    context: "command" as const,
  }));
  if (fns.length) return { from, options: fns, context: "command" };

  return { from, options: [], context: null };
}

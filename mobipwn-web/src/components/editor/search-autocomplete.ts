import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { getMplAutocomplete } from "@/lib/mpl-autocomplete";

function toResult(
  from: number,
  options: ReturnType<typeof getMplAutocomplete>["options"],
  doc: string
): CompletionResult {
  const completions: Completion[] = options.map((opt, i) => {
    const c: Completion = {
      label: opt.value,
      detail: opt.description,
      boost: options.length - i,
      type: opt.context === "command" ? "function" : opt.context === "field" ? "property" : "keyword",
    };
    if (opt.context === "field" && from > 0 && doc[from - 1] !== '"') {
      c.apply = `"${opt.value}"`;
    }
    return c;
  });
  return { from, options: completions, validFor: /^[\w.]*$/ };
}

async function mplAutocomplete(context: CompletionContext): Promise<CompletionResult | null> {
  const doc = context.state.doc.toString();
  const { from, options, context: ctx } = getMplAutocomplete(doc, context.pos);
  if (options.length === 0) return null;
  if (ctx === "command" && doc[context.pos - 1] === "|") {
    return toResult(context.pos, options, doc);
  }
  return toResult(from, options, doc);
}

export function searchAutocomplete(activateOnTyping = true): Extension {
  return autocompletion({
    override: [mplAutocomplete],
    activateOnTyping,
    defaultKeymap: true,
  });
}

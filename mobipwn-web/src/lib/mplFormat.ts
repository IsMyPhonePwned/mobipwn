import { splitSearchAndPipeline } from "@/lib/mplQuery";

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Split pipeline stages on `|` outside double-quoted strings. */
export function splitMplPipelineStages(pipeline: string): string[] {
  const stages: string[] = [];
  let stage = "";
  let inQuote = false;

  for (let i = 0; i < pipeline.length; i++) {
    const c = pipeline[i];
    if (c === '"' && pipeline[i - 1] !== "\\") {
      inQuote = !inQuote;
      stage += c;
      continue;
    }
    if (!inQuote && c === "|") {
      const trimmed = stage.trim().replace(/^\|+/, "").trim();
      if (trimmed) stages.push(trimmed);
      stage = "";
      continue;
    }
    stage += c;
  }

  const tail = stage.trim().replace(/^\|+/, "").trim();
  if (tail) stages.push(tail);
  return stages;
}

export function parseMplQueryStructure(query: string): {
  search: string;
  stages: string[];
} {
  const trimmed = query.trim();
  if (!trimmed) return { search: "", stages: [] };
  const { search, pipeline } = splitSearchAndPipeline(trimmed);
  return {
    search: normalizeWhitespace(search),
    stages: pipeline ? splitMplPipelineStages(pipeline).map(normalizeWhitespace) : [],
  };
}

/** Pretty-print mPL: search on first line, each pipeline stage on its own line. */
export function formatMplQuery(query: string): string {
  const { search, stages } = parseMplQueryStructure(query);
  if (!search && stages.length === 0) return "";
  if (stages.length === 0) return search;
  return [search, ...stages.map((stage) => `| ${stage}`)].join("\n");
}

/** Collapse formatted mPL back to a single line. */
export function compactMplQuery(query: string): string {
  const { search, stages } = parseMplQueryStructure(query);
  if (!search && stages.length === 0) return "";
  if (stages.length === 0) return search;
  return `${search} ${stages.map((stage) => `| ${stage}`).join(" ")}`;
}

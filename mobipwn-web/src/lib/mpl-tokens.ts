export const QUERY_KEYWORDS = ["AND", "OR", "NOT", "IN", "LIKE"] as const;

/** Pipe commands supported by mobipwn-search */
export const PIPE_COMMANDS = [
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
  "count",
  "by",
] as const;

export const COMMAND_PARAMS = [
  "span",
  "limit",
  "as",
  "field",
  "type",
  "inner",
  "left",
  "last",
] as const;

export const EVAL_FUNCTIONS = ["if", "case", "coalesce", "now", "len", "lower", "upper"] as const;

export const PIPE_COMMANDS_SET = new Set<string>(PIPE_COMMANDS);
export const COMMAND_PARAMS_SET = new Set<string>(COMMAND_PARAMS);
export const EVAL_FUNCTIONS_SET = new Set<string>([
  ...EVAL_FUNCTIONS,
  ...EVAL_FUNCTIONS.map((f) => f.toLowerCase()),
]);

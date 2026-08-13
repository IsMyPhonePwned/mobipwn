import { StreamLanguage, StringStream } from "@codemirror/language";
import { tags, Tag } from "@lezer/highlight";
import { MUDM_COLUMNS } from "@/lib/mpl-fields";
import {
  COMMAND_PARAMS_SET,
  EVAL_FUNCTIONS_SET,
  PIPE_COMMANDS_SET,
} from "@/lib/mpl-tokens";

const FIELD_NAMES = new Set<string>(MUDM_COLUMNS);

export function registerDynamicFields(fields: string[]) {
  for (const f of fields) FIELD_NAMES.add(f);
}

interface MplState {
  afterRegexOp: boolean;
  inBlockComment: boolean;
}

const mplDefinition = {
  name: "mpl",
  startState: (): MplState => ({ afterRegexOp: false, inBlockComment: false }),
  copyState: (s: MplState): MplState => ({ ...s }),

  token(stream: StringStream, state: MplState): string | null {
    if (state.inBlockComment) {
      if (stream.match(/.*?\*\//)) {
        state.inBlockComment = false;
        return "blockComment";
      }
      stream.skipToEnd();
      return "blockComment";
    }
    if (stream.match(/^\/\*/)) {
      if (stream.match(/.*?\*\//)) return "blockComment";
      state.inBlockComment = true;
      return "blockComment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/.*/)) return "lineComment";

    if (state.afterRegexOp && stream.peek() === "/") {
      if (stream.match(/^\/(?:[^/\\\n]|\\.)+\/[igmsuy]*/)) {
        state.afterRegexOp = false;
        return "regexp";
      }
    }
    if (stream.match(/^=~|^~/)) {
      state.afterRegexOp = true;
      return "operator";
    }
    if (stream.match(/^!=|^>=|^<=|^=|^>|^</)) {
      state.afterRegexOp = stream.current().endsWith("=");
      return "operator";
    }
    if (stream.match(/^\|/)) {
      state.afterRegexOp = false;
      return "separator";
    }
    if (stream.match(/^\*[^*\s]+\*/)) return "string";
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^(AND|OR|NOT|IN|LIKE|last)\b/i)) return "keyword";
    if (stream.match(/^(true|false)\b/i)) return "bool";
    if (stream.match(/^\d+[hdms]\b/i)) return "number";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";

    const start = stream.pos;
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
      const word = stream.string.slice(start, stream.pos);
      const lower = word.toLowerCase();
      if (PIPE_COMMANDS_SET.has(lower)) return "function(variableName)";
      if (COMMAND_PARAMS_SET.has(lower)) return "propertyName";
      if (EVAL_FUNCTIONS_SET.has(word) || EVAL_FUNCTIONS_SET.has(lower)) return "function(variableName)";
      if (FIELD_NAMES.has(word)) return "special(propertyName)";
      return "variableName";
    }
    if (stream.match(/^[+\-*\/%]/)) return "arithmeticOperator";
    if (stream.match(/^[()[\]{}]/)) return "punctuation";
    if (stream.match(/^[,:]/)) return "punctuation";
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
  },
};

const tokenTable: Record<string, Tag> = {
  lineComment: tags.lineComment,
  blockComment: tags.blockComment,
  string: tags.string,
  regexp: tags.regexp,
  keyword: tags.keyword,
  bool: tags.bool,
  number: tags.number,
  "function(variableName)": tags.function(tags.variableName),
  propertyName: tags.propertyName,
  "special(propertyName)": tags.special(tags.propertyName),
  variableName: tags.variableName,
  operator: tags.operator,
  arithmeticOperator: tags.arithmeticOperator,
  separator: tags.separator,
  punctuation: tags.punctuation,
};

export const mplLanguage = StreamLanguage.define({ ...mplDefinition, tokenTable });

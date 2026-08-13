import { StreamLanguage, StringStream } from "@codemirror/language";
import { tags, Tag } from "@lezer/highlight";

const YARA_KEYWORDS = new Set([
  "rule",
  "meta",
  "strings",
  "condition",
  "private",
  "global",
  "import",
  "include",
  "and",
  "or",
  "not",
  "any",
  "all",
  "of",
  "them",
  "for",
  "in",
  "at",
  "filesize",
  "entrypoint",
  "int8",
  "int16",
  "int32",
  "int8be",
  "int16be",
  "int32be",
  "uint8",
  "uint16",
  "uint32",
  "uint8be",
  "uint16be",
  "uint32be",
  "float",
  "double",
  "ascii",
  "wide",
  "nocase",
  "fullword",
  "base64",
  "base64wide",
  "xor",
  "defined",
  "true",
  "false",
]);

interface YaraState {
  inBlockComment: boolean;
}

const yaraDefinition = {
  name: "yara",
  startState: (): YaraState => ({ inBlockComment: false }),
  copyState: (s: YaraState): YaraState => ({ ...s }),

  token(stream: StringStream, state: YaraState): string | null {
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

    if (stream.match(/^"([^"\\]|\\.)*"/)) return "string";
    if (stream.match(/^\/(?:[^/\\\n]|\\.)+\/[ims]*/)) return "regexp";
    if (stream.match(/^\{[\da-fA-F\s]+\}/)) return "string";
    if (stream.match(/^\$\w+/)) return "variableName";
    if (stream.match(/^#[A-Za-z_]\w*/)) return "variableName";
    if (stream.match(/^@\w+/)) return "variableName";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";

    const start = stream.pos;
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.string.slice(start, stream.pos);
      const lower = word.toLowerCase();
      if (YARA_KEYWORDS.has(lower)) return "keyword";
      return "identifier";
    }
    if (stream.match(/^[()[\]{}:]/)) return "punctuation";
    if (stream.match(/^[=<>!&|+-]/)) return "operator";
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
  number: tags.number,
  variableName: tags.special(tags.variableName),
  identifier: tags.propertyName,
  punctuation: tags.punctuation,
  operator: tags.operator,
};

export const yaraLanguage = StreamLanguage.define({ ...yaraDefinition, tokenTable });

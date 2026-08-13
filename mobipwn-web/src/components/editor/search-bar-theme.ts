import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const searchBarTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    fontFamily: "var(--font-mono)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", maxHeight: "inherit" },
  ".cm-content": {
    padding: "8px 12px",
    caretColor: "var(--foreground)",
    minHeight: "44px",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
  },
  ".cm-line": { lineHeight: "20px", padding: "0" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-gutters": { display: "none" },
});

export const searchBarSyntaxTheme = HighlightStyle.define([
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.lineComment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.blockComment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.number, color: "var(--syntax-number)" },
  { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: tags.function(tags.variableName), color: "var(--syntax-function)", fontWeight: "500" },
  { tag: tags.operator, color: "var(--syntax-operator)" },
  { tag: tags.separator, color: "var(--syntax-pipe)", fontWeight: "700" },
  { tag: tags.regexp, color: "var(--syntax-regex)" },
  { tag: tags.propertyName, color: "var(--syntax-field)" },
  { tag: tags.special(tags.propertyName), color: "var(--syntax-udm-field)", fontWeight: "600" },
  { tag: tags.variableName, color: "var(--foreground)" },
  { tag: tags.bool, color: "var(--syntax-keyword)", fontWeight: "600" },
]);

export const searchBarExtensions = [searchBarTheme, syntaxHighlighting(searchBarSyntaxTheme)];

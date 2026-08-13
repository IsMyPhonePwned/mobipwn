import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const yaraEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    backgroundColor: "var(--background)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-content": {
    padding: "10px 0",
    caretColor: "var(--foreground)",
    minHeight: "200px",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
  },
  ".cm-line": { lineHeight: "1.5", padding: "0 12px 0 4px" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-gutters": {
    backgroundColor: "color-mix(in srgb, var(--muted) 30%, var(--background))",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--primary) 8%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--primary) 5%, transparent)",
  },
});

export const yaraSyntaxTheme = HighlightStyle.define([
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.lineComment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.blockComment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.string, color: "var(--syntax-string)" },
  { tag: tags.regexp, color: "var(--syntax-regex)" },
  { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
  { tag: tags.number, color: "var(--syntax-number)" },
  { tag: tags.special(tags.variableName), color: "var(--syntax-function)", fontWeight: "500" },
  { tag: tags.propertyName, color: "var(--syntax-field)" },
  { tag: tags.operator, color: "var(--syntax-operator)" },
  { tag: tags.punctuation, color: "var(--muted-foreground)" },
]);

export const yaraEditorExtensions = [yaraEditorTheme, syntaxHighlighting(yaraSyntaxTheme)];

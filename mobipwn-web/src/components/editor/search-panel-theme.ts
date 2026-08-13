import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const searchPanelTheme = EditorView.theme({
  "&": {
    fontSize: "14px",
    fontFamily: "var(--font-mono)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", maxHeight: "inherit" },
  ".cm-content": {
    padding: "10px 0",
    caretColor: "var(--foreground)",
    minHeight: "100%",
  },
  ".cm-cursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "2px" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary) 30%, transparent)",
  },
  ".cm-line": { lineHeight: "1.6", padding: "0 4px 0 2px" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-gutters": {
    display: "flex",
    backgroundColor: "color-mix(in srgb, var(--card-2) 80%, transparent)",
    borderRight: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
    color: "var(--muted-foreground)",
    minWidth: "2.25rem",
  },
  ".cm-gutterElement": {
    padding: "0 8px 0 6px",
    fontSize: "0.75rem",
    lineHeight: "1.6",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--primary) 8%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--primary) 5%, transparent)",
  },
});

export const searchPanelExtensions = [
  searchPanelTheme,
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
      { tag: tags.lineComment, color: "var(--syntax-comment)", fontStyle: "italic" },
      { tag: tags.blockComment, color: "var(--syntax-comment)", fontStyle: "italic" },
      { tag: tags.string, color: "var(--syntax-string)" },
      { tag: tags.number, color: "var(--syntax-number)" },
      { tag: tags.keyword, color: "var(--syntax-keyword)", fontWeight: "600" },
      { tag: tags.function(tags.variableName), color: "var(--syntax-function)", fontWeight: "600" },
      { tag: tags.operator, color: "var(--syntax-operator)" },
      { tag: tags.separator, color: "var(--syntax-pipe)", fontWeight: "700" },
      { tag: tags.regexp, color: "var(--syntax-regex)" },
      { tag: tags.propertyName, color: "var(--syntax-field)" },
      { tag: tags.special(tags.propertyName), color: "var(--syntax-udm-field)", fontWeight: "600" },
      { tag: tags.variableName, color: "var(--foreground)" },
      { tag: tags.bool, color: "var(--syntax-keyword)", fontWeight: "600" },
    ])
  ),
];

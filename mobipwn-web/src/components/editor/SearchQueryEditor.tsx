import {
  useRef,
  useEffect,
  useImperativeHandle,
  useCallback,
  useLayoutEffect,
  type Ref,
} from "react";
import { Compartment, EditorState, Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { cn } from "@/lib/utils";
import { mplLanguage } from "./mpl-language";
import { searchAutocomplete } from "./search-autocomplete";
import { searchBarExtensions } from "./search-bar-theme";
import { searchPanelExtensions } from "./search-panel-theme";

export interface CursorCoords {
  x: number;
  y: number;
  lineHeight: number;
}

export interface SearchQueryEditorRef {
  focus: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getCursorPosition: () => number;
}

export interface SearchQueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onKeyDown?: (event: KeyboardEvent, view: EditorView) => boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onSubmit?: () => void;
  autocomplete?: boolean;
  /** compact = search bar (max 200px); panel = rule editor (fills parent) */
  variant?: "compact" | "panel";
  ref?: Ref<SearchQueryEditorRef>;
}

export function SearchQueryEditor({
  value,
  onChange,
  placeholder = "",
  onKeyDown,
  onFocus,
  onBlur,
  onSubmit,
  autocomplete = true,
  variant = "compact",
  ref,
}: SearchQueryEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const autocompleteCompartment = useRef(new Compartment());
  const internal = useRef(false);
  const callbacks = useRef({ onChange, onKeyDown, onFocus, onBlur, onSubmit });

  useLayoutEffect(() => {
    callbacks.current = { onChange, onKeyDown, onFocus, onBlur, onSubmit };
  });

  const customKeymap = useCallback(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              callbacks.current.onSubmit?.();
              return true;
            },
          },
          {
            key: "Enter",
            run: (view) => {
              const ev = new KeyboardEvent("keydown", { key: "Enter", shiftKey: false });
              if (callbacks.current.onKeyDown?.(ev, view)) return true;
              return false;
            },
          },
          {
            key: "ArrowDown",
            run: (view) => {
              const ev = new KeyboardEvent("keydown", { key: "ArrowDown" });
              return callbacks.current.onKeyDown?.(ev, view) ?? false;
            },
          },
          {
            key: "ArrowUp",
            run: (view) => {
              const ev = new KeyboardEvent("keydown", { key: "ArrowUp" });
              return callbacks.current.onKeyDown?.(ev, view) ?? false;
            },
          },
          {
            key: "Escape",
            run: (view) => {
              const ev = new KeyboardEvent("keydown", { key: "Escape" });
              return callbacks.current.onKeyDown?.(ev, view) ?? false;
            },
          },
        ])
      ),
    []
  );

  const getExtensions = useCallback((): Extension[] => {
    const chrome = variant === "panel" ? searchPanelExtensions : searchBarExtensions;
    return [
      customKeymap(),
      history(),
      bracketMatching(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      mplLanguage,
      ...chrome,
      placeholder ? placeholderExt(placeholder) : [],
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !internal.current) {
          callbacks.current.onChange(update.state.doc.toString());
        }
      }),
      EditorView.domEventHandlers({
        focus: () => {
          callbacks.current.onFocus?.();
          return false;
        },
        blur: () => {
          setTimeout(() => callbacks.current.onBlur?.(), 150);
          return false;
        },
      }),
      EditorView.lineWrapping,
      autocompleteCompartment.current.of(autocomplete ? searchAutocomplete(true) : []),
    ];
  }, [placeholder, customKeymap, autocomplete, variant]);

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({ doc: value, extensions: getExtensions() });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== value) {
      internal.current = true;
      view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
      internal.current = false;
    }
  }, [value]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      getValue: () => viewRef.current?.state.doc.toString() ?? "",
      setValue: (v: string) => {
        const view = viewRef.current;
        if (!view) return;
        internal.current = true;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
        internal.current = false;
      },
      getCursorPosition: () => viewRef.current?.state.selection.main.head ?? 0,
    }),
    []
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        variant === "panel"
          ? "search-query-editor-panel h-full min-h-0 flex-1"
          : "min-h-[44px] max-h-[200px] overflow-hidden"
      )}
    />
  );
}

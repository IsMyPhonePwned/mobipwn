import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, placeholder as placeholderExt, highlightActiveLine, highlightActiveLineGutter } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { cn } from "@/lib/utils";
import { yaraLanguage } from "./yara-language";
import { yaraEditorExtensions } from "./yara-editor-theme";

export interface YaraRuleEditorRef {
  focus: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
}

export interface YaraRuleEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ref?: Ref<YaraRuleEditorRef>;
}

export function YaraRuleEditor({
  value,
  onChange,
  disabled = false,
  placeholder = "rule example {\n  meta:\n    description = \"…\"\n  strings:\n    $a = \"text\"\n  condition:\n    $a\n}",
  ref,
}: YaraRuleEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const internal = useRef(false);
  const callbacks = useRef({ onChange });

  useLayoutEffect(() => {
    callbacks.current = { onChange };
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          bracketMatching(),
          yaraLanguage,
          ...yaraEditorExtensions,
          placeholderExt(placeholder),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          readOnlyCompartment.current.of(EditorState.readOnly.of(disabled)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !internal.current) {
              callbacks.current.onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      internal.current = true;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
      internal.current = false;
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(disabled)),
    });
  }, [disabled]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      getValue: () => viewRef.current?.state.doc.toString() ?? value,
      setValue: (next: string) => {
        const view = viewRef.current;
        if (!view) return;
        internal.current = true;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
        });
        internal.current = false;
      },
    }),
    [value]
  );

  const onContainerClick = useCallback(() => {
    viewRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn("yara-rule-editor", disabled && "yara-rule-editor--disabled")}
      onClick={onContainerClick}
      role="textbox"
      aria-multiline="true"
    />
  );
}

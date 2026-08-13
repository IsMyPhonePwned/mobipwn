import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RULE_EDITOR_SECTION_THEME, type RuleEditorSectionTheme } from "./ruleEditorMeta";

export function RuleEditorSection({
  theme,
  icon: Icon,
  title,
  hint,
  children,
}: {
  theme: RuleEditorSectionTheme;
  icon: LucideIcon;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const meta = RULE_EDITOR_SECTION_THEME[theme];

  return (
    <section
      className="rules-editor-section"
      data-editor-section={theme}
      style={{ "--rules-editor-accent": meta.accent } as React.CSSProperties}
    >
      <header className="rules-editor-section__header">
        <span className="rules-editor-section__icon" aria-hidden>
          <Icon size={15} />
        </span>
        <div className="rules-editor-section__titles">
          <h3 className="rules-editor-section__title">{title}</h3>
          {hint ? <p className="rules-editor-section__hint">{hint}</p> : null}
        </div>
      </header>
      <div className="rules-editor-section__body">{children}</div>
    </section>
  );
}

export function RuleEditorField({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`rules-editor-field rules-editor-field--card${wide ? " rules-editor-field--wide" : ""}`}>
      <span className="rules-editor-field__label">{label}</span>
      {hint ? <span className="rules-editor-field__hint">{hint}</span> : null}
      {children}
    </label>
  );
}

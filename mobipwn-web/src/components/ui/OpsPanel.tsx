import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type OpsPanelTheme = "cyan" | "blue" | "purple" | "green" | "orange" | "teal" | "yellow";

export function OpsPanel({
  theme = "blue",
  icon: Icon,
  title,
  hint,
  actions,
  children,
  className,
  id,
}: {
  theme?: OpsPanelTheme;
  icon?: LucideIcon;
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`ops-panel ops-panel--${theme}${className ? ` ${className}` : ""}`}
    >
      <header className="ops-panel__header">
        <div className="ops-panel__head-main">
          {Icon ? (
            <span className="ops-panel__icon" aria-hidden>
              <Icon size={15} />
            </span>
          ) : null}
          <div className="ops-panel__titles">
            <h2 className="ops-panel__title">{title}</h2>
            {hint ? <p className="ops-panel__hint muted">{hint}</p> : null}
          </div>
        </div>
        {actions ? <div className="ops-panel__actions">{actions}</div> : null}
      </header>
      <div className="ops-panel__body">{children}</div>
    </section>
  );
}

import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ops-page-header">
      <div className="ops-page-header__main">
        <h1 className="ops-page-header__title">{title}</h1>
        {description ? <p className="ops-page-header__desc">{description}</p> : null}
        {meta ? <div className="ops-page-header__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="ops-page-header__actions">{actions}</div> : null}
    </header>
  );
}

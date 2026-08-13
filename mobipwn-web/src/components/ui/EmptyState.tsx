import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="ops-empty">
      {Icon ? <Icon className="ops-empty__icon" aria-hidden /> : null}
      <p className="ops-empty__title">{title}</p>
      {description ? <p className="ops-empty__desc muted">{description}</p> : null}
      {children ? <div className="ops-empty__actions">{children}</div> : null}
    </div>
  );
}

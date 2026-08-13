import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";

type Variant = "primary" | "secondary" | "ghost" | "danger";

function iconClass(variant: Variant): string {
  return `alert-action-icon-btn alert-action-icon-btn--${variant}`;
}

type ButtonProps = {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: Variant;
  children: ReactNode;
};

export function AlertActionIconButton({
  title,
  onClick,
  disabled,
  variant = "ghost",
  children,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={iconClass(variant)}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type LinkProps = {
  title: string;
  to: string;
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
};

export function AlertActionIconLink({ title, to, onClick, children }: LinkProps) {
  return (
    <Link
      to={to}
      className={iconClass("ghost")}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

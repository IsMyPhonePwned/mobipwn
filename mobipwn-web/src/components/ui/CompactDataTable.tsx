import type { ReactNode, TableHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = TableHTMLAttributes<HTMLTableElement> & {
  wrapClassName?: string;
  children: ReactNode;
};

/** Compact, responsive data table — pairs with `.ops-compact-table` styles in app-layout.css */
export function CompactDataTable({ className, wrapClassName, children, ...props }: Props) {
  return (
    <div className={cn("compact-data-table-wrap", wrapClassName)}>
      <table className={cn("data-table ops-compact-table", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

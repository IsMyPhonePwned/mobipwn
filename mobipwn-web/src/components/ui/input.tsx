import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-8 w-full rounded-[var(--radius-sm)] border border-[var(--input-border)] bg-[var(--input)] px-3 py-1 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

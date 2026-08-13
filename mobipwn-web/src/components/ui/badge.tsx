import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[var(--radius-sm)] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "border-[var(--border-2)] text-[var(--muted-foreground)]",
        new: "border-[color-mix(in_srgb,var(--accent-yellow)_40%,transparent)] text-[var(--accent-yellow)]",
        triaged: "border-[color-mix(in_srgb,var(--accent-cyan)_40%,transparent)] text-[var(--accent-cyan)]",
        resolved: "border-[color-mix(in_srgb,var(--accent-green)_40%,transparent)] text-[var(--accent-green)]",
        ai: "border-[color-mix(in_srgb,var(--accent-purple)_40%,transparent)] text-[var(--accent-purple)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

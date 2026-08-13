import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[color-mix(in_srgb,var(--primary)_18%,var(--card-2))] text-[var(--primary)] border border-[color-mix(in_srgb,var(--primary)_35%,var(--border-2))] hover:bg-[color-mix(in_srgb,var(--primary)_28%,var(--card-2))]",
        secondary:
          "bg-[var(--card-2)] text-[var(--foreground)] border border-[var(--border-2)] hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--card-2))] hover:border-[color-mix(in_srgb,var(--primary)_30%,var(--border-2))]",
        ghost:
          "text-[var(--muted-foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_8%,var(--card))] hover:text-[var(--foreground)]",
        outline:
          "border border-[var(--border-2)] bg-transparent hover:bg-[color-mix(in_srgb,var(--foreground)_8%,var(--card-2))]",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 px-2 text-[11px]",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

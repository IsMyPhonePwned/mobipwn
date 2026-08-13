import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "right" | "left" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <SheetPrimitive.Content
        className={cn(
          "fixed z-50 flex h-full flex-col gap-4 border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg transition ease-in-out",
          side === "right" ? "inset-y-0 right-0 w-full max-w-md" : "inset-y-0 left-0 w-full max-w-md",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-3 top-3 rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type Props = {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel?: string;
};

export function RuleCheckbox({ checked, indeterminate, onChange, ariaLabel }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className="rules-chk" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <span className={cn("rules-chk-box", (checked || indeterminate) && "on")} />
    </label>
  );
}

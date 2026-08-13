import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BANDS, RULE_TABLE_COLUMN_COUNT } from "./helpers";

type BandMeta = (typeof BANDS)[number];

type Props = {
  band: BandMeta;
  count: number;
  open: boolean;
  onToggle: () => void;
};

export function BandHeader({ band, count, open, onToggle }: Props) {
  return (
    <tr className="rules-band-header" data-band={band.id} onClick={onToggle}>
      <td colSpan={RULE_TABLE_COLUMN_COUNT}>
        <div className="rules-band-header-inner">
          <ChevronRight className={cn("rules-band-chevron", open && "open")} />
          <span className="rules-band-dot" style={{ background: band.accent }} />
          <span className="rules-band-label">{band.label}</span>
          <span className="rules-band-count">{count}</span>
          <span className="rules-band-hint">{band.hint}</span>
        </div>
      </td>
    </tr>
  );
}

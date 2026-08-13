import { CheckCircle2, MinusCircle, Trash2, X } from "lucide-react";

type Props = {
  count: number;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onClear: () => void;
  disabled?: boolean;
};

export function BulkActionBar({ count, onEnable, onDisable, onDelete, onClear, disabled }: Props) {
  return (
    <div className="rules-bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span className="rules-bulk-count">{count} selected</span>
      <div className="rules-bulk-actions">
        <button type="button" className="rules-bulk-btn" onClick={onEnable} disabled={disabled}>
          <CheckCircle2 className="icon" />
          Enable
        </button>
        <button type="button" className="rules-bulk-btn" onClick={onDisable} disabled={disabled}>
          <MinusCircle className="icon" />
          Disable
        </button>
        <button type="button" className="rules-bulk-btn rules-bulk-btn--danger" onClick={onDelete} disabled={disabled}>
          <Trash2 className="icon" />
          Delete
        </button>
      </div>
      <button type="button" className="rules-bulk-clear" onClick={onClear} aria-label="Clear selection">
        <X className="icon" />
      </button>
    </div>
  );
}

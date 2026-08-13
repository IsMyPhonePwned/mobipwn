import { SearchQueryEditor } from "./SearchQueryEditor";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
};

/** Syntax-highlighted mPL editor (CodeMirror) for rule queries. */
export function MplQueryEditor({ value, onChange, placeholder, minHeight = 280 }: Props) {
  return (
    <div className="mpl-query-editor mpl-query-editor--panel" style={{ minHeight }}>
      <SearchQueryEditor
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? 'source="case-001" process_name=* | head 50'}
        autocomplete
        variant="panel"
      />
    </div>
  );
}

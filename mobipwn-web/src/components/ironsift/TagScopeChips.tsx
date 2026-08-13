import { parseTagInput } from "@/lib/ironsift";

function toggleTag(current: string, tag: string): string {
  const tags = parseTagInput(current);
  const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
  return next.join(", ");
}

type Props = {
  knownTags: string[];
  selectedTags: string;
  onChange: (value: string) => void;
};

export function TagScopeChips({ knownTags, selectedTags, onChange }: Props) {
  if (knownTags.length === 0) return null;

  const active = new Set(parseTagInput(selectedTags));

  return (
    <div className="ironsift-tag-chips" role="group" aria-label="Known tags">
      {knownTags.map((tag) => {
        const on = active.has(tag);
        return (
          <button
            key={tag}
            type="button"
            className={`ironsift-tag-chip${on ? " ironsift-tag-chip--active" : ""}`}
            aria-pressed={on}
            onClick={() => onChange(toggleTag(selectedTags, tag))}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

type PrevalenceSliderProps = {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
};

/** 0–100: lower = show rarer artifacts only (nano-style toolbar control). */
export function PrevalenceSlider({ value, onChange, disabled }: PrevalenceSliderProps) {
  return (
    <label className="prevalence-slider" title="Max prevalence % — lower surfaces rarer artifacts in Rarity view">
      <span className="prevalence-slider-label">Rarity ≤</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="prevalence-slider-val">{value}%</span>
    </label>
  );
}

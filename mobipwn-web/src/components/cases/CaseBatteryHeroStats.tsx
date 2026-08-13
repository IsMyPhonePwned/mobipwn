import type { BatteryHeroStats } from "@/lib/batteryPanel";

export function CaseBatteryHeroStats({ stats }: { stats: BatteryHeroStats }) {
  const items = [
    stats.designCapacity !== "—" ? { label: "Design", value: stats.designCapacity } : null,
    stats.temperature !== "—" ? { label: "Temp", value: stats.temperature } : null,
    stats.voltage !== "—" ? { label: "Voltage", value: stats.voltage } : null,
    stats.amperage !== "—" ? { label: "Current", value: stats.amperage } : null,
    stats.plug !== "—" ? { label: "Plug", value: stats.plug } : null,
    stats.health !== "—" ? { label: "Health", value: stats.health } : null,
  ].filter((item): item is { label: string; value: string } => item != null);

  if (!items.length) return null;

  return (
    <div className="case-battery-panel__hero-stats">
      {items.map((item) => (
        <span key={item.label} className="case-battery-panel__hero-stat">
          <span className="case-battery-panel__hero-stat-label">{item.label}</span>
          <strong className="case-battery-panel__hero-stat-value mono">{item.value}</strong>
        </span>
      ))}
    </div>
  );
}

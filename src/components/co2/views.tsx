/** Sustainability & CO₂ (Phase 51) — badges (server component). */
import { Factory, Leaf, MapPin, Recycle } from "lucide-react";

const ICON = { LOW_CO2: Leaf, LOCAL: MapPin, ECO_PACKAGING: Recycle } as const;
export function Co2Chips({ badges, l, kgText }: { badges: string[]; l: Record<string, string>; kgText?: string | null }) {
  if (!badges.length && !kgText) return null;
  return (
    <div className="flex flex-wrap gap-1" data-testid="co2-badges">
      {badges.map((b) => {
        const I = ICON[b as keyof typeof ICON] ?? Leaf;
        return <span key={b} className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--vivid-teal)_14%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[color:color-mix(in_oklch,var(--vivid-teal)_75%,var(--foreground))]" data-testid={`co2-badge-${b}`}><I className="size-3" aria-hidden />{l[`badge.${b}`]}</span>;
      })}
      {kgText && <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground" data-testid="co2-kg"><Factory className="size-3" aria-hidden />{kgText}</span>}
    </div>
  );
}

/** Shop filter chips: all / low CO₂ / local / eco packaging (keeps the other filters in the link). */
export function EcoFilter({ base, params, active, l }: { base: string; params: Record<string, string | string[] | null | undefined>; active: string | null; l: Record<string, string> }) {
  const href = (eco: string | null) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : v ? [v] : []) q.append(k, x);
    if (eco) q.set("eco", eco);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const opts: [string | null, string][] = [[null, l.filterAll], ["LOW_CO2", l["badge.LOW_CO2"]], ["LOCAL", l["badge.LOCAL"]], ["ECO_PACKAGING", l["badge.ECO_PACKAGING"]]];
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-xs" aria-label={l.filterLabel} data-testid="eco-filter">
      <span className="text-muted-foreground">{l.filterLabel}:</span>
      {opts.map(([v, label]) => <a key={v ?? "all"} href={href(v)} className={`rounded-full border px-2.5 py-1 ${active === v ? "border-[color:var(--vivid-teal)] bg-[color-mix(in_oklch,var(--vivid-teal)_14%,transparent)]" : "hover:bg-muted"}`} data-testid={`eco-${v ?? "all"}`}>{label}</a>)}
    </nav>
  );
}

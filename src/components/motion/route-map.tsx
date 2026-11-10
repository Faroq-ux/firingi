/**
 * Stylised live map of routes (no map tiles): depot, stops, the road travelled (solid) and
 * still to go (flowing dashes), and a vehicle at its current position with a comet moving
 * along the rest of the route. Colours are decorative per route; stops say done / to do.
 */
import { fitProjection, smoothPath, type LL } from "@/lib/map-projection";

export type MapRoute = {
  id: string; label: string; href?: string;
  start: LL | null;
  stops: (LL & { done: boolean; kind: "PICKUP" | "DROP" })[];
};
const COLORS = ["var(--vivid-blue)", "var(--vivid-pink)", "var(--vivid-teal)", "var(--vivid-orange)", "var(--vivid-violet)", "var(--vivid-lime)"];

export function RouteMap({ routes, height = 300, label, legend = { depot: "depot", done: "done", todo: "to do" } }: { routes: MapRoute[]; height?: number; label: string; legend?: { depot: string; done: string; todo: string } }) {
  const W = 800, H = height;
  const all: LL[] = routes.flatMap((r) => [...(r.start ? [r.start] : []), ...r.stops]);
  const { project, empty } = fitProjection(all, W, H, 30);
  return (
    <div className="relative overflow-hidden rounded-xl border bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--vivid-blue)_14%,var(--card)),var(--card)_70%)]" data-testid="route-map">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={label}>
        <defs>
          <pattern id="mapgrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--chart-grid)" strokeWidth="1" /></pattern>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width={W} height={H} fill="url(#mapgrid)" />
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--muted-foreground)" fontSize="16">—</text>}
        {routes.map((r, ri) => {
          const color = COLORS[ri % COLORS.length];
          const pts = [...(r.start ? [{ ...r.start, done: true, kind: "START" as const }] : []), ...r.stops].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
          const xy = pts.map((p) => project(p));
          const lastDone = Math.max(0, pts.map((p) => p.done).lastIndexOf(true));
          const travelled = smoothPath(xy.slice(0, lastDone + 1));
          const ahead = smoothPath(xy.slice(lastDone));
          const here = xy[lastDone];
          return (
            <g key={r.id} className="motion-rise" style={{ ["--i" as string]: ri }}>
              {xy.length > 1 && <path d={travelled} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" opacity="0.9" />}
              {xy.length > 1 && lastDone < xy.length - 1 && (
                <>
                  <path d={ahead} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.25" />
                  <path d={ahead} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" className="motion-flow" />
                  <circle r="5" fill={color} filter="url(#glow)" className="motion-smil">
                    <animateMotion dur={`${Math.max(4, (xy.length - lastDone) * 1.6)}s`} repeatCount="indefinite" path={ahead} />
                  </circle>
                </>
              )}
              {pts.map((p, i) => {
                const { x, y } = xy[i];
                if (p.kind === "START") return <rect key={i} x={x - 7} y={y - 7} width="14" height="14" rx="3" fill="var(--foreground)" stroke="var(--card)" strokeWidth="2"><title>{`${r.label} · ${legend.depot}`}</title></rect>;
                return (
                  <circle key={i} cx={x} cy={y} r={p.kind === "PICKUP" ? 5 : 6.5} fill={p.done ? color : "var(--card)"} stroke={color} strokeWidth="2.5">
                    <title>{`${r.label} · ${i}${p.done ? ` · ${legend.done}` : ` · ${legend.todo}`}`}</title>
                  </circle>
                );
              })}
              {here && (
                <g transform={`translate(${here.x},${here.y})`}>
                  <circle r="14" fill={color} opacity="0.25" className="motion-ping" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
                  <circle r="8" fill={color} stroke="white" strokeWidth="2.5" filter="url(#glow)" />
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {routes.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2 text-xs" aria-label={label}>
          {routes.map((r, i) => (
            <li key={r.id} className="flex items-center gap-1.5">
              <span className="inline-block h-1 w-5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} aria-hidden />
              {r.href ? <a className="hover:underline" href={r.href}>{r.label}</a> : r.label}
            </li>
          ))}
          <li className="ml-auto flex items-center gap-3 text-muted-foreground"><span>■ {legend.depot}</span><span>● {legend.done}</span><span>○ {legend.todo}</span></li>
        </ul>
      )}
    </div>
  );
}

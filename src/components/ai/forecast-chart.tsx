/** History (solid) + forecast (dashed) for one product; draws itself in. Server-rendered. */
export function ForecastSpark({ history, forecast, label, height = 44, className = "" }: { history: number[]; forecast: number[]; label: string; height?: number; className?: string }) {
  const values = [...history, ...forecast];
  const w = 200, h = height, pad = 4;
  const max = Math.max(1, ...values);
  const x = (i: number) => pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const path = (from: number, to: number) => values.slice(from, to + 1).map((v, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const split = history.length - 1;
  return (
    <div className={`relative ${className}`} style={{ height }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <line x1={x(split)} x2={x(split)} y1={0} y2={h} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        {history.length > 1 && <path d={path(0, split)} pathLength={1} fill="none" stroke="var(--vivid-blue)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="motion-draw" />}
        {forecast.length > 0 && <path d={path(split, values.length - 1)} fill="none" stroke="var(--vivid-violet)" strokeWidth={2} strokeDasharray="4 3" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="motion-fade-late" />}
        {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={6} fill="transparent"><title>{`${i < history.length ? `Week −${history.length - i}` : `Week +${i - split}`}: ${v}`}</title></circle>)}
      </svg>
    </div>
  );
}

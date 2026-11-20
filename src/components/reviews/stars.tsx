/** Star rating display (Phase 53) — works in server and client components. Partial stars are drawn with a clip. */
import { Star } from "lucide-react";

export function Stars({ value, size = 16, label, className = "" }: { value: number; size?: number; label?: string; className?: string }) {
  const v = Math.max(0, Math.min(5, value));
  return (
    <span className={`inline-flex items-center ${className}`} role="img" aria-label={label ?? `${v.toFixed(1)} / 5`} data-stars={v.toFixed(1)}>
      {[0, 1, 2, 3, 4].map((i) => {
        const part = Math.max(0, Math.min(1, v - i));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }} aria-hidden>
            <Star className="absolute inset-0 text-muted-foreground/40" style={{ width: size, height: size }} strokeWidth={1.75} />
            {part > 0 && (
              <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${part * 100}%` }}>
                <Star className="fill-amber-400 text-amber-500 dark:fill-amber-300 dark:text-amber-300" style={{ width: size, height: size }} strokeWidth={1.75} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** One bar of the 5★ … 1★ distribution. */
export function StarBar({ stars, count, total, href, active }: { stars: number; count: number; total: number; href?: string; active?: boolean }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  const inner = (
    <>
      <span className="w-6 shrink-0 tabular-nums">{stars}★</span>
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-amber-400 dark:bg-amber-300" style={{ width: `${pct}%` }} /></span>
      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{count}</span>
    </>
  );
  const cls = `flex items-center gap-2 rounded px-1 py-0.5 text-xs ${active ? "bg-primary/10 font-semibold" : ""}`;
  return href ? <a href={href} className={`${cls} hover:bg-muted`} data-testid={`star-bar-${stars}`}>{inner}</a> : <div className={cls}>{inner}</div>;
}

/** Sales reps (Phase 62) — read-only pieces shared by the pages. */
import { RouteMap, type MapRoute } from "@/components/motion/route-map";
import { Badge } from "@/components/ui/badge";

export type L = Record<string, string>;
const VISIT_TONE: Record<string, "success" | "warning" | "secondary" | "destructive"> = { PLANNED: "warning", DONE: "success", MISSED: "destructive", CANCELLED: "secondary" };
const ORDER_TONE: Record<string, "success" | "warning" | "secondary" | "destructive"> = { PENDING: "warning", PLACED: "success", REJECTED: "destructive", EXPIRED: "secondary", FAILED: "destructive", CANCELLED: "secondary" };

export const VisitBadge = ({ l, status }: { l: L; status: string }) => <Badge variant={VISIT_TONE[status] ?? "secondary"} data-testid="visit-status" data-status={status}>{l[`status.${status}`] ?? status}</Badge>;
export const RepOrderBadge = ({ l, status }: { l: L; status: string }) => <Badge variant={ORDER_TONE[status] ?? "secondary"} data-testid="ro-status" data-status={status}>{l[`repOrderStatus.${status}`] ?? status}</Badge>;

/** The day's visits on a map: one coloured line per rep, visited stops filled. */
export function VisitMap({ l, reps, height = 260 }: { l: L; reps: { id: string; name: string; visits: { status: string; at: { lat: number; lng: number } | null }[] }[]; height?: number }) {
  const routes: MapRoute[] = reps
    .map((r) => ({ id: r.id, label: r.name, start: null, stops: r.visits.filter((v) => v.at && v.status !== "CANCELLED").map((v) => ({ ...v.at!, done: v.status === "DONE", kind: "DROP" as const })) }))
    .filter((r) => r.stops.length);
  return <RouteMap routes={routes} height={height} label={l.mapLabel} legend={{ depot: l.mapStart, done: l.mapDone, todo: l.mapTodo }} />;
}

export function Tiles({ items }: { items: { label: string; value: string; testid?: string }[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="sr-tiles">
      {items.map((x) => (
        <div key={x.label} className="rounded-2xl border bg-card p-4" data-testid={x.testid}>
          <p className="text-xs text-muted-foreground">{x.label}</p>
          <p className="text-lg font-semibold tabular-nums">{x.value}</p>
        </div>
      ))}
    </div>
  );
}

/** Month progress against the target. */
export function TargetBar({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${w}%` }} />
    </div>
  );
}

/** Van sales (Phase 63) — read-only pieces shared by the pages. */
import { Badge } from "@/components/ui/badge";

export type L = Record<string, string>;
const LOAD_TONE: Record<string, "success" | "warning" | "secondary" | "destructive"> = { OPEN: "warning", ON_ROAD: "success", CLOSED: "secondary", CANCELLED: "secondary" };
export const LoadBadge = ({ l, status }: { l: L; status: string }) => <Badge variant={LOAD_TONE[status] ?? "secondary"} data-testid="vl-status" data-status={status}>{l[`status.${status}`] ?? status}</Badge>;
export const SaleBadge = ({ l, status }: { l: L; status: string }) => <Badge variant={status === "DONE" ? "success" : "destructive"} data-testid="vs-status" data-status={status}>{l[`saleStatus.${status}`] ?? status}</Badge>;
export const MethodBadge = ({ l, method }: { l: L; method: string }) => <Badge variant="secondary" data-testid="vs-method" data-method={method}>{l[`method.${method}`] ?? method}</Badge>;

export function Tiles({ items }: { items: { label: string; value: string; hint?: string; testid?: string }[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="vs-tiles">
      {items.map((x) => (
        <div key={x.label} className="min-w-0 rounded-2xl border bg-card p-4" data-testid={x.testid}>
          <p className="text-xs text-muted-foreground">{x.label}</p>
          <p className="text-lg font-semibold tabular-nums break-words">{x.value}</p>
          {x.hint && <p className="mt-1 text-xs text-muted-foreground">{x.hint}</p>}
        </div>
      ))}
    </div>
  );
}

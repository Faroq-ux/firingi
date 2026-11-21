/** EU trade reporting (Phase 57) — shared server-rendered parts. */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PROBLEM_TEXT, type Problem } from "@/lib/trade";

export const eur = (v: string | number) => `${Number(v).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export const kg = (v: string | number | null) => (v == null ? "—" : `${Number(v).toLocaleString("pt-PT", { maximumFractionDigits: 3 })} kg`);

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "FILED" ? "success" : status === "READY" ? "default" : "secondary"}>{status === "FILED" ? "Filed" : status === "READY" ? "Ready to file" : "Open"}</Badge>;
}

export function ProblemBadges({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return <span className="flex flex-wrap gap-1">{problems.map((p) => <Badge key={p} variant={p === "CATEGORY_CN" || p === "MISSING_ORIGIN" ? "warning" : "destructive"}>{PROBLEM_TEXT[p as Problem] ?? p}</Badge>)}</span>;
}

export type ReturnRow = { id: string; kindName: string; period: string; entity: string; country: string; status: string; dueOn: string; total: string; lines: number; problems: number; corrections: number; filingRef: string | null; daysLeft?: number; obliged?: boolean };

export function ReturnsTable({ rows, testid = "trade-returns" }: { rows: ReturnRow[]; testid?: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No returns yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm" data-testid={testid}>
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Return</th><th>Period</th><th>Entity</th><th>Status</th><th>Due</th><th className="pr-3 text-right">Value</th><th className="pr-3 text-right">Lines</th><th>Needs attention</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t" data-testid={`trade-row-${r.kindName.replace(/\W+/g, "-").toLowerCase()}-${r.period}`}>
              <td className="py-1.5 pr-2"><Link className="font-medium underline-offset-2 hover:underline" href={`/admin/invoices/eu-trade/returns/${r.id}`}>{r.kindName}</Link>{r.obliged === false && <span className="block text-xs text-muted-foreground">Under the threshold — not required yet</span>}</td>
              <td className="tabular-nums">{r.period}</td>
              <td>{r.country}</td>
              <td><StatusBadge status={r.status} />{r.filingRef && <span className="block text-xs text-muted-foreground">{r.filingRef}</span>}</td>
              <td className="tabular-nums">{r.dueOn}{r.daysLeft != null && r.status !== "FILED" && (r.lines > 0 || r.obliged !== false) && <span className={`block text-xs ${r.daysLeft < 0 ? "text-destructive" : r.daysLeft <= 3 ? "text-amber-600" : "text-muted-foreground"}`}>{r.daysLeft < 0 ? `${-r.daysLeft} days late` : `in ${r.daysLeft} days`}</span>}</td>
              <td className="pr-3 text-right tabular-nums">{eur(r.total)}</td>
              <td className="pr-3 text-right tabular-nums">{r.lines}</td>
              <td>{r.problems > 0 ? <Badge variant="destructive">{r.problems} with missing data</Badge> : null}{r.corrections > 0 ? <Badge variant="warning" className="ml-1">{r.corrections} corrections</Badge> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

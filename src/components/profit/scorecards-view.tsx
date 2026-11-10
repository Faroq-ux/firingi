/** Supplier scorecards (admin). */
import type { Ctx } from "@/server/context";
import { supplierScorecards } from "@/server/services/performance";
import { periodFrom } from "@/server/services/route-stats";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ProgressRing } from "@/components/motion/shapes";
import { PeriodForm } from "@/components/routes/period-form";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)} %`);

export async function ScorecardsView({ ctx, type, title, sp }: { ctx: Ctx; type: "DISTRIBUTOR" | "WHOLESALER"; title: string; sp: { from?: string; to?: string } }) {
  const p = periodFrom(sp, 90);
  const rows = await supplierScorecards(ctx, type, p);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title={title} description="Score 0–100 from how fast orders are confirmed (2 h or less is best), how much of what was ordered is confirmed, declines and no-answers, deliveries on the requested day (own fleet), returns and customers' ratings. Parts without data don't count." />
      <PeriodForm from={d(p.from)} to={d(p.to)} />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {rows.slice(0, 4).map((r, i) => (
          <div key={r.id} className={`tile gloss motion-rise motion-lift flex items-center gap-4 rounded-xl border p-4 ${["tone-teal", "tone-blue", "tone-violet", "tone-pink"][i]}`} style={{ ["--i" as string]: i }}>
            <ProgressRing value={(r.score ?? 0) / 100} size={74} stroke={8} label={`${r.name}: ${r.score ?? "—"}`}><b className="text-lg">{r.score ?? "—"}</b></ProgressRing>
            <div className="min-w-0"><div className="truncate font-semibold">{r.flag} {r.name}</div><div className="text-xs text-muted-foreground">{r.orders} orders · ★ {r.rating?.toFixed(1) ?? "—"}</div></div>
          </div>
        ))}
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="scorecards">
          <THead><TR><TH>Supplier</TH><TH className="text-right">Score</TH><TH className="text-right">Orders</TH><TH className="text-right">Confirms in</TH><TH className="text-right">Fill rate</TH><TH className="text-right">Declined / no answer</TH><TH className="text-right">On time</TH><TH className="text-right">Returns</TH><TH className="text-right">Rating</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.flag} {r.name}</TD>
                <TD className={`text-right font-bold tabular-nums ${r.score === null ? "" : r.score >= 80 ? "text-success" : r.score >= 60 ? "text-warning" : "text-destructive"}`}>{r.score ?? "—"}</TD>
                <TD className="text-right tabular-nums">{r.orders}</TD>
                <TD className="text-right tabular-nums">{r.confirmHours === null ? "—" : `${r.confirmHours} h`}</TD>
                <TD className="text-right tabular-nums">{pct(r.fillRate)}</TD>
                <TD className="text-right tabular-nums">{pct(r.declineRate)}</TD>
                <TD className="text-right tabular-nums">{pct(r.onTime)}</TD>
                <TD className="text-right tabular-nums">{pct(r.returnRate)}</TD>
                <TD className="text-right tabular-nums">{r.rating === null ? "—" : `★ ${r.rating.toFixed(1)} (${r.ratingCount})`}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={9}>No suppliers.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}

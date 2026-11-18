/** Cold chain (Phase 42) — server-rendered pieces shared by the buyer, supplier, driver and FIRINGI pages. */
import Link from "next/link";
import { FileDown, Snowflake, Thermometer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Ctx } from "@/server/context";
import { fill } from "./labels";

type L = Record<string, string>;
const TONE = { OK: "success", WARN: "warning", OUT: "destructive" } as const;
const DEC_TONE = { NOTED: "secondary", ACCEPTED: "warning", REFUSED: "destructive", BLOCKED: "destructive" } as const;
const c1 = (n: number) => `${n.toFixed(1).replace(".", ",")} °C`;

/** Product page / cards: "Chilled 0–4 °C". */
export function ColdBadge({ cls }: { cls: { code: string; name: string; range: string } }) {
  return <Badge variant="outline" className="gap-1" data-testid="cold-badge" data-class={cls.code}><Snowflake className="size-3" /> {cls.name}</Badge>;
}

/** Tiny temperature line for a logger trip (min/max band). */
function TripLine({ points }: { points: { at: Date; valueC: number }[] }) {
  if (points.length < 2) return null;
  const xs = points.map((p) => new Date(p.at).getTime()), ys = points.map((p) => p.valueC);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys) - 0.5, Math.max(...ys) + 0.5];
  const d = points.map((p, i) => `${i ? "L" : "M"}${(((new Date(p.at).getTime() - x0) / Math.max(1, x1 - x0)) * 300).toFixed(1)},${(60 - ((p.valueC - y0) / Math.max(0.1, y1 - y0)) * 60).toFixed(1)}`).join(" ");
  return <svg viewBox="0 0 300 60" className="h-14 w-full max-w-sm text-primary" role="img" aria-label="Temperature during the trip"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
}

/** Order pages: classes, readings at each stage, incidents, logger trip, forms for this viewer, the certificate. */
export async function OrderColdCard({ ctx, orderId, as, english }: { ctx: Ctx; orderId: string; as: "BUYER" | "SUPPLIER" | "ADMIN"; english?: boolean }) {
  const { orderColdChain, listClasses } = await import("@/server/coldchain/service");
  const { ccLabels, enLabels } = await import("./labels");
  const { Card, CardContent, CardHeader, CardTitle } = await import("@/components/ui/card");
  const { RecordTempsForm } = await import("./client");
  const { l, locale } = english ? { l: enLabels(), locale: "en" } : await ccLabels();
  const v = await orderColdChain(ctx, orderId, as, locale).catch(() => null);
  if (!v) return null;
  const all = await listClasses(locale);
  const forForm = v.classes.map((c) => ({ ...all.find((x) => x.id === c.id)!, name: c.name }));
  const time = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(d));
  const base = as === "BUYER" ? "/buy" : as === "SUPPLIER" ? "/vendor" : "/admin";
  return (
    <Card className="mt-6" id="cold-chain" data-testid="order-cold">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><Thermometer className="size-5" /> {l.orderTitle}</CardTitle>
        {v.can.certificate && <a href={`/api/coldchain/certificate/${orderId}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid="certificate-link"><FileDown className="size-4" /> {l.certificate}</a>}
      </CardHeader>
      <CardContent className="space-y-4">
        {v.classes.map((c) => (
          <div key={c.id} className="space-y-2" data-testid="cold-class" data-class={c.code}>
            <p className="flex flex-wrap items-center gap-2 text-sm"><Snowflake className="size-4" /> <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">· {c.products.join(", ")}</span></p>
            {!c.readings.length ? <p className="text-sm text-muted-foreground">{l.noReadings}</p> : (
              <ol className="space-y-1">
                {c.readings.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="cold-reading" data-stage={r.stage} data-status={r.status}>
                    <span className="w-28 shrink-0 text-muted-foreground">{l[`stage.${r.stage}`]}</span>
                    <span className="font-medium tabular-nums">{c1(r.valueC)}</span>
                    <Badge variant={TONE[r.status]}>{l[`status.${r.status}`]}</Badge>
                    {r.accepted === false && <Badge variant="destructive">{l.refusedBadge}</Badge>}
                    <span className="text-xs text-muted-foreground">{time(r.at)}{r.by ? ` · ${r.by}` : ""}{r.probe ? ` · ${r.probe}` : ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
        {v.trip && (
          <div className="space-y-1 rounded-lg border p-3 text-sm" data-testid="cold-trip">
            <p className="font-medium">{fill(l.tripTitle, { logger: v.trip.logger })}</p>
            <p className="text-muted-foreground">{fill(l.tripStats, { min: c1(v.trip.minC), max: c1(v.trip.maxC), avg: c1(v.trip.avgC), out: v.trip.minutesOut })}</p>
            <TripLine points={v.trip.points} />
          </div>
        )}
        {v.incidents.length > 0 && (
          <ul className="divide-y rounded-lg border" data-testid="cold-incidents">
            {v.incidents.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 p-2 text-sm" data-testid="cold-incident" data-decision={i.decision}>
                <span className="font-mono text-xs">{i.number}</span>
                <Badge variant={DEC_TONE[i.decision as keyof typeof DEC_TONE]}>{l[`decision.${i.decision}`]}</Badge>
                <span className="min-w-0 flex-1 basis-40 break-words">{i.cls} · {l[`stage.${i.stage}`]} · {c1(i.valueC)}{i.fault ? ` · ${l[`fault.${i.fault}`] ?? i.fault}` : ""}</span>
                {i.claim && <Link href={`${base}/orders/claims/${i.claim.id}`} className="text-primary hover:underline">{fill(l.claimLink, { number: i.claim.number })}</Link>}
              </li>
            ))}
          </ul>
        )}
        {v.can.dispatch && <RecordTempsForm l={l} mode="DISPATCH" targetId={orderId} classes={forForm} />}
        {v.can.receipt && <RecordTempsForm l={l} mode="RECEIPT" targetId={orderId} classes={forForm} />}
      </CardContent>
    </Card>
  );
}

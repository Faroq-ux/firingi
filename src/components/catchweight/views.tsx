/** Sold by weight (Phase 41) — server-rendered pieces shared by the buyer, supplier, driver and FIRINGI pages. */
import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Ctx } from "@/server/context";
import { fill } from "./labels";

type L = Record<string, string>;
export type CwInfo = { mode: "PIECE" | "KG"; nominalKg: number; minKg: number | null; maxKg: number | null };
const money = (n: number, locale: string, currency = "EUR") => new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
const kg = (n: number, locale: string, d = 2) => new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(n);
const kg3 = (n: number, locale: string) => new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n);

/** Product cards: "Sold by weight · 6,75 €/kg". */
export function CwBadge({ l, locale, cw, unitGross, currency = "EUR" }: { l: L; locale: string; cw: CwInfo; unitGross: number | null; currency?: string }) {
  return (
    <Badge variant="outline" className="gap-1" data-testid="cw-badge">
      <Scale className="size-3" /> {l.badge}{unitGross != null ? ` · ${fill(l.perKgShort, { price: money(unitGross / cw.nominalKg, locale, currency) })}` : ""}
    </Badge>
  );
}

/** Product page: price per kg, how much a piece weighs, how the final price is worked out. */
export function ProductCatchWeight({ l, locale, cw, unitGross, unitNet, taxLabel, currency = "EUR" }: { l: L; locale: string; cw: CwInfo; unitGross: number | null; unitNet: number | null; taxLabel: string; currency?: string }) {
  const range = cw.minKg != null && cw.maxKg != null ? fill(l.range, { min: kg(cw.minKg, locale), max: kg(cw.maxKg, locale) }) : "";
  return (
    <div className="space-y-1.5 rounded-xl border border-dashed p-3 text-sm" data-testid="product-cw">
      <p className="flex items-center gap-2 font-medium"><Scale className="size-4" /> {l.productTitle}</p>
      {unitGross != null && unitNet != null && (
        <p data-testid="cw-perkg-buyer">
          <b>{fill(l.perKgShort, { price: money(unitGross / cw.nominalKg, locale, currency) })}</b> {fill(l.incTax, { tax: taxLabel })}
          <span className="text-xs text-muted-foreground"> ({fill(l.perKgShort, { price: money(unitNet / cw.nominalKg, locale, currency) })} {fill(l.exTax, { tax: taxLabel })})</span>
        </p>
      )}
      <p>{cw.mode === "PIECE" ? fill(l.pieceInfo, { kg: kg(cw.nominalKg, locale), range }) : fill(l.kgInfo, { kg: kg(cw.nominalKg, locale) })}</p>
      <p className="text-muted-foreground">{l.howBilled}</p>
    </div>
  );
}

/** Cart / checkout line note: "≈ 10 kg · final price by weight". */
export function CwCartNote({ l, locale, cw, qty }: { l: L; locale: string; cw: CwInfo; qty: number }) {
  return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="cw-cart-note"><Scale className="size-3" /> {fill(l.cartNote, { kg: kg(cw.nominalKg * qty, locale) })}</span>;
}

const TONE = (x: { over: boolean; capped: boolean; accepted: boolean; weighed: boolean }) =>
  !x.weighed ? "outline" : x.over && x.accepted ? "secondary" : x.capped ? "warning" : "success";

/** Order pages: the sold-by-weight lines (estimate → weighed → billed) with weighing for the seller and "accept" for the buyer. */
export async function OrderWeightsCard({ ctx, orderId, as, english, pickSource }: { ctx: Ctx; orderId: string; as: "BUYER" | "SUPPLIER" | "ADMIN"; english?: boolean; pickSource?: boolean }) {
  const { orderWeights } = await import("@/server/catchweight/service");
  const { cwLabels, enLabels } = await import("./labels");
  const { Card, CardContent, CardHeader, CardTitle } = await import("@/components/ui/card");
  const { WeighForm, AcceptOverButton } = await import("./client");
  const { l, locale } = english ? { l: enLabels(), locale: "en" } : await cwLabels();
  const v = await orderWeights(ctx, orderId, as, locale).catch(() => null);
  if (!v || !v.lines.length) return null;
  return (
    <Card className="mt-6" data-testid="order-weights">
      <CardHeader><CardTitle className="flex items-center gap-2"><Scale className="size-5" /> {l.orderTitle}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {as === "BUYER" && <p className="text-sm text-muted-foreground">{l.orderIntroBuyer}</p>}
        {v.prepayBuffer > 0 && v.awaitingPayment && <p className="rounded-md bg-muted p-2 text-sm" data-testid="cw-buffer-note">{fill(l.bufferNote, { amount: money(v.prepayBuffer, locale) })}</p>}
        <ul className="divide-y">
          {v.lines.map((x) => {
            const state = !x.weighed ? l["state.estimate"] : x.over ? (x.accepted ? l["state.accepted"] : l["state.capped"]) : l["state.weighed"];
            return (
              <li key={x.id} className="space-y-2 py-3" data-testid="weight-line" data-over={x.over ? "1" : "0"} data-capped={x.capped ? "1" : "0"}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 basis-48 break-words font-medium">{x.product} <span className="text-xs font-normal text-muted-foreground">· {x.packaging} · {x.units} × ≈ {kg(x.nominalKg, locale)} kg</span></span>
                  <Badge variant={TONE(x)} data-testid="weight-state">{state}</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">{l.estimated}</dt><dd className="tabular-nums">{kg3(x.estimatedKg, locale)} kg</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{l.weighedCol}</dt><dd className="tabular-nums" data-testid="weighed-kg">{x.actualKg != null ? `${kg3(x.actualKg, locale)} kg` : "—"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{l.billed}</dt><dd className="tabular-nums" data-testid="billed-kg">{kg3(x.billedKg, locale)} kg</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{fill(l.perKgCol, {})}</dt><dd className="tabular-nums">{fill(l.perKgShort, { price: money(x.perKg, locale) })} · {money(x.amountNet, locale)}</dd></div>
                </dl>
                {x.over && !x.accepted && <p className="text-sm text-[color:var(--warning-foreground,inherit)]" data-testid="over-note">{fill(as === "BUYER" ? l.overBuyer : l.overSeller, { max: kg3(x.maxKg, locale), pct: x.tolerancePct })}</p>}
                {x.pieces.length > 1 && <p className="text-xs text-muted-foreground">{fill(l.piecesList, { list: x.pieces.map((p) => kg(p, locale, 3)).join(" · ") })}</p>}
                {v.canWeigh && <WeighForm l={l} locale={locale} lineId={x.id} mode={x.mode} units={x.units} pieces={x.pieces} source={pickSource ? "PICK" : "SUPPLIER"} />}
                {x.history.length > 0 && as !== "BUYER" && (
                  <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{l.history}</summary>
                    <ul className="mt-1 space-y-0.5">{x.history.map((h, i) => <li key={i}>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(h.at))} · {l[`source.${h.source}`] ?? h.source} · {kg3(h.totalKg, locale)} kg ({h.pieces})</li>)}</ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
        {v.canAccept && <AcceptOverButton l={l} orderId={orderId} />}
      </CardContent>
    </Card>
  );
}

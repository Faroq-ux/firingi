/** AI Centre (Phase 66): the detail table under each recommendation area (what Phase 17's separate pages showed). */
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ForecastSpark } from "@/components/ai/forecast-chart";
import type { Ctx } from "@/server/context";
import { canAi, deliveryRisk, demandForecast, marginOpportunities, reorderPredictions, stockPredictions, supplierRecommendations } from "@/server/ai/insights";
import { overdueByCustomer, routeSavings } from "@/server/ai/centre/recs";
import { aiCentreSettings } from "@/server/ai/centre/settings";
import { reasonText } from "@/lib/ai";
import type { RecArea } from "@/lib/ai-centre";
import { Level, NoAccess, eur, num, pct } from "./_kit";

const REASON = { CHEAPER: "cheaper", BETTER_SERVICE: "more reliable", BOTH: "cheaper & more reliable" } as const;
const box = (title: string, description: string, body: React.ReactNode, testid: string) => (
  <Card className="mt-6" data-testid={testid}><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="overflow-x-auto">{body}</CardContent></Card>
);

export async function AreaInsights({ ctx, area }: { ctx: Ctx; area: RecArea }) {
  const now = new Date();
  if (area === "SALES") {
    if (!canAi(ctx, "STAFF", ["admin.orders.view", "admin.analytics.view", "admin.catalogue.view"])) return <NoAccess what="order volumes" />;
    const rows = (await demandForecast(ctx, "STAFF", { limit: 300, locale: "en" })).filter((r) => r.trend !== null && Math.abs(r.trend) >= 0.15).sort((a, b) => (b.trend ?? 0) - (a.trend ?? 0)).slice(0, 25);
    return box("Products moving fast", "Demand rising or falling by 15% or more over the next 4 weeks.", (
      <Table data-testid="ins-sales"><THead><TR><TH>Product</TH><TH>Supplier</TH><TH className="w-44">12 weeks → 4 weeks</TH><TH className="text-right">Next 4 wk</TH><TH className="text-right">Trend</TH></TR></THead>
        <TBody>{rows.map((r) => <TR key={r.offerId}><TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD><TD>{r.vendor}</TD><TD><ForecastSpark history={r.history} forecast={r.forecast} label={`${r.product}: about ${r.nextWeeks} in the next 4 weeks`} /></TD><TD className="text-right tabular-nums">{r.nextWeeks}</TD><TD className={`text-right tabular-nums ${(r.trend ?? 0) > 0 ? "text-success" : "text-destructive"}`}>{pct(r.trend)}</TD></TR>)}
          {!rows.length && <EmptyRow colSpan={5}>Nothing is moving fast.</EmptyRow>}</TBody></Table>), "ins-sales-card");
  }
  if (area === "PRICING") {
    if (!canAi(ctx, "STAFF", ["admin.pricing.view", "admin.finance.view", "admin.vendors.commission"])) return <NoAccess what="margins and commission" />;
    const rows = (await marginOpportunities(ctx, { now })).slice(0, 30);
    return box("Margins below FIRINGI's rules", "Offers whose margin is under the margin rule's minimum or target, with what it costs a year.", (
      <Table data-testid="ins-pricing"><THead><TR><TH>Supplier</TH><TH>Product</TH><TH className="text-right">Margin</TH><TH className="text-right">Rule</TH><TH className="text-right">Sold, 8 weeks</TH><TH className="text-right">Missed / year</TH><TH /></TR></THead>
        <TBody>{rows.map((r) => <TR key={r.offerId}><TD className="font-medium">{r.vendor}</TD><TD>{r.product}<div className="text-xs text-muted-foreground">{r.sku}</div></TD><TD className="text-right tabular-nums">{r.margin}%</TD><TD className="text-right tabular-nums">{r.goal}%</TD><TD className="text-right tabular-nums">{eur(r.netLast8Weeks)}</TD><TD className="text-right font-semibold tabular-nums">{eur(r.yearlyGap)}</TD><TD><Level value={r.below}>{r.below === "MIN" ? "below minimum" : "below target"}</Level></TD></TR>)}
          {!rows.length && <EmptyRow colSpan={7}>Every margin meets FIRINGI&apos;s rules.</EmptyRow>}</TBody></Table>), "ins-pricing-card");
  }
  if (area === "SUPPLIERS") {
    if (!canAi(ctx, "STAFF", ["admin.vendors.view", "admin.orders.view"])) return <NoAccess what="supplier prices and scorecards" />;
    const rows = await supplierRecommendations(ctx, { now, locale: "en" });
    return box("Better suppliers", `The same product from another supplier — cheaper (with stock) or clearly more reliable. Possible saving ${eur(rows.reduce((a, r) => a + r.weeklySaving, 0) * 52)} a year.`, (
      <Table data-testid="ins-suppliers"><THead><TR><TH>Product</TH><TH>Bought from</TH><TH>Alternative</TH><TH className="text-right">Units / week</TH><TH className="text-right">Saving / week</TH><TH>Why</TH></TR></THead>
        <TBody>{rows.slice(0, 40).map((r) => <TR key={`${r.currentOfferId}${r.betterOfferId}`}><TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD><TD>{r.current}<div className="text-xs text-muted-foreground">{eur(r.currentPrice, 2)} · score {r.currentScore ?? "—"}</div></TD><TD className="font-medium">{r.better}<div className="text-xs font-normal text-muted-foreground">{eur(r.betterPrice, 2)} · score {r.betterScore ?? "—"} · {r.betterStock} in stock</div></TD><TD className="text-right tabular-nums">{num(r.weeklyUnits)}</TD><TD className="text-right font-semibold tabular-nums">{eur(r.weeklySaving, 2)}</TD><TD><Badge variant={r.reason === "CHEAPER" ? "default" : "success"}>{REASON[r.reason]}</Badge></TD></TR>)}
          {!rows.length && <EmptyRow colSpan={6}>Every product is bought from its best available supplier.</EmptyRow>}</TBody></Table>), "ins-suppliers-card");
  }
  if (area === "STOCK") {
    if (!canAi(ctx, "STAFF", ["admin.orders.view", "admin.analytics.view", "admin.catalogue.view"])) return <NoAccess what="stock and sales" />;
    const rows = (await stockPredictions(ctx, "STAFF", { now, onlyAtRisk: true, locale: "en" })).slice(0, 40);
    return box("Stock at risk", "Days of stock left at the current selling rate. See Forecasting › Inventory for every product.", (
      <Table data-testid="ins-stock"><THead><TR><TH>Product</TH><TH>Supplier</TH><TH className="text-right">Available</TH><TH className="text-right">Sells / day</TH><TH className="text-right">Days left</TH><TH>Runs out</TH><TH /></TR></THead>
        <TBody>{rows.map((r) => <TR key={r.offerId}><TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.pack} · {r.sku}</div></TD><TD>{r.vendor}</TD><TD className="text-right tabular-nums">{r.available}</TD><TD className="text-right tabular-nums">{num(r.dailyUnits)}</TD><TD className="text-right tabular-nums">{r.days ?? "—"}</TD><TD className="tabular-nums">{r.runsOutOn ?? "—"}</TD><TD><Level value={r.status} /></TD></TR>)}
          {!rows.length && <EmptyRow colSpan={7}>No stock at risk.</EmptyRow>}</TBody></Table>), "ins-stock-card");
  }
  if (area === "CUSTOMERS") {
    if (!canAi(ctx, "STAFF", ["admin.orders.view", "admin.crm.view", "admin.analytics.view"])) return <NoAccess what="customer orders" />;
    const s = await aiCentreSettings();
    const [rows, overdue] = await Promise.all([reorderPredictions(ctx, "STAFF", { now, onlyDue: true, dueWithinDays: 7, locale: "en" }), overdueByCustomer(now, s.overdueDays)]);
    return (
      <>
        {box("Reorders due", "When each customer usually orders again from each supplier, and what it usually buys.", (
          <Table data-testid="ins-reorders"><THead><TR><TH>Customer</TH><TH>Supplier</TH><TH className="text-right">Every</TH><TH>Last order</TH><TH>Expected</TH><TH className="text-right">Usual order</TH><TH>Usual basket</TH><TH /></TR></THead>
            <TBody>{rows.slice(0, 40).map((r) => <TR key={`${r.buyerId}${r.sellerId}`}><TD className="font-medium">{r.buyer}</TD><TD>{r.seller}</TD><TD className="text-right tabular-nums">{r.gapDays} d</TD><TD className="tabular-nums">{r.lastOrder}</TD><TD className="tabular-nums">{r.expected}</TD><TD className="text-right tabular-nums">{eur(r.usualNet, 2)}</TD><TD className="max-w-72 text-xs text-muted-foreground">{r.basket.slice(0, 4).map((b) => `${b.qty} × ${b.product}`).join(", ")}{r.basket.length > 4 ? ` +${r.basket.length - 4}` : ""}</TD><TD>{r.overdueDays >= 2 ? <Level value="HIGH">{r.overdueDays} days late</Level> : r.overdueDays >= 0 ? <Level value="MEDIUM">due</Level> : <Level value="OK">in {-r.overdueDays} d</Level>}</TD></TR>)}
              {!rows.length && <EmptyRow colSpan={8}>No reorders due this week.</EmptyRow>}</TBody></Table>), "ins-reorders-card")}
        {box("Overdue invoices", `Customers with invoices open more than ${s.overdueDays} days past their due date.`, (
          <Table data-testid="ins-overdue"><THead><TR><TH>Customer</TH><TH className="text-right">Open</TH><TH className="text-right">Invoices</TH><TH>Oldest due</TH><TH className="text-right">Days late</TH></TR></THead>
            <TBody>{overdue.sort((a, b) => b.open - a.open).slice(0, 40).map((o) => <TR key={o.buyerId}><TD className="font-medium">{o.buyer}</TD><TD className="text-right font-semibold tabular-nums">{eur(o.open, 2)}</TD><TD className="text-right tabular-nums">{o.invoices}</TD><TD className="tabular-nums">{o.oldestDue}</TD><TD className="text-right tabular-nums">{o.daysLate}</TD></TR>)}
              {!overdue.length && <EmptyRow colSpan={5}>No overdue invoices.</EmptyRow>}</TBody></Table>), "ins-overdue-card")}
      </>
    );
  }
  // ROUTES
  if (!canAi(ctx, "STAFF", ["admin.delivery.view", "admin.orders.view"])) return <NoAccess what="deliveries and routes" />;
  const s = await aiCentreSettings();
  const [rs, risks] = await Promise.all([routeSavings(now, s), deliveryRisk(ctx, "STAFF", { now, limit: 40 })]);
  const unit = (x: { savedAmount: number; unit: string }) => `${x.savedAmount} ${x.unit}`;
  return (
    <>
      {box("Shorter routes", `Planned routes whose stops can be driven in a shorter order (at least ${s.routeMinKm} km and ${s.routeMinPct}% shorter). Fuel and energy from each vehicle's fuel; FIRINGI's rates are in the AI Centre settings.`, (
        <Table data-testid="ins-routes"><THead><TR><TH>Route</TH><TH>Fleet</TH><TH className="text-right">Stops</TH><TH className="text-right">Now</TH><TH className="text-right">Shorter</TH><TH className="text-right">Saves</TH><TH className="text-right">Fuel / energy</TH><TH className="text-right">€</TH><TH className="text-right">CO₂</TH></TR></THead>
          <TBody>{rs.savings.map((x) => <TR key={x.routeId} data-testid="ins-route"><TD><Link className="font-medium underline-offset-4 hover:underline" href={`/admin/delivery/routes/${x.routeId}`}>{x.number}</Link><div className="text-xs text-muted-foreground">{x.date}{x.vehicle ? ` · ${x.vehicle}` : ""} · {x.fuel.toLowerCase()}</div></TD><TD>{x.executor}</TD><TD className="text-right tabular-nums">{x.stops}</TD><TD className="text-right tabular-nums">{x.currentKm} km</TD><TD className="text-right tabular-nums">{x.betterKm} km</TD><TD className="text-right font-semibold tabular-nums">{x.savedKm} km · {x.savedMinutes} min</TD><TD className="text-right tabular-nums">{unit(x)}</TD><TD className="text-right tabular-nums">{eur(x.savedCost, 2)}</TD><TD className="text-right tabular-nums">{x.savedCo2Kg} kg</TD></TR>)}
            {!rs.savings.length && <EmptyRow colSpan={9}>Every planned route is already in its shortest order.</EmptyRow>}</TBody></Table>), "ins-routes-card")}
      {box("Routes to combine", `Two small routes of the same fleet on the same day, within ${s.mergeWithinKm} km of each other.`, (
        <Table data-testid="ins-merges"><THead><TR><TH>Routes</TH><TH>Fleet</TH><TH className="text-right">Stops</TH><TH className="text-right">Apart</TH><TH className="text-right">Now</TH><TH className="text-right">Combined</TH><TH className="text-right">Saves</TH><TH className="text-right">€</TH><TH className="text-right">CO₂</TH></TR></THead>
          <TBody>{rs.merges.map((x) => <TR key={x.routeIds.join()}><TD className="font-medium">{x.numbers.join(" + ")}<div className="text-xs text-muted-foreground">{x.date}</div></TD><TD>{x.executor}</TD><TD className="text-right tabular-nums">{x.stops}</TD><TD className="text-right tabular-nums">{x.distanceKm} km</TD><TD className="text-right tabular-nums">{x.currentKm} km</TD><TD className="text-right tabular-nums">{x.combinedKm} km</TD><TD className="text-right font-semibold tabular-nums">{x.savedKm} km · {unit(x)}</TD><TD className="text-right tabular-nums">{eur(x.savedCost, 2)}</TD><TD className="text-right tabular-nums">{x.savedCo2Kg} kg</TD></TR>)}
            {!rs.merges.length && <EmptyRow colSpan={9}>No routes worth combining.</EmptyRow>}</TBody></Table>), "ins-merges-card")}
      {box("Deliveries at risk", "Open orders that may arrive late, and why.", (
        <Table data-testid="ins-delivery"><THead><TR><TH>Order</TH><TH>Supplier → customer</TH><TH>Requested</TH><TH>Why</TH><TH /></TR></THead>
          <TBody>{risks.filter((r) => r.level !== "LOW").map((r) => <TR key={r.orderId}><TD><Link className="font-medium underline-offset-4 hover:underline" href={`/admin/orders/${r.orderId}`}>{r.number}</Link></TD><TD>{r.seller} → {r.buyer}</TD><TD className="tabular-nums">{r.requested ?? "—"}</TD><TD className="text-xs">{r.reasons.map(reasonText).join("; ")}</TD><TD><Level value={r.level} /></TD></TR>)}
            {!risks.some((r) => r.level !== "LOW") && <EmptyRow colSpan={5}>No deliveries at risk.</EmptyRow>}</TBody></Table>), "ins-delivery-card")}
    </>
  );
}

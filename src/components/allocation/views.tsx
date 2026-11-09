/** Back-office Supplier/Vendor Allocation pages (English, like the rest of the back office). */
import Link from "next/link";
import { getLocale } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { pickLocalized } from "@/i18n/config";
import { allocationRules, type AllocationRules } from "@/server/allocation/rules";
import { previewCandidates } from "@/server/allocation/engine";
import { countryOrderModes } from "@/server/allocation/mode";
import { can } from "@/server/rbac/guard";
import { activeCountries, smallOrderGroups, controlTower, listEvents, movableOrders, moveStats, openDeliveriesByRegion, openOrdersByBuyer, stockAcrossSuppliers, suppliers, type EventRow } from "@/server/allocation/data";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { OrderStatusBadge } from "@/components/orders/order-views";
import { formatDate, formatMoney } from "@/lib/utils";
import { CountryDistanceForm, DismissButton, MoveButton, OrderModeSelect, PickupRunForm, RulesForm, RunNowButton, VendorProfileForm, type RuleField } from "./forms";

export type AllocationPage =
  | "control-tower" | "auto-allocation" | "manual-allocation" | "distributor-vs-wholesaler" | "distance-rules" | "route-matching"
  | "existing-order-matching" | "margin-rules" | "stock-availability" | "delivery-capacity" | "vendor-priority" | "allocation-history" | "allocation-overrides";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const TITLES: Record<AllocationPage, [string, string]> = {
  "control-tower": ["Allocation Control Tower", "Orders a supplier declined, confirmed short or didn't answer — what FIRINGI moved, and what still needs a decision."],
  "auto-allocation": ["Auto Allocation", "When FIRINGI moves orders by itself, and how it ranks the other suppliers."],
  "manual-allocation": ["Manual Allocation", "Pick an order and move it — or its missing items — to another supplier."],
  "distributor-vs-wholesaler": ["Distributor vs Wholesaler", "How each marketplace orders, and what happens when the supplier can't deliver."],
  "distance-rules": ["Distance Rules", "How far a replacement supplier's warehouse may be from the delivery address."],
  "route-matching": ["Route Matching", "Prefer suppliers that already deliver near this address today."],
  "existing-order-matching": ["Existing Order Matching", "Prefer suppliers that already have an open order for the same buyer, so goods can travel together."],
  "margin-rules": ["Margin Rules", "The buyer keeps the original price. FIRINGI pays the difference while its margin on the moved goods stays above the floor."],
  "stock-availability": ["Stock Availability", "Free stock of a product at every supplier."],
  "delivery-capacity": ["Delivery Capacity", "Most new orders a supplier may receive per day. Full suppliers are skipped."],
  "vendor-priority": ["Vendor Priority", "Preferred suppliers rank higher; excluded suppliers never receive moved orders."],
  "allocation-history": ["Allocation History", "Every allocation decision, automatic and manual."],
  "allocation-overrides": ["Allocation Overrides", "Manual moves, margin floor overrides and closed cases."],
};

const TRIGGER: Record<string, string> = { DECLINED: "Supplier declined", SHORTFALL: "Confirmed less", NO_RESPONSE: "No answer in time", MANUAL: "Manual" };
const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "default"> = {
  AWAITING_BUYER: "default", MOVED: "success", PARTIAL: "warning", NO_CANDIDATE: "destructive", PENDING: "warning", DISMISSED: "secondary", FAILED: "destructive",
};
const STATUS_LABEL: Record<string, string> = { AWAITING_BUYER: "Buyer deciding", MOVED: "Moved", PARTIAL: "Partly moved", NO_CANDIDATE: "No supplier", PENDING: "Waiting", DISMISSED: "Closed", FAILED: "Failed" };
const FLOW: Record<string, string> = { CUSTOMER_FROM_WHOLESALER: "Customers ← Wholesalers", WHOLESALER_FROM_DISTRIBUTOR: "Wholesalers ← Distributors" };
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={testId}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function valuesOf(rules: AllocationRules, fields: RuleField[]) {
  const out: Record<string, boolean | number | string> = {};
  for (const f of fields) {
    const [a, b] = f.path.split(".");
    const v = (rules as unknown as Record<string, unknown>)[a];
    out[f.path] = (b ? (v as Record<string, boolean | number>)[b] : v) as boolean | number | string;
  }
  return out;
}
function RulesCard({ title, description, fields, rules }: { title: string; description?: string; fields: RuleField[]; rules: AllocationRules }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
      <CardContent><RulesForm fields={fields} values={valuesOf(rules, fields)} /></CardContent>
    </Card>
  );
}

function EventsTable({ rows, locale, showActions = false }: { rows: EventRow[]; locale: string; showActions?: boolean }) {
  return (
    <Table>
      <THead><TR><TH>When</TH><TH>Order</TH><TH>Why</TH><TH>From</TH><TH>Result</TH><TH>New orders</TH><TH className="text-right">FIRINGI pays</TH><TH>By</TH>{showActions && <TH />}</TR></THead>
      <TBody>
        {rows.length === 0 && <EmptyRow colSpan={showActions ? 9 : 8}>Nothing here yet.</EmptyRow>}
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="whitespace-nowrap text-xs">{formatDate(r.createdAt, locale, true)}</TD>
            <TD><Link className="font-medium text-primary hover:underline" href={`/admin/orders/${r.order.id}`}>{r.order.number}</Link><div className="text-xs text-muted-foreground">{r.order.buyer}</div></TD>
            <TD className="text-sm">{TRIGGER[r.trigger]}{r.note && <div className="max-w-64 whitespace-pre-line text-xs text-muted-foreground">{r.note}</div>}</TD>
            <TD className="text-sm">{r.from}</TD>
            <TD><Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>{r.marginOverride && <Badge variant="warning" className="ml-1">margin override</Badge>}</TD>
            <TD className="text-sm">{r.newOrders.map((n) => <Link key={n.orderId} className="mr-2 text-primary hover:underline" href={`/admin/orders/${n.orderId}`}>{n.number}</Link>)}</TD>
            <TD className="text-right tabular-nums">{r.absorbedNet ? formatMoney(r.absorbedNet, locale) : "—"}</TD>
            <TD className="text-xs">{r.automatic ? "Automatic" : r.by}{r.resolvedBy && r.status === "DISMISSED" && <div>closed by {r.resolvedBy}</div>}</TD>
            {showActions && <TD>{!r.resolvedAt && <Link className="text-sm text-primary hover:underline" href={`/admin/allocation/manual-allocation?order=${r.order.id}`}>Decide →</Link>}</TD>}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

async function ManualOrder({ ctx, orderId, locale }: { ctx: Ctx; orderId: string; locale: string }) {
  const { order, items, rules, candidates } = await previewCandidates(ctx, orderId);
  const open = (await listEvents(ctx, { orderId })).rows.filter((r) => r.order.id === orderId && !r.resolvedAt);
  const L = (v: unknown) => pickLocalized(v, locale);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle><Link className="text-primary hover:underline" href={`/admin/orders/${order.id}`}>{order.number}</Link> <OrderStatusBadge status={order.status} /></CardTitle>
          <CardDescription>{FLOW[order.flow]} · placed {formatDate(order.placedAt, locale, true)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm font-medium">To move</div>
          {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing left to move on this order.</p> : (
            <ul className="text-sm" data-testid="items-to-move">{items.map((i) => <li key={i.lineId}>{i.qty} × {L(i.name)} <span className="text-muted-foreground">({i.sku}) at {formatMoney(i.unitSalePriceNet, locale)}</span></li>)}</ul>
          )}
          {open.map((e) => <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"><Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge>{TRIGGER[e.trigger]} · {e.note}<DismissButton eventId={e.id} /></div>)}
        </CardContent>
      </Card>
      {items.length > 0 && (
        <Table>
          <THead><TR><TH>Supplier</TH><TH className="text-right">Score</TH><TH className="text-right">Distance</TH><TH className="text-right">Items</TH><TH className="text-right">Margin</TH><TH className="text-right">FIRINGI pays</TH><TH>Why not</TH><TH /></TR></THead>
          <TBody>
            {candidates.length === 0 && <EmptyRow colSpan={8}>No other supplier offers these items.</EmptyRow>}
            {candidates.map((c) => {
              const marginOnly = !c.eligible && c.reasons.every((r) => r.startsWith("Margin "));
              return (
                <TR key={c.vendorId} data-testid={`cand-${c.vendorId}`}>
                  <TD><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.country} · {Object.entries(c.parts).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(" · ")}</div></TD>
                  <TD className="text-right tabular-nums">{c.score.toFixed(0)}</TD>
                  <TD className="text-right tabular-nums">{c.distanceKm === null ? "—" : `${c.distanceKm.toFixed(1)} km`}</TD>
                  <TD className="text-right tabular-nums">{c.covers.length}/{items.length}</TD>
                  <TD className="text-right tabular-nums">{c.marginPct === null ? "—" : `${c.marginPct.toFixed(1)}%`}</TD>
                  <TD className="text-right tabular-nums">{c.absorbedNet ? formatMoney(c.absorbedNet, locale) : "—"}</TD>
                  <TD className="max-w-64 text-xs text-muted-foreground">{c.reasons.join("; ") || <Badge variant="success">Eligible</Badge>}</TD>
                  <TD>{(c.eligible || marginOnly) && c.covers.length > 0 && <MoveButton orderId={order.id} vendorId={c.vendorId} vendorName={c.name} marginOnly={marginOnly} />}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">Margin floor {rules.minMarginPercent}% · distance limit {rules.countryDistanceKm[order.countryId] ?? rules.maxDistanceKm} km. Suppliers that already had this order are not listed.</p>
    </div>
  );
}

export async function AllocationView({ ctx, page, searchParams }: { ctx: Ctx; page: AllocationPage; searchParams: SP }) {
  const locale = await getLocale();
  const [title, description] = TITLES[page];
  const rules = await allocationRules();
  const header = <PageHeader title={title} description={description} />;
  const money = (n: number) => formatMoney(n, locale);

  switch (page) {
    case "control-tower": {
      const [t, small] = await Promise.all([controlTower(ctx), smallOrderGroups(ctx, locale)]);
      return (
        <>
          {header}
          {!rules.auto && <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">Automatic moves are off — every case waits here. <Link className="text-primary hover:underline" href="/admin/allocation/auto-allocation">Change</Link></p>}
          <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Open cases" value={String(t.kpis.open)} hint="need a decision" testId="kpi-open" />
            <Stat label="Moved (30 days)" value={String(t.kpis.moved)} hint={`${pct(t.kpis.autoShare)} automatically`} testId="kpi-moved" />
            <Stat label="No supplier found (30 days)" value={String(t.kpis.noCandidate)} />
            <Stat label="FIRINGI paid (30 days)" value={money(t.kpis.absorbed)} hint="price difference kept off the buyer" />
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Needs a decision</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <THead><TR><TH>Since</TH><TH>Order</TH><TH>Why</TH><TH>From</TH><TH>Status</TH><TH /></TR></THead>
                  <TBody>
                    {t.open.length === 0 && <EmptyRow colSpan={6}>Nothing waiting. 🎉</EmptyRow>}
                    {t.open.map((e) => (
                      <TR key={e.id} data-testid="open-case">
                        <TD className="whitespace-nowrap text-xs">{formatDate(e.createdAt, locale, true)}</TD>
                        <TD><Link className="font-medium text-primary hover:underline" href={`/admin/orders/${e.order.id}`}>{e.order.number}</Link><div className="text-xs text-muted-foreground">{e.order.buyer}</div></TD>
                        <TD className="text-sm">{TRIGGER[e.trigger]}<div className="text-xs text-muted-foreground">{e.note}</div></TD>
                        <TD className="text-sm">{e.from}</TD>
                        <TD><Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge></TD>
                        <TD><Link className="text-sm text-primary hover:underline" href={`/admin/allocation/manual-allocation?order=${e.order.id}`}>Decide →</Link></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Waiting for the supplier to confirm</CardTitle><CardDescription>Moved automatically after {rules.responseHours} h without an answer.</CardDescription></CardHeader>
              <CardContent>
                <Table>
                  <THead><TR><TH>Order</TH><TH>Supplier</TH><TH>Buyer</TH><TH>Waiting</TH><TH className="text-right">Total</TH></TR></THead>
                  <TBody>
                    {t.waiting.length === 0 && <EmptyRow colSpan={5}>No orders waiting.</EmptyRow>}
                    {t.waiting.map((o) => {
                      const hours = (Date.now() - new Date(o.since).getTime()) / 3600_000;
                      return (
                        <TR key={o.id}>
                          <TD><Link className="font-medium text-primary hover:underline" href={`/admin/allocation/manual-allocation?order=${o.id}`}>{o.number}</Link></TD>
                          <TD className="text-sm">{o.seller}</TD>
                          <TD className="text-sm">{o.buyer}</TD>
                          <TD>{hours >= rules.responseHours ? <Badge variant="destructive">{hours.toFixed(1)} h — overdue</Badge> : <span className="text-sm tabular-nums">{hours.toFixed(1)} h</span>}</TD>
                          <TD className="text-right tabular-nums">{money(o.grand)}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
            <Card data-testid="small-orders">
              <CardHeader><CardTitle>Small orders to collect</CardTitle><CardDescription>Orders below the wholesaler&apos;s free-delivery minimum (and in-house orders): FIRINGI&apos;s fleet collects them. Grouped by pickup point — give a group to one driver (multi-order delivery must be on for FIRINGI&apos;s fleet in Settings › Delivery).</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                {small.groups.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No small orders waiting for a driver.</p>}
                {small.groups.map((g) => (
                  <div key={g.supplier} className="rounded-md border p-3" data-testid="pickup-group">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div><span className="font-medium">{g.supplier}</span>{g.inHouse && <Badge className="ml-2">in-house</Badge>} <span className="text-sm text-muted-foreground">· {g.pickup} · {g.orders.length} order(s) · {money(g.orders.reduce((a, o) => a + o.net, 0))}</span></div>
                      {can(ctx, "admin.delivery.manage") && <PickupRunForm deliveryIds={g.orders.map((o) => o.deliveryId)} drivers={small.drivers} />}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {g.orders.map((o) => <Link key={o.orderId} href={`/admin/orders/${o.orderId}`} className="rounded-full border px-2 py-0.5 hover:border-primary">{o.number} · {o.buyer} · {o.city}{o.region !== "—" && ` (${o.region})`}</Link>)}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <div><h2 className="mb-2 text-sm font-semibold">Recent moves</h2><EventsTable rows={t.recent} locale={locale} /></div>
          </div>
        </>
      );
    }

    case "auto-allocation":
      return (
        <>
          {header}
          <div className="grid gap-4 lg:grid-cols-2">
            <RulesCard rules={rules} title="When to move" fields={[
              { path: "auto", kind: "bool", label: "Move orders automatically", help: "Off: nothing moves by itself — every case waits in the Control Tower." },
              { path: "triggers.declined", kind: "bool", label: "When the supplier declines" },
              { path: "triggers.shortfall", kind: "bool", label: "When the supplier confirms less (only the missing items move)" },
              { path: "triggers.noResponse", kind: "bool", label: "When the supplier doesn't confirm in time" },
              { path: "responseHours", kind: "number", label: "Response time", min: 1, max: 72, suffix: "hours" },
              { path: "maxSplitOrders", kind: "number", label: "Suppliers one order may be split across", min: 1, max: 5 },
              { path: "maxMoves", kind: "number", label: "Times the same items may be moved", min: 1, max: 5 },
            ]} />
            <RulesCard rules={rules} title="Picking the wholesaler" description="For customers who order from FIRINGI, and when FIRINGI moves an order." fields={[
              { path: "pickBy", kind: "select", label: "Pick first", options: [{ value: "NEAREST", label: "Nearest wholesaler" }, { value: "CHEAPEST", label: "Cheapest for the customer" }], help: "Among wholesalers that deliver to the address and have everything in stock." },
              { path: "inHouse", kind: "select", label: "FIRINGI in-house warehouse", options: [{ value: "SMALL_ORDERS", label: "First for small orders (below free delivery)" }, { value: "FIRST", label: "Always first" }, { value: "OFF", label: "Not used" }] },
              { path: "buyerDecisionHours", kind: "number", label: "Time a customer has to decide", help: "When the wholesaler the customer chose can't deliver", min: 1, max: 168, suffix: "hours" },
            ]} />
            <RulesCard rules={rules} title="How suppliers are ranked" description="Weights of each part of the score (0 = ignore). Suppliers covering more of the items always come first." fields={[
              { path: "weights.distance", kind: "number", label: "Distance", help: "Closer warehouse is better", min: 0, max: 100 },
              { path: "weights.price", kind: "number", label: "Price / margin", help: "Higher FIRINGI margin after the move is better", min: 0, max: 100 },
              { path: "weights.priority", kind: "number", label: "Vendor priority", help: "Set per supplier in Vendor Priority", min: 0, max: 100 },
              { path: "weights.reliability", kind: "number", label: "Reliability", help: "Share of orders confirmed in the last 90 days", min: 0, max: 100 },
              { path: "weights.route", kind: "number", label: "Already delivering nearby", min: 0, max: 100 },
              { path: "weights.sameBuyer", kind: "number", label: "Already has an open order for this buyer", min: 0, max: 100 },
            ]} />
          </div>
          <Card className="mt-4"><CardHeader><CardTitle>Scheduled check</CardTitle><CardDescription>Unanswered orders are checked by <code>/api/cron/allocation</code> (every 10–15 minutes with the cron secret). Run it now:</CardDescription></CardHeader><CardContent><RunNowButton /></CardContent></Card>
        </>
      );

    case "manual-allocation": {
      const orderId = one(searchParams.order);
      if (orderId) return <>{header}<Link href="/admin/allocation/manual-allocation" className="mb-3 inline-block text-sm text-primary hover:underline">← All movable orders</Link><ManualOrder ctx={ctx} orderId={orderId} locale={locale} /></>;
      const q = one(searchParams.q);
      const rows = await movableOrders(ctx, q);
      return (
        <>
          {header}
          <form className="mb-4 flex gap-2"><input name="q" defaultValue={q} placeholder="Order number" className="h-9 w-60 rounded-md border bg-card px-3 text-sm" /><button className="h-9 rounded-md border bg-card px-3 text-sm">Search</button></form>
          <Table>
            <THead><TR><TH>Order</TH><TH>Status</TH><TH>Supplier</TH><TH>Buyer</TH><TH>Placed</TH><TH className="text-right">Total</TH><TH /></TR></THead>
            <TBody>
              {rows.length === 0 && <EmptyRow colSpan={7}>No orders to move.</EmptyRow>}
              {rows.map((o) => (
                <TR key={o.id}>
                  <TD className="font-medium">{o.number}</TD>
                  <TD><OrderStatusBadge status={o.status} />{o.openCase && <Badge variant="destructive" className="ml-1">open case</Badge>}{o.short && <Badge variant="warning" className="ml-1">short</Badge>}</TD>
                  <TD className="text-sm">{o.seller}</TD><TD className="text-sm">{o.buyer}</TD>
                  <TD className="text-xs">{formatDate(o.placedAt, locale, true)}</TD>
                  <TD className="text-right tabular-nums">{money(Number(o.grandTotal))}</TD>
                  <TD><Link className="text-sm text-primary hover:underline" href={`/admin/allocation/manual-allocation?order=${o.id}`}>Find suppliers →</Link></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      );
    }

    case "distributor-vs-wholesaler": {
      const [s, modes] = await Promise.all([moveStats(ctx), countryOrderModes()]);
      const canEdit = can(ctx, ["admin.international.manage", "admin.allocation.manage"]);
      return (
        <>
          {header}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle>Customers ← Wholesalers</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p><b>Customers order from FIRINGI</b> (per country, below): one FIRINGI price per product; FIRINGI picks the wholesaler ({rules.pickBy === "NEAREST" ? "nearest" : "cheapest"}) or its in-house warehouse. If that wholesaler can&apos;t deliver, FIRINGI moves the order automatically — or the Control Tower decides.</p>
              <p><b>Customers choose the wholesaler:</b> if it can&apos;t deliver, the customer decides: let FIRINGI find another wholesaler (same price or lower) or cancel.</p>
              <p className="text-muted-foreground">Either way FIRINGI invoices the customer for what is delivered; the wholesaler invoices FIRINGI at its own prices (Delivery Order).</p>
            </CardContent></Card>
            <Card><CardHeader><CardTitle>Wholesalers ← Distributors</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
              <p>The wholesaler always chooses the distributor. <b>When a distributor cancels, the order is cancelled</b> — FIRINGI does not move it.</p>
            </CardContent></Card>
            <Card><CardHeader><CardTitle>How customers order, per country</CardTitle></CardHeader><CardContent>
              <Table><THead><TR><TH>Country</TH><TH>Customers</TH></TR></THead>
                <TBody>{modes.map((c) => <TR key={c.id}><TD>{c.flag} {pickLocalized(c.name, locale) || c.code}</TD><TD><OrderModeSelect countryId={c.id} mode={c.customerOrderMode} canEdit={canEdit} /></TD></TR>)}</TBody>
              </Table>
            </CardContent></Card>
            <Card><CardHeader><CardTitle>Last 30 days</CardTitle></CardHeader><CardContent>
              <Table><THead><TR><TH>Marketplace</TH><TH className="text-right">Moved</TH><TH className="text-right">No supplier / failed</TH></TR></THead>
                <TBody>{Object.keys(FLOW).map((f) => { const r = s.byFlow.find((x) => x.flow === f); return <TR key={f}><TD>{FLOW[f]}</TD><TD className="text-right tabular-nums">{r?.moved ?? 0}</TD><TD className="text-right tabular-nums">{r?.failed ?? 0}</TD></TR>; })}</TBody>
              </Table>
            </CardContent></Card>
          </div>
        </>
      );
    }

    case "distance-rules": {
      const countries = await activeCountries(ctx, locale);
      return (
        <>
          {header}
          <div className="space-y-4">
            <RulesCard rules={rules} title="Default limit" description="Straight-line distance from the supplier's nearest warehouse or pickup point. The supplier's own service areas must also cover the address." fields={[
              { path: "maxDistanceKm", kind: "number", label: "Maximum distance", min: 1, max: 1000, suffix: "km" },
              { path: "weights.distance", kind: "number", label: "Weight of distance in the ranking", min: 0, max: 100 },
            ]} />
            <Card><CardHeader><CardTitle>Per country</CardTitle><CardDescription>Leave empty to use the default ({rules.maxDistanceKm} km). Cross-border distributors are not limited by distance.</CardDescription></CardHeader>
              <CardContent><CountryDistanceForm countries={countries} values={rules.countryDistanceKm} fallback={rules.maxDistanceKm} /></CardContent></Card>
          </div>
        </>
      );
    }

    case "route-matching": {
      const rows = await openDeliveriesByRegion(ctx, locale);
      return (
        <>
          {header}
          <div className="grid gap-4 lg:grid-cols-2">
            <RulesCard rules={rules} title="Route matching" description="A supplier with an order being prepared or on the road within this distance of the delivery address ranks higher." fields={[
              { path: "routeMatchKm", kind: "number", label: "Counts as 'nearby' within", min: 0, max: 100, step: 0.5, suffix: "km" },
              { path: "weights.route", kind: "number", label: "Weight in the ranking", min: 0, max: 100 },
            ]} />
            <Card><CardHeader><CardTitle>On the road now</CardTitle><CardDescription>Open orders per supplier and delivery region.</CardDescription></CardHeader><CardContent>
              <Table><THead><TR><TH>Supplier</TH><TH>Region</TH><TH className="text-right">Orders</TH></TR></THead>
                <TBody>{rows.length === 0 && <EmptyRow colSpan={3}>Nothing on the road.</EmptyRow>}{rows.map((r, i) => <TR key={i}><TD>{r.vendor}</TD><TD>{r.region}</TD><TD className="text-right tabular-nums">{r.orders}</TD></TR>)}</TBody>
              </Table>
            </CardContent></Card>
          </div>
        </>
      );
    }

    case "existing-order-matching": {
      const rows = await openOrdersByBuyer(ctx);
      return (
        <>
          {header}
          <div className="grid gap-4 lg:grid-cols-2">
            <RulesCard rules={rules} title="Existing order matching" description="Moving items to a supplier that already delivers to the buyer lets both orders travel together." fields={[
              { path: "weights.sameBuyer", kind: "number", label: "Weight in the ranking", min: 0, max: 100 },
            ]} />
            <Card><CardHeader><CardTitle>Open orders by buyer</CardTitle></CardHeader><CardContent>
              <Table><THead><TR><TH>Buyer</TH><TH>Supplier</TH><TH className="text-right">Orders</TH><TH className="text-right">Total</TH></TR></THead>
                <TBody>{rows.length === 0 && <EmptyRow colSpan={4}>No open orders.</EmptyRow>}{rows.map((r, i) => <TR key={i}><TD>{r.buyer}</TD><TD>{r.vendor}</TD><TD className="text-right tabular-nums">{r.n}</TD><TD className="text-right tabular-nums">{money(r.total)}</TD></TR>)}</TBody>
              </Table>
            </CardContent></Card>
          </div>
        </>
      );
    }

    case "margin-rules": {
      const s = await moveStats(ctx);
      return (
        <>
          {header}
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Stat label="Moves (30 days)" value={String(s.moves)} />
            <Stat label="FIRINGI paid (30 days)" value={money(s.absorbed)} hint="price difference kept off buyers" testId="kpi-absorbed" />
            <Stat label="Floor overrides (30 days)" value={String(s.overrides)} />
          </div>
          <RulesCard rules={rules} title="Margin floor" description="FIRINGI's margin on the moved goods = what the buyer pays − what FIRINGI owes the new supplier. 0% = FIRINGI may give up its commission but never lose money; a negative floor lets FIRINGI pay to keep the customer. Below the floor, only a manual move with an override is possible." fields={[
            { path: "minMarginPercent", kind: "number", label: "Minimum FIRINGI margin on moved goods", min: -50, max: 50, step: 0.5, suffix: "%" },
            { path: "weights.price", kind: "number", label: "Weight of price / margin in the ranking", min: 0, max: 100 },
          ]} />
        </>
      );
    }

    case "stock-availability": {
      const q = one(searchParams.q);
      const rows = await stockAcrossSuppliers(ctx, q, locale);
      return (
        <>
          {header}
          <form className="mb-4 flex gap-2"><input name="q" defaultValue={q} placeholder="Product name or SKU" className="h-9 w-72 rounded-md border bg-card px-3 text-sm" /><button className="h-9 rounded-md border bg-card px-3 text-sm">Search</button></form>
          <Table>
            <THead><TR><TH>Product</TH><TH>Packaging</TH><TH>Supplier</TH><TH className="text-right">On hand</TH><TH className="text-right">Free</TH><TH className="text-right">Lead time</TH></TR></THead>
            <TBody>
              {rows.length === 0 && <EmptyRow colSpan={6}>{q.trim().length < 2 ? "Type at least 2 characters." : "No supplier offers this."}</EmptyRow>}
              {rows.map((r) => (
                <TR key={r.offerId}>
                  <TD><div className="font-medium">{r.product}</div><div className="text-xs text-muted-foreground">{r.sku}</div></TD>
                  <TD className="text-sm">{r.packaging}</TD>
                  <TD className="text-sm">{r.vendor} <span className="text-xs text-muted-foreground">{r.vendorType.toLowerCase()} · {r.country}</span>{r.excluded && <Badge variant="destructive" className="ml-1">excluded</Badge>}</TD>
                  <TD className="text-right tabular-nums">{r.onHand}</TD>
                  <TD className={`text-right tabular-nums ${r.free <= 0 ? "text-destructive" : ""}`}>{r.free}</TD>
                  <TD className="text-right tabular-nums">{r.leadTimeDays} d</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      );
    }

    case "delivery-capacity":
    case "vendor-priority": {
      const rows = await suppliers(ctx);
      const capacity = page === "delivery-capacity";
      return (
        <>
          {header}
          {!capacity && <p className="mb-3 text-sm text-muted-foreground">Priority 0–100 (default 50). Reliability = orders confirmed vs. declined or unanswered in the last 90 days (shown from 3 decisions).</p>}
          <Table>
            <THead><TR><TH>Supplier</TH>{capacity ? <><TH className="text-right">Orders today</TH><TH className="text-right">Open orders</TH><TH>Max new orders per day</TH></> : <><TH className="text-right">Reliability</TH><TH>Priority · exclude · note</TH></>}</TR></THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.type.toLowerCase()} · {r.country}{r.excluded && " · excluded"}</div></TD>
                  {capacity ? (
                    <>
                      <TD className="text-right tabular-nums">{r.today}{r.capacity !== null && r.today >= r.capacity && <Badge variant="warning" className="ml-1">full</Badge>}</TD>
                      <TD className="text-right tabular-nums">{r.open}</TD>
                      <TD><VendorProfileForm companyId={r.id} priority={r.priority} excluded={r.excluded} capacity={r.capacity} note={r.note} show={["capacity"]} /></TD>
                    </>
                  ) : (
                    <>
                      <TD className="text-right tabular-nums">{r.reliability === null ? "—" : pct(r.reliability)}<div className="text-xs text-muted-foreground">{r.accepted} ✓ · {r.declined} ✗</div></TD>
                      <TD><VendorProfileForm companyId={r.id} priority={r.priority} excluded={r.excluded} capacity={r.capacity} note={r.note} show={["priority", "excluded", "note"]} /></TD>
                    </>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      );
    }

    case "allocation-history":
    case "allocation-overrides": {
      const status = one(searchParams.status), trigger = one(searchParams.trigger), orderId = one(searchParams.order);
      const pageNo = Number(one(searchParams.page)) || 1;
      const data = await listEvents(ctx, { status: status || undefined, trigger: trigger || undefined, orderId: orderId || undefined, manualOnly: page === "allocation-overrides", page: pageNo });
      const qs = (p: number) => `?${new URLSearchParams({ ...(status ? { status } : {}), ...(trigger ? { trigger } : {}), ...(orderId ? { order: orderId } : {}), page: String(p) })}`;
      return (
        <>
          {header}
          {page === "allocation-history" && (
            <form className="mb-4 flex flex-wrap gap-2">
              <select name="status" defaultValue={status} className="h-9 rounded-md border bg-card px-2 text-sm"><option value="">All results</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select name="trigger" defaultValue={trigger} className="h-9 rounded-md border bg-card px-2 text-sm"><option value="">All reasons</option>{Object.entries(TRIGGER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {orderId && <input type="hidden" name="order" value={orderId} />}
              <button className="h-9 rounded-md border bg-card px-3 text-sm">Filter</button>
              {orderId && <Link className="self-center text-sm text-primary hover:underline" href="/admin/allocation/allocation-history">Show all orders</Link>}
            </form>
          )}
          <EventsTable rows={data.rows} locale={locale} showActions />
          <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
            {data.page > 1 && <Link className="text-primary hover:underline" href={qs(data.page - 1)}>← Newer</Link>}
            <span>Page {data.page} of {data.pageCount} · {data.total} decisions</span>
            {data.page < data.pageCount && <Link className="text-primary hover:underline" href={qs(data.page + 1)}>Older →</Link>}
          </div>
        </>
      );
    }
  }
}

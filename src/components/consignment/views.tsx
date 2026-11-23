/** Consignment stock (Phase 65) — one site as the supplier or the customer sees it (server component). */
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "@/lib/utils";
import type { siteDetail } from "@/server/consignment/service";
import { fill } from "./labels";
import { CountForm, DecideCount, PickUp, ReceiveShipment, RetryCount, SendStock, SiteSettings, type L } from "./client";

type Site = Awaited<ReturnType<typeof siteDetail>>;
const STATUS_VARIANT = { ACTIVE: "success", PENDING: "warning", REJECTED: "destructive", CLOSED: "secondary" } as const;
const COUNT_VARIANT = { SUBMITTED: "warning", DISPUTED: "destructive", INVOICED: "success", FAILED: "destructive", SUPERSEDED: "secondary" } as const;

export function SiteStatus({ l, status }: { l: L; status: keyof typeof STATUS_VARIANT }) {
  return <Badge variant={STATUS_VARIANT[status]} data-testid="cs-status" data-status={status}>{l[`status.${status}`]}</Badge>;
}

export function SiteView({ l, locale, s }: { l: L; locale: string; s: Site }) {
  const vendor = s.side === "VENDOR";
  const shelf = s.products.filter((p) => p.onShelf > 0).map((p) => ({ offerId: p.offerId, name: p.name, max: p.onShelf }));
  const pending = s.counts.some((c) => c.status === "SUBMITTED" || c.status === "FAILED");
  return (
    <div className="space-y-6" data-testid="cs-site" data-id={s.id} data-number={s.number}>
      {s.status === "PENDING" && <p className="rounded-xl border border-dashed p-3 text-sm" data-testid="cs-pending">{l.pendingHint}</p>}
      {s.status === "REJECTED" && <p className="rounded-xl border border-destructive/40 p-3 text-sm text-destructive" data-testid="cs-rejected">{fill(l.rejected, { reason: s.rejectReason ?? "" })}</p>}
      <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        {([[vendor ? l.customer : l.supplier, vendor ? s.customer : s.supplier], [l.address, s.address], [l.lastCount, s.lastCountAt ? formatDate(s.lastCountAt, locale) : l.never], [l.nextCount, s.status === "ACTIVE" ? formatDate(s.nextDue, locale) : "—"]] as const).map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-2xl border bg-card p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="break-words font-medium">{v}</p></div>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>{l.products}</CardTitle><CardDescription>{l.counter}: {l[`counterKind.${s.counter}`]} · {l.countEvery}: {s.countEveryDays}</CardDescription></CardHeader>
        <CardContent>
          {!s.products.length ? <p className="text-sm text-muted-foreground" data-testid="cs-no-products">{l.noProducts}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm" data-testid="cs-products">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">{l.product}</th><th className="px-2 text-right">{l.sent}</th><th className="px-2 text-right">{l.used}</th><th className="px-2 text-right">{l.returned}</th><th className="px-2 text-right">{l.onShelf}</th>{vendor && <th className="px-2 text-right">{l.value}</th>}<th className="px-2">{l.nextExpiry}</th></tr></thead>
                <tbody>
                  {s.products.map((p) => (
                    <tr key={p.offerId} className="border-b last:border-0" data-testid="cs-product" data-offer={p.offerId} data-shelf={p.onShelf} data-used={p.used}>
                      <td className="py-2 pr-2"><span className="break-words">{p.name}</span> <span className="text-xs text-muted-foreground">· {p.packaging}</span>
                        {p.inTransit > 0 && <Badge variant="secondary" className="ml-1">{l.inTransit}: {p.inTransit}</Badge>}{p.short > 0 && <span className="ml-1 text-xs text-muted-foreground">{l.short}: {p.short}</span>}</td>
                      <td className="px-2 text-right tabular-nums">{p.sent}</td><td className="px-2 text-right tabular-nums">{p.used}</td><td className="px-2 text-right tabular-nums">{p.returned}</td>
                      <td className="px-2 text-right font-semibold tabular-nums">{p.onShelf}</td>
                      {vendor && <td className="px-2 text-right tabular-nums">{p.value != null ? formatMoney(p.value, locale) : "—"}</td>}
                      <td className="px-2">{p.nextExpiry ? formatDate(p.nextExpiry, locale) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {s.canCount && shelf.length > 0 && (
        <Card><CardHeader><CardTitle>{l.count}</CardTitle></CardHeader><CardContent><CountForm l={l} siteId={s.id} lines={shelf} /></CardContent></Card>
      )}
      {s.status === "ACTIVE" && !s.canCount && shelf.length > 0 && !pending && s.side === "BUYER" && <p className="text-sm text-muted-foreground">{l.supplierCounts}</p>}

      <Card>
        <CardHeader><CardTitle>{l.counts}</CardTitle></CardHeader>
        <CardContent>
          {!s.counts.length ? <p className="text-sm text-muted-foreground">{l.noCounts}</p> : (
            <ul className="divide-y" data-testid="cs-counts">
              {s.counts.map((c) => (
                <li key={c.id} className="space-y-2 py-3 text-sm" data-testid="cs-count-row" data-status={c.status} data-id={c.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.number}</span>
                    <Badge variant={COUNT_VARIANT[c.status]}>{l[`countStatus.${c.status}`]}</Badge>
                    <span className="text-muted-foreground">{fill(l.countedBy, { name: c.countedBy })} · {formatDate(c.countedAt, locale, true)}</span>
                    <span>{c.usedUnits ? fill(l.usedUnits, { n: c.usedUnits }) : l.nothingUsed}</span>
                    {c.autoConfirmed && <span className="text-xs text-muted-foreground">({l.auto})</span>}
                  </div>
                  {c.usedUnits > 0 && <p className="break-words text-xs text-muted-foreground">{c.lines.filter((x) => x.used > 0).map((x) => `${x.name}: ${x.used}`).join(" · ")}</p>}
                  {c.note && <p className="break-words text-xs">{c.note}</p>}
                  {c.disputeNote && <p className="break-words text-xs text-destructive">{fill(l.disputeNote, { note: c.disputeNote })}</p>}
                  {c.status === "INVOICED" && c.orderId && (
                    <p className="flex flex-wrap gap-x-3 text-xs" data-testid="cs-billed">
                      <Link className="underline underline-offset-2" href={vendor ? `/vendor/orders/${c.orderId}` : `/buy/orders/${c.orderId}`}>{l.order} {c.orderNumber}</Link>
                      {c.invoiceNumber && <span>{l.invoice} {c.invoiceNumber}</span>}
                      {c.gross != null && <span>{l.total}: {formatMoney(c.gross, locale)}</span>}
                    </p>
                  )}
                  {c.status === "FAILED" && <p className="text-xs text-destructive">{fill(l.error, { error: c.error ?? "" })}</p>}
                  {c.status === "FAILED" && vendor && s.canManage && <RetryCount l={l} id={c.id} />}
                  {c.toConfirmByMe && <DecideCount l={l} id={c.id} />}
                  {c.autoAt && <p className="text-xs text-muted-foreground">{fill(l.autoAt, { date: formatDate(c.autoAt, locale) })}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{l.shipments}</CardTitle></CardHeader>
        <CardContent>
          {!s.shipments.length ? <p className="text-sm text-muted-foreground">{l.noShipments}</p> : (
            <ul className="divide-y" data-testid="cs-shipments">
              {s.shipments.map((x) => (
                <li key={x.id} className="space-y-2 py-3 text-sm" data-testid="cs-shipment" data-status={x.status}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{x.number}</span><Badge variant={x.status === "SENT" ? "warning" : "success"}>{l[`ship.${x.status}`]}</Badge>
                    <span className="text-muted-foreground">{formatDate(x.sentAt, locale, true)}</span>
                  </div>
                  <p className="break-words text-xs text-muted-foreground">{x.lines.map((y) => `${y.name}: ${y.sent}${y.short ? ` (${l.short}: ${y.short})` : ""}`).join(" · ")}</p>
                  {x.status === "SENT" && (s.side === "BUYER" || s.canManage) && s.status === "ACTIVE" && <ReceiveShipment l={l} id={x.id} lines={x.lines.map((y) => ({ offerId: y.offerId, name: y.name, max: y.sent }))} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {s.canManage && s.status === "ACTIVE" && (
        <>
          <Card><CardHeader><CardTitle>{l.send}</CardTitle></CardHeader><CardContent><SendStock l={l} siteId={s.id} /></CardContent></Card>
          {shelf.length > 0 && !pending && <Card><CardHeader><CardTitle>{l.pickUp}</CardTitle></CardHeader><CardContent><PickUp l={l} siteId={s.id} lines={shelf} warehouse={s.warehouse} /></CardContent></Card>}
        </>
      )}
      {s.canManage && (s.status === "ACTIVE" || s.canClose) && (
        <Card><CardHeader><CardTitle>{l.settings}</CardTitle></CardHeader>
          <CardContent><SiteSettings l={l} siteId={s.id} status={s.status} canClose={s.canClose} value={{ countEveryDays: s.countEveryDays, counter: s.counter, note: s.note }} /></CardContent></Card>
      )}
    </div>
  );
}

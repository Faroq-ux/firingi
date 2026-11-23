import { notFound } from "next/navigation";
import { CalendarClock, Lock, PackageCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { preAccess } from "@/server/preorders/settings";
import { buyerAddresses, buyerPreorders } from "@/server/preorders/campaigns";
import { myLocks } from "@/server/preorders/locks";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TabLinks } from "@/app/admin/ai/_kit";
import { preLabels } from "@/components/preorders/labels";
import { CallOff, LockCancel, LockRequest, PreorderForm, ReservationActions } from "@/components/preorders/client";

export const metadata = { title: "Pre-orders & Price Locks" };
export const dynamic = "force-dynamic";
const fill = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const RES_TONE: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { PLACED: "default", ALLOCATED: "warning", CONFIRMED: "success", ORDERED: "success", CANCELLED: "secondary", DECLINED: "secondary", FAILED: "destructive" };
const LOCK_TONE: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = { REQUESTED: "warning", REVIEW: "warning", ACTIVE: "success", REJECTED: "destructive", CANCELLED: "secondary", EXPIRED: "secondary", DONE: "secondary" };

/** Phase 71: the customer's pre-orders (open campaigns, its own) and price locks. */
export default async function PreordersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place"]);
  const a = await preAccess(ctx.company);
  if (!a.buyerCampaigns && !a.buyerLocks) notFound();
  const { l, locale } = await preLabels();
  const q = (await searchParams).tab;
  const tabs = [...(a.buyerCampaigns ? [{ key: "OPEN", label: l.tabOpen }, { key: "MINE", label: l.tabMine }] : []), ...(a.buyerLocks ? [{ key: "LOCKS", label: l.tabLocks }] : [])];
  const tab = tabs.some((t) => t.key === q) ? q! : tabs[0].key;
  const canPlace = can(ctx, "buyer.orders.place");
  const eur = (n: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
  const day = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(d);
  const addresses = await buyerAddresses(ctx);
  const pre = a.buyerCampaigns && tab !== "LOCKS" ? await buyerPreorders(ctx, locale) : null;
  const locks = a.buyerLocks && tab === "LOCKS" ? await myLocks(ctx, locale) : null;
  return (
    <>
      <PageHeader title={l.title} icon={CalendarClock} description={l.intro} />
      <TabLinks testid="po-tabs" active={tab} href={(k) => `/buy/orders/preorders?tab=${k}`} tabs={tabs.map((t) => ({ ...t, count: t.key === "OPEN" ? pre?.campaigns.length : t.key === "MINE" ? pre?.reservations.filter((r) => ["PLACED", "ALLOCATED", "CONFIRMED"].includes(r.status)).length : undefined }))} />

      {tab === "OPEN" && pre && (!pre.campaigns.length ? <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground" data-testid="po-none">{l.noOpen}</p></CardContent></Card> : (
        <div className="space-y-4">{pre.campaigns.map((c) => {
          const mine = pre.reservations.find((r) => r.id === c.mine);
          return (
            <Card key={c.id} data-testid="po-campaign" data-title={c.title}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="min-w-0 flex-1 basis-60 break-words">{c.title}</CardTitle>
                  <Badge variant="secondary">{l[`kind.${c.kind}`]}</Badge>
                  {c.suggested && <Badge title={l.suggestedHint} data-testid="po-suggested"><Sparkles className="mr-1 size-3" />{l.suggested}</Badge>}
                </div>
                <CardDescription>{l.supplier}: {c.vendor} · {fill(l.closes, { date: day(c.closesAt) })} · {l.deliveries}: {c.deliveryDates.map(day).join(", ")}{c.depositPct > 0 ? ` · ${fill(l.deposit, { pct: c.depositPct })}` : ""}</CardDescription>
                {c.description && <p className="whitespace-pre-line text-sm">{c.description}</p>}
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="divide-y text-sm">{c.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2" data-testid="po-item">
                    <span className="min-w-0 flex-1 basis-56 break-words font-medium">{i.product} <span className="text-xs font-normal text-muted-foreground">{i.pack}</span></span>
                    <span className="tabular-nums"><span className="font-semibold" data-testid="po-price">{eur(i.price)}</span> <span className="text-xs text-muted-foreground">{l.perPack}</span></span>
                    {i.next && <span className="w-full text-xs text-[color:var(--success,#16a34a)] sm:w-auto" data-testid="po-next">{fill(l.nextTier, { missing: i.next.missing, price: eur(i.next.unitNet) })}</span>}
                    {i.short && <Badge variant="warning">{l.short}</Badge>}
                  </li>
                ))}</ul>
                <p className="text-xs text-muted-foreground">{fill(l.allocRule, { rule: l[`alloc.${c.allocation}`] })}{c.depositPct > 0 ? ` · ${l.depositHint}` : ""}</p>
                {mine && mine.status !== "PLACED" ? <p className="text-sm">{l[`resStatus.${mine.status}`]} — <Link className="text-primary underline" href="/buy/orders/preorders?tab=MINE">{l.tabMine}</Link></p> : canPlace && (
                  <>
                    {mine && <p className="text-xs text-muted-foreground">{l.alreadyMine}</p>}
                    <PreorderForm l={l} campaignId={c.id} items={c.items.map((i) => ({ id: i.id, product: i.product, pack: i.pack, minQty: i.minQty, maxQty: i.maxQty }))}
                      dates={c.deliveryDates.map((d) => ({ value: d.toISOString().slice(0, 10), label: day(d) }))} addresses={addresses}
                      initial={mine ? { addressId: mine.addressId, deliveryDate: mine.deliveryDate.toISOString().slice(0, 10), lines: Object.fromEntries(mine.lines.map((x) => [x.itemId, x.qty])) } : null} />
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}</div>
      ))}

      {tab === "MINE" && pre && (!pre.reservations.length ? <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{l.noMine}</p></CardContent></Card> : (
        <div className="space-y-4">{pre.reservations.map((r) => (
          <Card key={r.id} data-testid="po-mine" data-status={r.status}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="min-w-0 flex-1 basis-60 break-words">{r.title} <span className="text-xs font-normal text-muted-foreground">{r.number}</span></CardTitle>
                <Badge variant={RES_TONE[r.status]}>{l[`resStatus.${r.status}`]}</Badge>
              </div>
              <CardDescription>{l.deliveryDate}: {day(r.deliveryDate)} · {fill(l.closes, { date: day(r.closesAt) })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2 font-medium">{l.product}</th><th className="px-2 py-1 text-right font-medium">{l.asked}</th><th className="px-2 py-1 text-right font-medium">{l.given}</th><th className="py-1 pl-2 text-right font-medium">{l.finalPrice}</th></tr></thead>
                <tbody>{r.lines.map((x) => <tr key={x.itemId} className="border-t"><td className="py-1 pr-2">{x.product} <span className="text-xs text-muted-foreground">{x.pack}</span></td><td className="px-2 py-1 text-right tabular-nums">{x.qty}</td><td className="px-2 py-1 text-right tabular-nums" data-testid="po-given">{x.allocatedQty ?? l.none}</td><td className="py-1 pl-2 text-right tabular-nums">{eur(x.unitNet)}</td></tr>)}</tbody>
              </table></div>
              {r.deposit.amount > 0 && (r.deposit.paid ? <p className="text-[color:var(--success,#16a34a)]">{l.depositPaid} ({eur(r.deposit.amount)})</p> : <p>{fill(l.depositDue, { amount: eur(r.deposit.amount) })} {r.deposit.link && <a className="font-medium text-primary underline" href={r.deposit.link} data-testid="po-pay">{l.payDeposit} →</a>}</p>)}
              {r.status === "ALLOCATED" && <p className="text-amber-700 dark:text-warning">{l.allocatedHint}</p>}
              {r.failReason && <p className="text-destructive">{fill(l.failed, { reason: r.failReason })}</p>}
              {r.cancelReason && r.status !== "ORDERED" && <p className="text-muted-foreground">{fill(l.reason, { reason: r.cancelReason })}</p>}
              {r.orders.length > 0 && <p>{l.orders}: {r.orders.map((o) => <a key={o.id} className="mr-2 text-primary underline" href={`/buy/orders/${o.id}`} data-testid="po-order">{o.number}</a>)}</p>}
              {canPlace && (r.canEdit || r.status === "ALLOCATED") && <ReservationActions l={l} id={r.id} canCancel={r.canEdit} needsAnswer={r.status === "ALLOCATED"} />}
            </CardContent>
          </Card>
        ))}</div>
      ))}

      {tab === "LOCKS" && locks && (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">{l.lockIntro}</p>
          {canPlace && (
            <Card>
              <CardHeader><CardTitle>{l.lockSuggest}</CardTitle></CardHeader>
              <CardContent>{!locks.suggestions.length ? <p className="text-sm text-muted-foreground">{l.noSuggest}</p> : (
                <ul className="divide-y">{locks.suggestions.map((x) => (
                  <li key={x.offerId} className="space-y-2 py-3" data-testid="pl-suggest">
                    <div className="flex flex-wrap items-baseline gap-2 text-sm"><span className="min-w-0 flex-1 basis-56 break-words font-medium">{x.product} <span className="text-xs font-normal text-muted-foreground">{x.pack} · {x.vendor}</span></span><span className="tabular-nums">{l.priceToday}: <b>{eur(x.price)}</b></span><span className="text-xs text-muted-foreground">{fill(l.lockSuggestHint, { n: x.perMonth })}</span></div>
                    <LockRequest l={l} offerId={x.offerId} perMonth={x.perMonth} maxMonths={locks.settings.maxLockMonths} />
                  </li>
                ))}</ul>
              )}</CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="size-4" /> {l.tabLocks}</CardTitle></CardHeader>
            <CardContent>{!locks.locks.length ? <p className="text-sm text-muted-foreground">{l.noLocks}</p> : (
              <ul className="divide-y">{locks.locks.map((x) => (
                <li key={x.id} className="space-y-2 py-3 text-sm" data-testid="pl-lock" data-status={x.status}>
                  <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 basis-56 break-words font-medium">{x.product} <span className="text-xs font-normal text-muted-foreground">{x.pack} · {x.vendor} · {x.number}</span></span><Badge variant={LOCK_TONE[x.status]}>{l[`lockStatus.${x.status}`]}</Badge></div>
                  <p className="tabular-nums">{l.lockedPrice}: <b data-testid="pl-price">{eur(x.unitNet)}</b> <span className="text-xs text-muted-foreground">({l.listPrice}: {eur(x.listUnitNet)})</span> · {fill(l.taken, { taken: x.qtyTaken, total: x.qtyTotal })}{x.validUntil ? ` · ${fill(l.until, { date: day(x.validUntil) })}` : ""}</p>
                  {x.status === "ACTIVE" && <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted" role="img" aria-label={fill(l.taken, { taken: x.qtyTaken, total: x.qtyTotal })}><div className="h-full bg-primary" style={{ width: `${x.pctTaken}%` }} /></div>}
                  {x.status === "ACTIVE" && x.perMonth > 0 && <p className="text-xs text-muted-foreground">{fill(l.perMonthHint, { n: x.perMonth })}{x.saved > 0 ? ` · ${fill(l.saved, { amount: eur(x.saved) })}` : ""}</p>}
                  {x.deposit.amount > 0 && (x.deposit.paid ? <p className="text-[color:var(--success,#16a34a)]">{l.depositPaid} ({eur(x.deposit.amount)})</p> : <p>{fill(l.depositDue, { amount: eur(x.deposit.amount) })} {x.deposit.link && <a className="font-medium text-primary underline" href={x.deposit.link}>{l.payDeposit} →</a>}</p>)}
                  {x.reviewNote && <p className="text-muted-foreground">{fill(l.reason, { reason: x.reviewNote })}</p>}
                  {canPlace && x.status === "ACTIVE" && x.left > 0 && (!x.deposit.amount || x.deposit.paid) && <CallOff l={l} id={x.id} left={x.left} perMonth={x.perMonth} addresses={addresses} />}
                  {canPlace && ["REQUESTED", "REVIEW"].includes(x.status) && <LockCancel l={l} id={x.id} />}
                  {x.calloffs.length > 0 && <p className="text-xs text-muted-foreground"><PackageCheck className="mr-1 inline size-3" />{l.calloffs}: {x.calloffs.map((c) => <a key={c.orderId} className="mr-2 underline" href={`/buy/orders/${c.orderId}`}>{c.orderNumber} ({c.qty})</a>)}</p>}
                </li>
              ))}</ul>
            )}</CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

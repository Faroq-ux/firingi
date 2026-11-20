import Link from "next/link";
import { notFound } from "next/navigation";
import { ShoppingBasket } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { roundDetail } from "@/server/buying-groups/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fill, groupLabels } from "@/components/buying-groups/labels";
import { RoundAdmin, RoundLines } from "@/components/buying-groups/client";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Group Order" };
export const dynamic = "force-dynamic";

export default async function GroupRoundPage({ params }: { params: Promise<{ id: string; roundId: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place", "company.profile.manage"]);
  const { id, roundId } = await params;
  const [{ l, locale }, d] = await Promise.all([groupLabels(), roundDetail(ctx, roundId).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; })]);
  if (d.round.groupId !== id) notFound();
  const manager = ctx.membership.isOwner || ctx.permissions.has("company.profile.manage");
  const canOrder = ctx.permissions.has("buyer.orders.place");
  const r = d.round;
  const myOrder = d.mine.find((m) => m.orderId)?.orderId ?? null, myError = d.mine.find((m) => m.error)?.error ?? null;
  return (
    <>
      <PageHeader title={r.title} icon={ShoppingBasket} eyebrow={d.group.name}
        description={<>{d.supplier} · {d.open ? fill(l.closes, { date: formatDate(r.closesAt, locale, true) }) : l.closedNote} · {fill(l.deliveredOn, { date: formatDate(r.deliveryDate, locale) })}</>} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/buy/groups/${id}`} className="text-primary hover:underline">← {l.back}</Link>
        <Badge variant={r.status === "OPEN" ? "success" : "secondary"} data-testid="bg-round-status">{l[`roundStatus.${r.status}`]}</Badge>
        <span className="text-muted-foreground">{fill(l.membersN, { n: d.memberCount })}</span>
      </div>
      {r.note && <p className="mb-4 whitespace-pre-line break-words rounded-xl border p-4 text-sm">{r.note}</p>}
      {d.admin && manager && r.status === "OPEN" && <div className="mb-6"><RoundAdmin l={l} roundId={r.id} /></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{l.myLines}</CardTitle></CardHeader>
          <CardContent>
            {d.open && canOrder && !d.canBuy && <p className="mb-3 rounded-lg border border-dashed p-3 text-sm" data-testid="bg-not-for-you">{l.notForYou}</p>}
            {d.open && canOrder && d.canBuy ? <RoundLines l={l} roundId={r.id} mine={d.mine.map((m) => ({ offerId: m.offerId, label: m.label, qty: m.qty, addressId: m.addressId }))} addresses={d.addresses} /> : (
              <div className="space-y-3 text-sm">
                {!d.mine.length ? <p className="text-muted-foreground">{l.noLines}</p> : <ul className="divide-y" data-testid="bg-my-lines">{d.mine.map((m) => <li key={m.offerId} className="flex justify-between gap-2 py-1.5" data-testid="bg-my-line"><span className="min-w-0 break-words">{m.label}</span><span className="tabular-nums">{m.qty}</span></li>)}</ul>}
                {myOrder && <Link href={`/buy/orders/${myOrder}`} className="inline-block text-primary hover:underline" data-testid="bg-my-order">{l.order} →</Link>}
                {myError && <p className="text-destructive" role="alert">{fill(l.failed, { reason: myError })}</p>}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{l.totals}</CardTitle><CardDescription>{l.totalsHint}</CardDescription></CardHeader>
          <CardContent>
            {!d.totals.length ? <p className="text-sm text-muted-foreground">{l.noLines}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="bg-totals"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2 font-normal">{l.product}</th><th className="py-1 pr-2 text-right font-normal">{l.units}</th><th className="py-1 text-right font-normal">{l.membersCol}</th></tr></thead>
                  <tbody>{d.totals.map((t) => <tr key={t.offerId} className="border-t"><td className="break-words py-1.5 pr-2">{t.label}</td><td className="py-1.5 pr-2 text-right tabular-nums">{t.qty}</td><td className="py-1.5 text-right tabular-nums">{t.members}</td></tr>)}</tbody></table>
              </div>
            )}
          </CardContent>
        </Card>
        {d.members.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>{l.memberOrders}</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y text-sm" data-testid="bg-member-orders">
                {d.members.map((m) => (
                  <li key={m.companyId} className="flex flex-wrap items-center gap-2 py-2" data-testid="bg-member-order">
                    <span className="min-w-0 flex-1 break-words">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{fill(l.linesN, { n: m.lines })} · {m.units} {l.units.toLowerCase()}</span>
                    {m.orderId && <Badge variant="success">{l["roundStatus.PLACED"]}</Badge>}
                    {m.error && <span className="basis-full break-words text-xs text-destructive">{fill(l.failed, { reason: m.error })}</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

import { Gift, PartyPopper, Sparkles, Trophy } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myBonuses } from "@/server/rebates/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fill, rebateLabels, rulesText } from "@/components/rebates/labels";
import { AddFreeToCart, BonusBar } from "@/components/rebates/client";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "My Bonuses" };
export const dynamic = "force-dynamic";

export default async function MyBonusesPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"]);
  const [{ l, locale }, m] = await Promise.all([rebateLabels(), myBonuses(ctx)]);
  const money = (n: number) => formatMoney(n, locale);
  const canBuy = ctx.permissions.has("buyer.orders.place");
  const nextText = (n: { missing: number; unit: string; pct?: number; freeUnits?: number } | null, kind: string) => {
    if (!n) return l.topReached;
    if (n.unit === "PRODUCTS") return fill(l["missing.PRODUCTS"], { missing: n.missing });
    if (n.unit === "UNITS") return n.freeUnits ? fill(l["missing.UNITS_FREE"], { missing: n.missing, free: n.freeUnits }) : fill(l["missing.UNITS"], { missing: n.missing, pct: n.pct ?? 0 });
    return fill(l[kind === "GROWTH" ? "missing.GROWTH" : "missing.AMOUNT"], { missing: money(n.missing), pct: n.pct ?? 0 });
  };
  const tiles = [
    { icon: Trophy, label: l.earnedYear, value: money(m.totals.year), id: "rb-earned-year" },
    { icon: Gift, label: l.freeLeft, value: String(m.totals.freeLeft), id: "rb-free-left" },
    { icon: Sparkles, label: l.runningCount, value: String(m.running.length), id: "rb-running-count" },
  ];
  return (
    <>
      <PageHeader title={l.myTitle} icon={PartyPopper} description={l.myIntro} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.id}><CardContent className="flex items-center gap-3 pt-5"><t.icon className="size-6 shrink-0 text-primary" /><div className="min-w-0"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-xl font-semibold tabular-nums" data-testid={t.id}>{t.value}</p></div></CardContent></Card>
        ))}
      </div>

      <h2 className="mb-3 text-lg font-semibold">{l.running}</h2>
      {!m.running.length ? <p className="mb-6 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{l.noRunning}</p> : (
        <div className="mb-6 grid gap-4 lg:grid-cols-2" data-testid="rb-running">
          {m.running.map((b) => (
            <Card key={b.id} data-testid="rb-bonus">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="break-words text-base">{b.name}</CardTitle>
                  <Badge variant="secondary">{l[`kind.${b.kind}`]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{fill(l.fromSupplier, { supplier: b.supplier })} · {l[`period.${b.period}`]} · {b.startsAt ? fill(l.startsOn, { date: formatDate(b.startsAt, locale) }) : fill(l.periodEnds, { date: formatDate(new Date(b.periodEnd.getTime() - 86_400_000), locale) })}</p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="break-words">{rulesText(l, b.rules, locale)}{b.kind === "FREE_GOODS" && b.rewardOfferId ? ` — ${m.labels[b.rewardOfferId] ?? ""}` : ""}</p>
                {b.description && <p className="break-words text-muted-foreground">{b.description}</p>}
                {b.group && <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs" data-testid="rb-group">{fill(l.groupProgress, { name: b.group.name, amount: money(b.group.stats.amount), n: b.group.members })}</p>}
                {b.rows.map((r) => (
                  <div key={r.branchId || "all"} className="space-y-1.5 rounded-lg border p-3">
                    {b.perShop && r.branchId && <p className="text-xs font-medium">{m.branches[r.branchId] ?? ""}</p>}
                    <p className="text-xs text-muted-foreground">
                      {b.kind === "FREE_GOODS" || (b.kind === "VOLUME" && (b.rules as { basis?: string }).basis === "UNITS") ? fill(l.unitsSoFar, { n: r.stats.units }) : fill(l.boughtSoFar, { amount: money(r.stats.amount) })}
                      {b.kind === "GROWTH" ? ` · ${fill(l.lastYear, { amount: money(r.stats.previousAmount) })}` : ""}
                      {b.kind === "MIX" ? ` · ${fill(l.productsSoFar, { n: r.stats.distinct })}` : ""}
                    </p>
                    {b.kind === "GROWTH" && r.stats.previousAmount <= 0 ? <p className="text-xs text-muted-foreground">{l.noHistory}</p> : (
                      <BonusBar pct={r.result.progress} label={nextText(r.result.next, b.kind)} testid="rb-progress" />
                    )}
                    <p className="font-medium" data-testid="rb-earning">{b.kind === "FREE_GOODS" ? fill(l.freeNow, { n: r.result.freeUnits }) : fill(l.earningNow, { value: money(r.result.value) })}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{l.freeGoods}</CardTitle></CardHeader>
          <CardContent>
            {!m.freeGoods.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noFreeGoods}</p> : (
              <ul className="divide-y" data-testid="rb-free-goods">
                {m.freeGoods.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">{g.product}</p>
                      <p className="text-xs text-muted-foreground">{g.name} · {g.expired ? l.expired : fill(l.takeBy, { date: formatDate(g.expiresAt, locale) })} · {fill(l.left, { n: g.left })}</p>
                    </div>
                    {!g.expired && g.left > 0 && canBuy && <AddFreeToCart l={l} offerId={g.offerId} qty={g.left} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{l.earnedTitle}</CardTitle></CardHeader>
          <CardContent>
            {!m.earned.length ? <p className="py-4 text-center text-sm text-muted-foreground">{l.noEarned}</p> : (
              <ul className="divide-y" data-testid="rb-earned">
                {m.earned.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                    <div className="min-w-0 flex-1"><p className="break-words font-medium">{e.name}</p><p className="text-xs text-muted-foreground">{e.supplier} · {e.periodKey} · {formatDate(e.at, locale)}</p></div>
                    <span className="font-semibold tabular-nums">{e.freeUnits ? fill(l.freeInCart, { n: e.freeUnits }) : money(e.value)}</span>
                    {e.creditNoteIds.length > 0 && <a className="text-xs text-primary hover:underline" href={`/api/invoices/${e.creditNoteIds[0]}/pdf`} target="_blank" rel="noreferrer">{l.creditNote}</a>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

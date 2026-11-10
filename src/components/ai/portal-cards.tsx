/** AI cards for the supplier and customer portals (server; translated). */
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PackageX, Repeat } from "lucide-react";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { canAi, reorderPredictions, stockPredictions, type ReorderRow, type StockRow } from "@/server/ai/insights";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BuyAgainButton } from "./actions";

const money = (n: number, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n);
const day = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));

/** "Late / due / in N days" for a usual order. */
export function dueLabel(t: Awaited<ReturnType<typeof getTranslations<"ai">>>, r: Pick<ReorderRow, "overdueDays">) {
  return r.overdueDays > 0 ? t("buyAgain.lateBy", { days: r.overdueDays }) : r.overdueDays === 0 ? t("buyAgain.dueToday") : t("buyAgain.upcoming", { days: -r.overdueDays });
}

/** One supplier's usual order with the "add to cart" button. */
export async function UsualOrder({ r, locale, compact = false }: { r: ReorderRow; locale: string; compact?: boolean }) {
  const t = await getTranslations("ai");
  const late = r.overdueDays > 0;
  return (
    <div className={`rounded-xl border bg-card/70 p-3 ${late ? "border-[color:var(--vivid-pink)]" : ""}`} data-testid="usual-order">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{r.seller}</span>
        <Badge variant={late ? "destructive" : r.overdueDays === 0 ? "warning" : "secondary"}>{dueLabel(t, r)}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{t("buyAgain.every", { days: Math.round(r.gapDays) })} · {t("buyAgain.lastOrder", { date: day(r.lastOrder, locale) })}</span>
      </div>
      {!compact && (
        <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
          {r.basket.map((b) => <li key={b.offerId} className={b.available ? "" : "text-muted-foreground line-through"}><span className="tabular-nums font-medium">{b.qty} ×</span> {b.product} <span className="text-xs text-muted-foreground">{b.pack}{b.available ? "" : ` — ${t("buyAgain.notAvailable")}`}</span></li>)}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("buyAgain.usual", { amount: money(r.usualNet, locale) })}</span>
        <BuyAgainButton sellerId={r.sellerId} locale={locale} label={t("buyAgain.button")} done={t("buyAgain.added", { n: "{n}" })} cartHref="/buy/orders/cart" cartLabel={t("buyAgain.goToCart")} variant={late ? "default" : "outline"} />
      </div>
    </div>
  );
}

/** Customer dashboard: suppliers due (or late) for the usual order. */
export async function ReorderCard({ ctx, locale }: { ctx: Ctx; locale: string }) {
  if (!can(ctx, "buyer.orders.place") || !canAi(ctx, "BUYER")) return null;
  const rows = (await reorderPredictions(ctx, "BUYER", { locale, onlyDue: true, dueWithinDays: 2 })).slice(0, 3);
  if (!rows.length) return null;
  const t = await getTranslations("ai");
  return (
    <Card className="tile gloss tone-blue motion-rise" style={{ ["--i" as string]: 2 }} data-testid="reorder-card">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Repeat className="size-5 text-[color:var(--vivid-blue)] motion-float" aria-hidden /> {t("buyAgain.dashboardTitle")}</CardTitle>
        <Link href="/buy/orders/buy-again" className="text-sm text-primary underline-offset-4 hover:underline">{t("buyAgain.seeAll")} →</Link>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-3">{rows.map((r) => <UsualOrder key={r.sellerId} r={r} locale={locale} compact />)}</CardContent>
    </Card>
  );
}

const STATUS_TONE: Record<string, "destructive" | "warning" | "secondary" | "success"> = { OUT: "destructive", CRITICAL: "destructive", LOW: "warning", OK: "success", NO_SALES: "secondary" };
export async function StockBadge({ s }: { s: Pick<StockRow, "status"> }) {
  const t = await getTranslations("ai");
  return <Badge variant={STATUS_TONE[s.status]}>{t(`status.${s.status}`)}</Badge>;
}

/** Supplier dashboard: products that run out soon. */
export async function StockCard({ ctx, locale }: { ctx: Ctx; locale: string }) {
  if (!canAi(ctx, "VENDOR")) return null;
  const rows = (await stockPredictions(ctx, "VENDOR", { locale, onlyAtRisk: true })).filter((r) => r.dailyUnits > 0).slice(0, 5);
  const t = await getTranslations("ai");
  return (
    <Card className="tile gloss tone-pink motion-rise" style={{ ["--i" as string]: 8 }} data-testid="stock-card">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><PackageX className="size-5 text-[color:var(--vivid-pink)] motion-float" aria-hidden /> {t("demand.dashboardTitle")}</CardTitle>
        <Link href="/vendor/reports/demand" className="text-sm text-primary underline-offset-4 hover:underline">{t("demand.seeAll")} →</Link>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.offerId} className="flex items-center gap-2 rounded-lg border bg-card/70 p-2">
            <span className="min-w-0 flex-1 truncate"><span className="font-medium">{r.product}</span> <span className="text-xs text-muted-foreground">{r.pack}</span></span>
            <span className="tabular-nums text-xs text-muted-foreground">{r.available} · {r.days ?? 0} d</span>
            <StockBadge s={r} />
          </div>
        ))}
        {!rows.length && <p className="py-4 text-center text-muted-foreground">{t("demand.dashboardNone")}</p>}
      </CardContent>
    </Card>
  );
}

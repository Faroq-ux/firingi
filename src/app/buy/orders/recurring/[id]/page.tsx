import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getRecurring } from "@/server/buying/recurring";
import { deliveryAddressOptions } from "@/server/inventory/options";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EditSchedule, RecurringActions, RecurringItems } from "@/components/buying/controls";
import { RECURRING_TONE, badgeVariant } from "@/lib/buying";

export const metadata = { title: "Recurring order" };

export default async function RecurringPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view"]);
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const r = await getRecurring(ctx, (await params).id, locale);
  const canPlace = ctx.permissions.has("buyer.orders.place");
  const addresses = canPlace ? await deliveryAddressOptions(ctx) : [];
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const short = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const editable = canPlace && r.status !== "ENDED";
  return (
    <>
      <PageHeader title={r.name} description={r.createdBy ? t("setUpBy", { name: r.createdBy }) : undefined} actions={<Badge variant={badgeVariant(RECURRING_TONE[r.status])} data-testid="recurring-status">{t(`rs.${r.status}`)}</Badge>} />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">{t("nextOrder")}</p><p className="text-lg font-semibold" data-testid="next-run">{r.status === "ACTIVE" ? date.format(r.nextRunAt) : "—"}</p>{r.skipNext && <Badge variant="warning">{t("willSkip")}</Badge>}</CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">{t("lastRun")}</p><p className="text-lg font-semibold">{r.lastResult ? t(`run.${r.lastResult}`) : "—"}</p><p className="text-xs text-muted-foreground">{r.lastRunAt ? short.format(r.lastRunAt) : ""}{r.lastOrders.length ? " · " : ""}{r.lastOrders.map((o, i) => <span key={o.id}>{i ? ", " : ""}<Link className="font-mono hover:underline" href={`/buy/orders/${o.id}`}>{o.number}</Link></span>)}</p>{r.lastError && <p className="mt-1 text-xs text-destructive" data-testid="last-error">{r.lastError}</p>}</CardContent></Card>
        <Card><CardContent className="pt-6"><p className="text-xs uppercase tracking-wider text-muted-foreground">{t("ordersPlaced")}</p><p className="text-lg font-semibold">{r.runs}</p></CardContent></Card>
      </div>
      {r.status === "PENDING_APPROVAL" && r.approvalId && <Card className="mb-6 border-amber-500/40"><CardContent className="pt-6 text-sm">{t("recurringNeedsApproval")} <Link className="underline" href={`/buy/orders/approvals/${r.approvalId}`}>{t("openApproval")}</Link></CardContent></Card>}
      {editable && <div className="mb-6"><RecurringActions id={r.id} status={r.status} skipNext={r.skipNext} /></div>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card><CardHeader><CardTitle>{t("products")}</CardTitle></CardHeader><CardContent><RecurringItems id={r.id} lines={r.lines} editable={editable} locale={locale} /></CardContent></Card>
        <Card><CardHeader><CardTitle>{t("schedule")}</CardTitle></CardHeader><CardContent>{editable ? <EditSchedule id={r.id} frequency={r.frequency} weekday={r.weekday} dayOfMonth={r.dayOfMonth} addressId={r.deliveryAddressId} addresses={addresses} remind={r.remindDaysBefore} /> : <p className="text-sm text-muted-foreground">{t(`freq.${r.frequency}`)}</p>}</CardContent></Card>
      </div>
    </>
  );
}

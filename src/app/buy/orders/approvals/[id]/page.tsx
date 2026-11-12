import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { getApproval } from "@/server/buying/approvals";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DecideApproval } from "@/components/buying/controls";
import { APPROVAL_TONE, badgeVariant } from "@/lib/buying";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Approval" };

export default async function ApprovalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.orders.place", "buyer.orders.view", "buyer.orders.approve"]);
  const sp = await searchParams;
  const [t, locale] = await Promise.all([getTranslations("buying"), getLocale()]);
  const a = await getApproval(ctx, (await params).id, locale);
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <PageHeader title={t(a.kind === "RECURRING" ? "approvalRecurring" : "approvalOrder")} description={`${a.requestedBy ?? ""} · ${date.format(a.createdAt)}`} actions={<Badge variant={badgeVariant(APPROVAL_TONE[a.status])} data-testid="approval-status">{t(`as.${a.status}`)}</Badge>} />
      {sp.sent && <Card className="mb-4 border-amber-500/40"><CardContent className="pt-6 text-sm" role="status" data-testid="approval-sent">{t("sentForApproval")}</CardContent></Card>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader><CardTitle>{t("products")}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="approval-lines">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">{t("product")}</th><th className="py-1 pr-3 font-medium">{t("supplier")}</th><th className="py-1 text-right font-medium">{t("qty")}</th></tr></thead>
                <tbody>{a.lines.map((l) => <tr key={l.offerId} className="border-t"><td className="py-2 pr-3"><div className="font-medium">{l.product}</div><div className="text-xs text-muted-foreground">{l.packaging}{l.sku ? ` · ${l.sku}` : ""}</div></td><td className="py-2 pr-3">{l.supplier}</td><td className="py-2 text-right tabular-nums">{l.qty}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="mt-3 text-right text-sm">{t("totalInclVat")}: <b className="tabular-nums" data-testid="approval-total">{formatMoney(a.grossTotal, locale)}</b></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("decision")}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><span className="text-muted-foreground">{t("rules")}:</span> {a.reasons.join(", ")}</p>
            {a.address && <p><span className="text-muted-foreground">{t("deliveryAddress")}:</span> {a.address.label} — {a.address.line1}, {a.address.cityName}</p>}
            {a.notes && <p><span className="text-muted-foreground">{t("notes")}:</span> {a.notes}</p>}
            {a.decidedBy && <p><span className="text-muted-foreground">{t("decidedBy")}:</span> {a.decidedBy}{a.decisionNote ? ` — ${a.decisionNote}` : ""}</p>}
            {a.orders.length > 0 && <p>{t("ordersPlaced")}: {a.orders.map((o, i) => <span key={o.id}>{i ? ", " : ""}<Link className="font-mono underline" href={`/buy/orders/${o.id}`}>{o.number}</Link></span>)}</p>}
            {a.recurringId && <p><Link className="underline" href={`/buy/orders/recurring/${a.recurringId}`}>{t("openRecurring")}</Link></p>}
            {a.quoteId && <p><Link className="underline" href={`/buy/orders/quotes/${a.quoteId}`}>{t("openQuote")}</Link></p>}
            <DecideApproval id={a.id} canDecide={a.canDecide} canCancel={a.canCancel} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

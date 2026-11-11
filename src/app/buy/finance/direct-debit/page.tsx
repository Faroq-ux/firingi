import { getLocale, getTranslations } from "next-intl/server";
import { Landmark } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MandateControls, SetUpDebitButton } from "@/components/payments/direct-debit";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { availableMethods, buyerPaymentOverview, myMandates } from "@/server/payments/service";
import { paymentPolicy } from "@/server/services/payments";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ return?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.payments.make", "buyer.payments.view"]);
  const [t, locale, mandates, avail, policy, overview, sp] = await Promise.all([getTranslations("pay"), getLocale(), myMandates(ctx), availableMethods(ctx.company.id), paymentPolicy(), buyerPaymentOverview(ctx), searchParams]);
  const active = mandates.find((m) => m.status === "ACTIVE");
  const pending = mandates.find((m) => m.status === "PENDING");
  const manage = can(ctx, "buyer.payments.make");
  const money = (v: string) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(v));
  const upcoming = overview.invoices.filter((i) => i.dueAt);
  return (
    <>
      <PageHeader title={t("dd.title")} description={t("dd.intro", { days: policy.online.directDebitNoticeDays })} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="dd-status">
          <CardHeader><CardTitle className="flex items-center gap-2"><Landmark className="size-5" aria-hidden />{t("dd.title")}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!avail.methods.includes("DIRECT_DEBIT") && !active ? <p>{t("dd.notAvailable")}</p> : active ? (
              <>
                <p><Badge variant="success" className="mr-2">{t("statuses.ACTIVE")}</Badge><span data-testid="dd-active">{t("dd.active", { last4: active.ibanLast4 ?? "····" })}</span></p>
                <p className="text-muted-foreground">{t("dd.holder")}: {active.holderName ?? "—"} · {t("dd.since", { date: active.signedAt ? active.signedAt.toLocaleDateString(locale) : "—" })}</p>
                {manage && <MandateControls id={active.id} autoCollect={active.autoCollect} />}
                {manage && <SetUpDebitButton replace />}
              </>
            ) : (
              <>
                <p>{pending && sp.return === "1" ? t("dd.pending") : t("dd.none")}</p>
                {manage && <SetUpDebitButton />}
              </>
            )}
            <p className="text-xs text-muted-foreground">{t("dd.legal")}</p>
          </CardContent>
        </Card>
        {active && (
          <Card data-testid="dd-upcoming">
            <CardHeader><CardTitle>{t("dd.upcoming")}</CardTitle></CardHeader>
            <CardContent>
              {upcoming.length && active.autoCollect ? (
                <ul className="divide-y text-sm">
                  {upcoming.map((i) => <li key={i.id} className="flex justify-between gap-2 py-2"><span><span className="font-mono text-xs">{i.number}</span> <span className="text-muted-foreground">{t("dd.dueOn", { date: new Date(i.dueAt!).toLocaleDateString(locale) })}</span></span><span className="tabular-nums">{money(i.open)}</span></li>)}
                </ul>
              ) : <p className="text-sm text-muted-foreground">{t("dd.noUpcoming")}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { claimableOrder, claimsForOrder } from "@/server/claims/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewClaimForm } from "@/components/claims/forms";
import { CLAIM_STATUS_TONE } from "@/components/claims/views";

export const metadata = { title: "Report a problem" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.claims.manage");
  const { id } = await params;
  const c = await claimableOrder(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const [t, locale, earlier] = await Promise.all([getTranslations("claims"), getLocale(), claimsForOrder(id)]);
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  return (
    <>
      <PageHeader title={t("newTitle", { number: c.number })} description={t("newIntro", { hours: c.windowHours })} icon={ShieldAlert} />
      {earlier.length > 0 && (
        <Card className="mb-6"><CardHeader><CardTitle>{t("earlier")}</CardTitle></CardHeader><CardContent>
          <ul className="divide-y text-sm">{earlier.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-2 py-2"><Link href={`/buy/orders/claims/${x.id}`} className="font-medium text-primary hover:underline">{x.number}</Link><Badge variant="secondary">{t(`reason.${x.reason}`)}</Badge><Badge variant={CLAIM_STATUS_TONE[x.status]}>{t(`status.${x.status}`)}</Badge></li>)}</ul>
        </CardContent></Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{c.supplier}</CardTitle>
          <CardDescription>{c.deadline ? (c.open ? t("deadline", { date: fmt(c.deadline) }) : t("closedSince", { date: fmt(c.deadline) })) : t("notDelivered")}</CardDescription>
        </CardHeader>
        <CardContent>
          {c.open && c.lines.some((l) => l.claimable > 0)
            ? <NewClaimForm orderId={c.id} lines={c.lines} photoReasons={c.photoReasons} />
            : <p className="text-sm text-muted-foreground" data-testid="claim-closed">{c.open ? t("nothingLeft") : t("windowClosed", { hours: c.windowHours })}</p>}
        </CardContent>
      </Card>
    </>
  );
}

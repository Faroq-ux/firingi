import Link from "next/link";
import { BadgeCheck, Clock, Euro, ShieldAlert } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { claimSettings, listClaims } from "@/server/claims/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tile } from "@/components/motion/dashboard-kit";
import { CLAIM_STATUS_TONE } from "@/components/claims/views";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quality Claims" };
const STATUSES = ["OPEN", "APPROVED", "REJECTED", "WITHDRAWN"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.claims.manage", "buyer.orders.view"]);
  const sp = await searchParams;
  const status = STATUSES.find((x) => x === sp.status);
  const [all, t, locale, s] = await Promise.all([listClaims(ctx, "BUYER"), getTranslations("claims"), getLocale(), claimSettings()]);
  const rows = status ? all.filter((r) => r.status === status) : all;
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(d);
  const credited = all.reduce((a, r) => a + (r.credit ?? 0), 0);
  return (
    <>
      <PageHeader title={t("title")} description={t("buyerIntro", { hours: s.windowHours })} icon={ShieldAlert} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={Clock} label={t("kpi.open")} value={all.filter((r) => r.status === "OPEN").length} locale={locale} tone="tone-orange" i={0} href="?status=OPEN" testId="kpi-claims-open" />
        <Tile icon={BadgeCheck} label={t("kpi.approved")} value={all.filter((r) => r.status === "APPROVED").length} locale={locale} tone="tone-teal" i={1} href="?status=APPROVED" />
        <Tile icon={Euro} label={t("kpi.credited")} value={credited} fmt="money" locale={locale} tone="tone-violet" i={2} />
        <Tile icon={ShieldAlert} label={t("kpi.replacements")} value={all.filter((r) => r.replacementPending).length} locale={locale} tone="tone-blue" i={3} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Link href="?" className={!status ? "font-semibold" : "text-muted-foreground hover:underline"}>{t("all")}</Link>
        {STATUSES.map((x) => <Link key={x} href={`?status=${x}`} className={status === x ? "font-semibold" : "text-muted-foreground hover:underline"}>{t(`status.${x}`)}</Link>)}
      </div>
      <Card><CardContent className="pt-5">
        <Table data-testid="claims-table">
          <THead><TR><TH>{t("claim")}</TH><TH>{t("order")}</TH><TH>{t("reasonCol")}</TH><TH>{t("products")}</TH><TH>{t("statusCol")}</TH><TH className="text-right">{t("credit")}</TH><TH>{t("opened")}</TH></TR></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD><Link href={`/buy/orders/claims/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link></TD>
                <TD><Link href={`/buy/orders/${r.orderId}`} className="hover:underline">{r.orderNumber}</Link><div className="text-xs text-muted-foreground">{r.seller}</div></TD>
                <TD>{t(`reason.${r.reason}`)}</TD>
                <TD className="max-w-64 break-words">{r.products}<div className="text-xs text-muted-foreground">{t("units", { qty: r.units })}</div></TD>
                <TD><Badge variant={CLAIM_STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>{r.replacementPending && <div className="mt-1 text-xs text-muted-foreground">{t("replacementPending")}</div>}</TD>
                <TD className="text-right tabular-nums">{r.credit !== null ? formatMoney(r.credit, locale) : "—"}</TD>
                <TD className="whitespace-nowrap">{fmt(r.createdAt)}</TD>
              </TR>
            ))}
            {!rows.length && <EmptyRow colSpan={7}>{t("emptyBuyer")}</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>
    </>
  );
}

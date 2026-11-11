import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { expiringBatches } from "@/server/inventory/service";
import { markdownSuggestions, myFeatures } from "@/server/inventory/expiry";
import { offerLabel } from "@/server/inventory/options";
import { SUPPLIER_FEATURES as FEATURES, FIELD } from "@/server/inventory/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { FeatureRequest, MarkdownButton, WriteOffButton } from "@/components/inventory/controls";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Expiry" };
const RANGES = [0, 7, 14, 30, 90];

export default async function ExpiryPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.inventory.view", "vendor.inventory.manage"]);
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const [t, locale] = await Promise.all([getTranslations("inventory"), getLocale()]);
  const [batches, md, feats] = await Promise.all([expiringBatches(ctx, Math.max(days, 0)), markdownSuggestions(ctx), myFeatures(ctx)]);
  const rows = days === 0 ? batches.filter((b) => b.expired) : batches;
  const manage = can(ctx, "vendor.inventory.manage");
  const date = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <>
      <PageHeader title={t("expiry")} />
      <Card className="mb-6" data-testid="features">
        <CardHeader><CardTitle>{t("features")}</CardTitle><CardDescription>{t("featuresHint")}</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {FEATURES.map((f) => {
            const on = feats.features[FIELD[f]];
            const pend = feats.requests.find((r) => r.feature === f && r.status === "PENDING");
            // the on / off badge is the current state; a rejection is shown with FIRINGI's reason
            const last = feats.requests.find((r) => r.feature === f && r.status !== "PENDING");
            const rejected = last?.status === "REJECTED" ? last : null;
            return (
              <div key={f} className="glass-panel flex flex-col gap-2 rounded-xl border p-3" data-testid={`feature-${f}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><div className="font-medium">{t(`feature.${f}`)}</div><p className="text-xs text-muted-foreground">{t(`feature.${f}_hint`)}</p></div>
                  <Badge variant={on ? "success" : "secondary"}>{on ? t("on") : t("off")}</Badge>
                </div>
                {manage && <FeatureRequest feature={f} on={on} pendingId={pend?.id ?? null} />}
                {rejected && !pend && <p className="text-xs text-muted-foreground">{t("req.REJECTED")}{rejected.reason ? ` — ${rejected.reason}` : ""}</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {md.enabled && (
        <Card className="mb-6" data-testid="markdown">
          <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-[color:var(--vivid-violet)]" />{t("markdown")}</CardTitle><CardDescription>{t("markdownHint")}</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {md.rows.length === 0 && <p className="text-sm text-muted-foreground">{t("noMarkdown")}</p>}
            {md.rows.map((r) => (
              <div key={r.batchId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                <div>
                  <div className="font-medium">{offerLabel(r.product, r.packaging, r.sku, locale)}</div>
                  <div className="text-xs text-muted-foreground">{r.warehouse} · {r.lotCode ?? t("noLot")} · {date.format(r.expiresOn)} ({t("daysLeft", { days: r.daysLeft })}) · {t("free")} {r.free} · {t("pace", { qty: r.perDay })} · {t("unsold", { qty: r.unsold })}</div>
                </div>
                {r.existingPromotion ? <Badge variant="secondary">{t("promoRunning")}</Badge> : manage && <MarkdownButton batchId={r.batchId} percent={r.percent} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <nav className="mb-3 flex flex-wrap gap-2 text-sm">
        {RANGES.map((d) => <Link key={d} href={`?days=${d}`} className={`rounded-full border px-3 py-1 ${d === days ? "border-primary bg-primary/10 font-medium" : ""}`}>{d === 0 ? t("expiredOnly") : t("withinDays", { days: d })}</Link>)}
      </nav>
      <Table data-testid="expiry-table">
        <THead><TR><TH>{t("product")}</TH><TH>{t("warehouse")}</TH><TH>{t("lot")}</TH><TH>{t("bestBefore")}</TH><TH className="text-right">{t("onHand")}</TH><TH className="text-right">{t("value")}</TH><TH /></TR></THead>
        <TBody>
          {rows.length === 0 && <TR><TD colSpan={7} className="py-6 text-center text-muted-foreground">{t("empty")}</TD></TR>}
          {rows.map((b) => (
            <TR key={b.id}>
              <TD><Link className="font-medium hover:underline" href={`/vendor/inventory/stock/${b.offer.id}`}>{offerLabel(b.offer.product, b.offer.packaging, b.offer.sku, locale)}</Link></TD>
              <TD>{b.warehouse}</TD><TD>{b.lotCode ?? <span className="text-muted-foreground">{t("noLot")}</span>}</TD>
              <TD><Badge variant={b.expired ? "destructive" : b.daysLeft <= 7 ? "warning" : "secondary"}>{date.format(b.expiresOn)} · {b.expired ? t("status.EXPIRED") : t("daysLeft", { days: b.daysLeft })}</Badge></TD>
              <TD className="text-right tabular-nums">{b.onHand}{b.reserved ? <span className="text-xs text-muted-foreground"> ({b.reserved})</span> : null}</TD>
              <TD className="text-right tabular-nums">{formatMoney(b.value, locale)}</TD>
              <TD className="text-right">{manage && <WriteOffButton batchId={b.id} max={b.free} />}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

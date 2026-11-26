import { notFound } from "next/navigation";
import { FileText, Printer } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal, can } from "@/server/rbac/guard";
import { providerAccess } from "@/server/servicing/settings";
import { printBoard } from "@/server/servicing/printing";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriceLine, PrintJobActions, PrintProductEditor, type PrintProductRow } from "@/components/services/printing";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Printing" };
export const dynamic = "force-dynamic";
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
const tone = (s: string) => (s === "DELIVERED" ? "success" : s === "REQUESTED" ? "warning" : s === "REJECTED" || s === "CANCELLED" ? "secondary" : "default") as "success" | "warning" | "secondary" | "default";

/** Print supplier: its products (price per item + setup, or quote) and the print orders customers send. */
export default async function VendorPrintingPage() {
  const ctx = await pagePortal("vendor");
  pagePermission(ctx, ["vendor.services.manage", "vendor.services.visit"]);
  if (!(await providerAccess(ctx.company)).on) notFound();
  const [t, locale, b] = await Promise.all([getTranslations("printing"), getLocale(), printBoard(ctx)]);
  const manage = can(ctx, "vendor.services.manage");
  const row = (p: (typeof b.products)[number]): PrintProductRow => ({ id: p.id, kind: p.kind, name: p.name, description: p.description, labelFormat: p.labelFormat, unitPriceNet: n(p.unitPriceNet), setupNet: n(p.setupNet), minQty: p.minQty, stepQty: p.stepQty, priceOnRequest: p.priceOnRequest, vatRate: n(p.vatRate), turnaroundDays: p.turnaroundDays, delivery: p.delivery, active: p.active });
  const youInvoice = b.terms?.invoicedBy === "PROVIDER";
  return (
    <>
      <PageHeader title={t("vTitle")} description={t("vIntro")} icon={Printer} />
      {!b.approved ? <Card><CardContent className="py-6 text-sm text-muted-foreground" data-testid="pp-not-approved">{t("notApproved")}</CardContent></Card> : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("myProducts")}</CardTitle>
              {b.terms && <CardDescription data-testid="pp-terms">{youInvoice ? t("termsProvider", { pct: b.terms.commissionPct }) : t("termsFiringi", { pct: b.terms.commissionPct })}</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-3">
              {manage && <PrintProductEditor />}
              {!b.products.length ? <p className="text-sm text-muted-foreground">—</p> : (
                <ul className="divide-y rounded-lg border">
                  {b.products.map((p) => (
                    <li key={p.id} className="space-y-1 px-3 py-2 text-sm" data-testid="pp-row">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 basis-60 break-words"><span className="font-medium">{p.name}</span> <span className="text-xs text-muted-foreground">· {t(`kinds.${p.kind}`)}</span></span>
                        {!p.active && <Badge variant="secondary">{t("inactive")}</Badge>}
                        {manage && <PrintProductEditor initial={row(p)} />}
                      </div>
                      <p className="text-xs text-muted-foreground"><PriceLine p={row(p)} locale={locale} /> · {t("turnaround", { n: p.turnaroundDays })} · {p.delivery.map((d) => t(`delivery.${d}`)).join(" / ")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("incoming")} <span className="text-sm font-normal text-muted-foreground">{b.jobs.length}</span></CardTitle></CardHeader>
            <CardContent>
              {!b.jobs.length ? <p className="text-sm text-muted-foreground" data-testid="pj-none">{t("noIncoming")}</p> : (
                <ul className="divide-y">
                  {b.jobs.map((j) => (
                    <li key={j.id} className="space-y-1 py-3 text-sm" data-testid="pj-row" data-status={j.status}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 basis-60 break-words"><span className="font-medium">{j.customer}</span> · {j.title} · {j.product.name} × {j.qty} <span className="text-xs text-muted-foreground">{j.number}</span></span>
                        <Badge variant={tone(j.status)}>{t(`st.${j.status}`)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(j.createdAt, locale)} · {t(`delivery.${j.delivery}`)}{j.wantedBy ? ` · ${t("wantedBy")}: ${formatDate(j.wantedBy, locale)}` : ""}
                        {n(j.priceNet) > 0 ? ` · ${t("total", { price: formatMoney(n(j.priceNet), locale) })}` : ""}
                        {j.status === "DELIVERED" && j.invoicedBy === "FIRINGI" && n(j.providerAmount) > 0 ? ` · ${t("yourAmount", { amount: formatMoney(n(j.providerAmount), locale) })}` : ""}
                        {j.notes ? ` · ${j.notes}` : ""}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {j.pdfKey && <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`/api/services/print/${j.id}/file/pdf`} target="_blank" rel="noreferrer" data-testid="pj-pdf"><FileText className="size-3.5" /> {t("labelsPdf")}</a>}
                        {j.artworkNames.map((f, k) => <a key={k} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`/api/services/print/${j.id}/file/${k}`} target="_blank" rel="noreferrer" data-testid="pj-file"><FileText className="size-3.5" /> {f}</a>)}
                        <PrintJobActions id={j.id} steps={j.steps} youInvoice={youInvoice} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

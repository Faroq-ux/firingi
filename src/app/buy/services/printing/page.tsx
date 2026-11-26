import { notFound } from "next/navigation";
import { FileText, Printer } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { myPrintJobs, printAccess, printCatalogue } from "@/server/servicing/printing";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomerPrintActions, PriceLine, PrintOrderForm, type PrintProductRow } from "@/components/services/printing";
import { PRINT_KINDS } from "@/lib/printing";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Printing" };
export const dynamic = "force-dynamic";
const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
const tone = (s: string) => (s === "DELIVERED" ? "success" : s === "QUOTED" ? "warning" : s === "REJECTED" || s === "CANCELLED" ? "secondary" : "default") as "success" | "warning" | "secondary" | "default";

/** Customer: order printing from print suppliers on FIRINGI (leaflets, menus, posters, labels…) and follow the orders. */
export default async function BuyPrintingPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, ["buyer.services.manage", "buyer.services.log"]);
  const a = await printAccess(ctx);
  if (!a.on) notFound();
  const [t, locale, products, jobs] = await Promise.all([getTranslations("printing"), getLocale(), printCatalogue(ctx), myPrintJobs(ctx)]);
  const rows: PrintProductRow[] = products.map((p) => ({ id: p.id, kind: p.kind, name: p.name, description: p.description, supplier: p.supplier, labelFormat: p.labelFormat, unitPriceNet: n(p.unitPriceNet), setupNet: n(p.setupNet), minQty: p.minQty, stepQty: p.stepQty, priceOnRequest: p.priceOnRequest, vatRate: n(p.vatRate), turnaroundDays: p.turnaroundDays, delivery: p.delivery, active: p.active }));
  const kinds = PRINT_KINDS.filter((k) => rows.some((r) => r.kind === k && k !== "SHELF_LABELS"));
  return (
    <>
      <PageHeader title={t("title")} description={t("intro")} icon={Printer} />
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>{t("products")}</CardTitle>{rows.some((r) => r.kind === "SHELF_LABELS") && <CardDescription>{t("labelsFromPage")}</CardDescription>}</CardHeader>
          <CardContent className="space-y-6">
            {!kinds.length ? <p className="text-sm text-muted-foreground" data-testid="pr-none">{t("noProducts")}</p> : kinds.map((k) => (
              <section key={k} className="space-y-2">
                <h3 className="text-sm font-semibold">{t(`kinds.${k}`)}</h3>
                <ul className="divide-y rounded-lg border">
                  {rows.filter((r) => r.kind === k).map((p) => (
                    <li key={p.id} className="space-y-2 px-3 py-3" data-testid="pr-product">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1 basis-60 break-words text-sm">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{t("by", { supplier: p.supplier ?? "" })}{p.description ? ` · ${p.description}` : ""}</div>
                          <div className="text-xs"><PriceLine p={p} locale={locale} /> · {t("turnaround", { n: p.turnaroundDays })} · {p.delivery.map((d) => t(`delivery.${d}`)).join(" / ")}</div>
                        </div>
                        {a.order && <PrintOrderForm p={p} locale={locale} />}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("orders")}</CardTitle></CardHeader>
          <CardContent>
            {!jobs.length ? <p className="text-sm text-muted-foreground" data-testid="pr-no-orders">{t("noOrders")}</p> : (
              <ul className="divide-y">
                {jobs.map((j) => (
                  <li key={j.id} className="space-y-1 py-3 text-sm" data-testid="pr-job" data-status={j.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 basis-60 break-words"><span className="font-medium">{j.title}</span> · {j.product} × {j.qty} <span className="text-xs text-muted-foreground">{j.number} · {j.supplier}</span></span>
                      <Badge variant={tone(j.status)}>{t(`st.${j.status}`)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(j.createdAt, locale)} · {t(`delivery.${j.delivery}`)}
                      {j.status === "QUOTED" ? ` · ${t("quote", { price: formatMoney(j.priceNet, locale) })}` : j.priceNet > 0 ? ` · ${t("total", { price: formatMoney(j.priceNet, locale) })}` : ""}
                      {j.quoteNote ? ` · ${j.quoteNote}` : ""}{j.readyBy && j.status !== "DELIVERED" ? ` · ${t("readyBy", { date: formatDate(j.readyBy, locale) })}` : ""}
                      {j.rejectReason ? ` · ${t("rejected", { reason: j.rejectReason })}` : ""}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {j.hasPdf && <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`/api/services/print/${j.id}/file/pdf`} target="_blank" rel="noreferrer"><FileText className="size-3.5" /> {t("labelsPdf")}</a>}
                      {j.files.map((f, k) => <a key={k} className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={`/api/services/print/${j.id}/file/${k}`} target="_blank" rel="noreferrer"><FileText className="size-3.5" /> {f}</a>)}
                      {a.order && <CustomerPrintActions id={j.id} steps={j.steps} />}
                    </div>
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

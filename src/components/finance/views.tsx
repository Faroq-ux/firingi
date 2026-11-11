/** Finance views shared by the buyer, vendor and admin portals. */
import { DataTable } from "@/components/ui/data-table";
import { listViews } from "@/server/services/workspace";
import { Pager } from "@/components/ui/pager";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileText } from "lucide-react";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import {
  balances, commissionByVendor, financeOverview, listPayments, listSalesInvoices, listStatements, listVendorInvoices, vatReport,
} from "@/server/services/finance";
import { listPromotions, promotionFunding } from "@/server/services/promotions";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import { pickLocalized } from "@/i18n/config";
import { paymentInstructions } from "@/server/services/payments";
import { AcceptButtons, PaymentForm, PromotionStatusButtons, VendorInvoiceReview, VendorInvoiceUpload } from "./controls";

/** Booked by FIRINGI, still being issued at the certified provider (Moloni). */
const pendingFiscal = (r: { externalProvider: string | null; fiscalStatus: string }) => !!r.externalProvider?.startsWith("moloni") && r.fiscalStatus !== "DONE";

const VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "default"> = {
  PAID: "success", APPROVED: "success", CLOSED: "success", MATCHED: "default", ISSUED: "default", ACTIVE: "success", ACCEPTED: "success",
  DISPUTED: "destructive", REJECTED: "destructive", DECLINED: "destructive", OPEN: "warning", PENDING: "warning", SUBMITTED: "warning", INVOICED: "warning",
  PARTIALLY_CREDITED: "warning", CREDITED: "secondary", PAUSED: "secondary", ENDED: "secondary",
};
async function StatusBadge({ status }: { status: string }) {
  const t = await getTranslations("finance.statusLabels");
  return <Badge variant={VARIANT[status] ?? "secondary"}>{t(status as "OPEN")}</Badge>;
}
const pdfLink = (href: string, label = "PDF") => (
  <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><FileText className="size-3.5" />{label}</a>
);

const PAGE = 300;

export async function SalesInvoicesView({ ctx, as, title, docType, buyerType, unpaidOnly, page = 1, basePath, before }: { ctx: Ctx; as: "BUYER" | "ADMIN"; title: string; docType?: "INVOICE" | "CREDIT_NOTE"; buyerType?: "CUSTOMER" | "WHOLESALER"; unpaidOnly?: boolean; page?: number; basePath?: string; before?: React.ReactNode }) {
  const [all, t, locale] = await Promise.all([listSalesInvoices(ctx, { as, docType, buyerType, unpaidOnly }), getTranslations("finance"), getLocale()]);
  const open = all.reduce((a, r) => a + Number(r.open), 0);
  // The balance covers every open invoice; the table shows 50 at a time.
  const pageCount = Math.max(1, Math.ceil(all.length / PAGE));
  const current = Math.min(Math.max(1, page), pageCount);
  const rows = all.slice((current - 1) * PAGE, current * PAGE);
  const howToPay = as === "BUYER" ? await paymentInstructions(ctx.company.countryId) : null;
  return (
    <>
      <PageHeader title={title} description={`${all.length} · ${t("balance")}: ${formatMoney(open, locale)}`} />
      {before}
      {howToPay && (howToPay.bankTransfer || howToPay.mbWay || howToPay.cashOnDelivery) && (
        <Card className="mb-4" data-testid="how-to-pay">
          <CardHeader><CardTitle>{t("howToPay")}</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {howToPay.bankTransfer && <p>{t("payByTransfer", { holder: howToPay.bankTransfer.holder })} <span className="font-mono">{howToPay.bankTransfer.iban}</span></p>}
            {howToPay.mbWay && <p>{t("payByMbWay")} <span className="font-mono">{howToPay.mbWay.phone}</span></p>}
            {howToPay.cashOnDelivery && <p>{t("payOnDelivery")}</p>}
            <p className="text-muted-foreground">{t("payReference")}</p>
          </CardContent>
        </Card>
      )}
      <DataTable tableId={`${as.toLowerCase()}.invoices`} views={await listViews(ctx, `${as.toLowerCase()}.invoices`)} empty={t("noInvoices")} exportName="invoices" testId="invoices-table"
        columns={[
          { key: "number", label: t("number") }, { key: "date", label: t("date"), type: "date" }, ...(as === "ADMIN" ? [{ key: "customer", label: "Customer" }] : []),
          { key: "order", label: t("order") }, { key: "total", label: t("total"), type: "money" as const }, { key: "open", label: t("open"), type: "money" as const },
          { key: "status", label: t("status"), type: "badge" as const }, { key: "pdf", label: "PDF", filter: false },
        ]}
        rows={rows.map((r) => {
          const status = r.overdue ? t("overdue") : Number(r.open) === 0 && r.docType === "INVOICE" ? "PAID" : r.status;
          return {
            id: r.id, href: as === "ADMIN" ? `/admin/invoices/${r.id}` : undefined,
            cells: {
              number: { t: `${r.providerNumber ?? r.fullNumber ?? ""}`, mono: true, node: (
                <span className="font-mono text-xs">
                  {as === "ADMIN" ? <Link href={`/admin/invoices/${r.id}`} className="text-primary hover:underline">{r.providerNumber ?? r.fullNumber}</Link> : r.providerNumber ?? r.fullNumber}
                  {pendingFiscal(r) && <span className="block"><Badge variant="secondary">{t("beingIssued")}</Badge></span>}
                  {r.docType === "CREDIT_NOTE" && <span className="block text-muted-foreground">{t("creditNote")} → {r.originalInvoice?.providerNumber ?? r.originalInvoice?.fullNumber}</span>}
                </span>
              ) },
              date: { t: formatDate(r.issuedAt, locale), v: r.issuedAt?.getTime() ?? 0, node: <span className="text-xs">{formatDate(r.issuedAt, locale)}{r.dueAt && r.docType !== "CREDIT_NOTE" && <span className={`block ${r.overdue ? "text-destructive" : "text-muted-foreground"}`}>{t("due")} {formatDate(r.dueAt, locale)}</span>}</span> },
              customer: r.recipient.legalName,
              order: { t: r.order?.number ?? "", mono: true },
              total: { t: `${r.docType === "CREDIT_NOTE" ? "−" : ""}${formatMoney(r.grossTotal.toString(), locale)}`, v: Number(r.grossTotal) * (r.docType === "CREDIT_NOTE" ? -1 : 1) },
              open: { t: Number(r.open) > 0 ? formatMoney(r.open, locale) : "—", v: Number(r.open) },
              status: { t: status, node: r.overdue ? <Badge variant="destructive">{t("overdue")}</Badge> : Number(r.open) === 0 && r.docType === "INVOICE" ? <StatusBadge status="PAID" /> : <StatusBadge status={r.status} /> },
              pdf: { t: "", node: pendingFiscal(r) ? null : pdfLink(`/api/invoices/${r.id}/pdf`) },
            },
          };
        })} />
      {basePath && <Pager page={current} pageCount={pageCount} basePath={basePath} />}
    </>
  );
}

export async function PaymentsView({ ctx, as, title, direction, vendorType, withForm, before }: { ctx: Ctx; as: "BUYER" | "VENDOR" | "ADMIN"; title: string; direction?: "INBOUND" | "OUTBOUND"; vendorType?: "DISTRIBUTOR" | "WHOLESALER"; withForm?: boolean; before?: React.ReactNode }) {
  const [rows, t, locale] = await Promise.all([listPayments(ctx, as, { direction, vendorType }), getTranslations("finance"), getLocale()]);
  let docs: { id: string; companyId: string; company: string; label: string; open: string }[] = [];
  if (withForm && as === "ADMIN" && can(ctx, "admin.finance.manage")) {
    if (direction === "INBOUND")
      docs = (await listSalesInvoices(ctx, { as: "ADMIN", docType: "INVOICE", unpaidOnly: true })).map((i) => ({ id: i.id, companyId: i.recipientCompanyId, company: i.recipient.legalName, label: `${i.fullNumber} · ${i.order?.number ?? ""}`, open: i.open }));
    else
      docs = (await listVendorInvoices(ctx, "ADMIN", { vendorType, statuses: ["APPROVED"] })).filter((v) => Number(v.open) > 0).map((v) => ({ id: v.id, companyId: v.vendorCompanyId, company: v.vendor.legalName, label: `${v.externalNumber}`, open: v.open }));
  }
  return (
    <>
      <PageHeader title={title} />
      {before}
      {withForm && direction && docs !== undefined && can(ctx, "admin.finance.manage") && (
        <Card className="mb-4"><CardHeader><CardTitle>{direction === "INBOUND" ? "Record a customer payment" : "Record a payout to a vendor"}</CardTitle></CardHeader><CardContent><PaymentForm direction={direction} docs={docs} /></CardContent></Card>
      )}
      <Table>
        <THead><TR><TH>{t("date")}</TH>{as === "ADMIN" && <TH>Company</TH>}<TH>{t("method")}</TH><TH>{t("reference")}</TH><TH>Allocated to</TH><TH className="text-right">{t("amount")}</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={6}>{t("noPayments")}</EmptyRow>}
          {rows.map((p) => (
            <TR key={p.id}>
              <TD className="text-xs">{formatDate(p.paidAt, locale)}</TD>
              {as === "ADMIN" && <TD>{p.company.legalName}<div className="text-xs text-muted-foreground">{p.direction === "INBOUND" ? "in" : "out"}</div></TD>}
              <TD className="text-xs">{p.method.replace("_", " ").toLowerCase()}</TD>
              <TD className="text-xs">{p.reference ?? "—"}</TD>
              <TD className="font-mono text-xs">{p.allocations.map((a) => a.invoice?.fullNumber ?? a.vendorInvoice?.externalNumber).join(", ")}</TD>
              <TD className="text-right tabular-nums">{formatMoney(p.amount.toString(), locale)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function StatementsView({ ctx, as, title }: { ctx: Ctx; as: "VENDOR" | "ADMIN"; title: string }) {
  const [rows, t, locale] = await Promise.all([listStatements(ctx, as), getTranslations("finance"), getLocale()]);
  const open = rows.filter((r) => r.status === "OPEN" || r.status === "DISPUTED");
  return (
    <>
      <PageHeader title={title} description={as === "VENDOR" ? t("statementsIntro") : undefined} />
      {as === "VENDOR" && can(ctx, "vendor.invoices.submit") && open.length > 0 && (
        <Card className="mb-4"><CardHeader><CardTitle>{t("uploadInvoice")}</CardTitle></CardHeader><CardContent>
          <VendorInvoiceUpload statements={open.map((s) => ({ id: s.id, label: `${s.number} · ${s.order.number}${s.isCreditStatement ? ` (${t("creditNote")})` : ""}`, net: s.expectedNet.toFixed(2), vat: s.expectedVat.toFixed(2), credit: s.isCreditStatement }))} />
        </CardContent></Card>
      )}
      <Table>
        <THead><TR><TH>{t("number")}</TH><TH>{t("date")}</TH>{as === "ADMIN" && <TH>Vendor</TH>}<TH>{t("order")}</TH><TH className="text-right">{t("net")}</TH><TH className="text-right">{t("vat")}</TH><TH className="text-right">{t("commission")}</TH><TH>{t("status")}</TH><TH /></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={9}>—</EmptyRow>}
          {rows.map((s) => (
            <TR key={s.id}>
              <TD className="font-mono text-xs">{s.number}{s.isCreditStatement && <Badge variant="secondary" className="ml-1">{t("creditNote")}</Badge>}{s.taxRegime !== "DOMESTIC" && <div className="text-muted-foreground">reverse charge</div>}</TD>
              <TD className="text-xs">{formatDate(s.createdAt, locale)}</TD>
              {as === "ADMIN" && <TD>{s.vendor.legalName}</TD>}
              <TD className="font-mono text-xs">{s.order.number}</TD>
              <TD className="text-right tabular-nums">{formatMoney(s.expectedNet.toString(), locale)}</TD>
              <TD className="text-right tabular-nums">{formatMoney(s.expectedVat.toString(), locale)}</TD>
              <TD className="text-right tabular-nums text-muted-foreground">{formatMoney(s.commissionTotal.toString(), locale)}</TD>
              <TD><StatusBadge status={s.status} />{s.allocations[0] && <div className="text-xs text-muted-foreground">{s.allocations[0].vendorInvoice.externalNumber}</div>}</TD>
              <TD>{pdfLink(`/api/statements/${s.id}/pdf`)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function VendorInvoicesView({ ctx, as, title, vendorType }: { ctx: Ctx; as: "VENDOR" | "ADMIN"; title: string; vendorType?: "DISTRIBUTOR" | "WHOLESALER" }) {
  const [rows, t, locale] = await Promise.all([listVendorInvoices(ctx, as, { vendorType }), getTranslations("finance"), getLocale()]);
  const review = as === "ADMIN" && can(ctx, "admin.finance.manage");
  return (
    <>
      <PageHeader title={title} />
      <Table>
        <THead><TR><TH>{t("externalNumber")}</TH>{as === "ADMIN" && <TH>Vendor</TH>}<TH>{t("date")}</TH><TH>Statements</TH><TH className="text-right">{t("net")}</TH><TH className="text-right">{t("vat")}</TH><TH>{t("status")}</TH>{review && <TH className="text-right">Review</TH>}</TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={8}>—</EmptyRow>}
          {rows.map((v) => (
            <TR key={v.id} className="align-top">
              <TD className="font-mono text-xs">{pdfLink(`/api/vendor-invoices/${v.id}/file`, v.externalNumber)}{v.docType === "CREDIT_NOTE" && <div className="text-muted-foreground">{t("creditNote")}</div>}</TD>
              {as === "ADMIN" && <TD>{v.vendor.legalName}</TD>}
              <TD className="text-xs">{formatDate(v.issueDate, locale)}</TD>
              <TD className="font-mono text-xs">{v.allocations.map((a) => a.statement.number).join(", ")}</TD>
              <TD className="text-right tabular-nums">{formatMoney(v.netTotal.toString(), locale)}</TD>
              <TD className="text-right tabular-nums">{formatMoney(v.vatTotal.toString(), locale)}{Number(v.selfAssessedVat) > 0 && <div className="text-xs text-muted-foreground">RC {formatMoney(v.selfAssessedVat.toString(), locale)}</div>}</TD>
              <TD><StatusBadge status={v.status} />{v.status === "DISPUTED" && <div className="text-xs text-destructive">{Object.values((v.matchResult ?? {}) as Record<string, string>).filter((x) => typeof x === "string").join("; ")}</div>}</TD>
              {review && <TD>{(v.status === "MATCHED" || v.status === "DISPUTED") && <VendorInvoiceReview id={v.id} disputed={v.status === "DISPUTED"} />}</TD>}
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function PromotionsView({ ctx, as, title, form }: { ctx: Ctx; as: "VENDOR" | "ADMIN"; title: string; form: React.ReactNode }) {
  const [data, t, to, locale] = await Promise.all([listPromotions(ctx, as), getTranslations("finance"), getTranslations("offers"), getLocale()]);
  const what = (p: (typeof data.own)[number]) => {
    const v = Number(p.value);
    const base = p.kind === "PERCENT" ? to("kind.PERCENT", { value: v }) : p.kind === "FIXED_AMOUNT" ? to("kind.FIXED_AMOUNT", { value: formatMoney(v, locale) })
      : p.kind === "ORDER_AMOUNT" ? to("kind.ORDER_AMOUNT", { value: formatMoney(v, locale) }) : p.kind === "BUY_X_GET_Y" ? to("kind.BUY_X_GET_Y", { buy: p.buyQty ?? 0, free: p.freeQty ?? 0 }) : to("kind.FREE_DELIVERY");
    const extra = [p.minQty ? `≥ ${p.minQty}` : null, p.minOrderValue ? to("minOrder", { amount: formatMoney(p.minOrderValue.toString(), locale) }) : null, p.firstOrderOnly ? to("firstOrder") : null].filter(Boolean);
    return extra.length ? `${base} (${extra.join(" · ")})` : base;
  };
  const funding = as === "ADMIN" && can(ctx, ["admin.finance.view", "admin.pricing.view"]) ? await promotionFunding(ctx) : [];
  const targetText = (p: (typeof data.own)[number]) => p.targets.map((x) => x.offer ? pickLocalized(x.offer.packaging.variant.product.name, locale) : x.category ? pickLocalized(x.category.name, locale) : x.vendor?.legalName ?? x.customerGroup?.name ?? (x.product ? pickLocalized(x.product.name, locale) : "")).join(", ") || t("allMyProducts");
  return (
    <>
      <PageHeader title={title} />
      <div className="mb-4">{form}</div>
      {as === "VENDOR" && data.requests.length > 0 && (
        <Card className="mb-4"><CardHeader><CardTitle>{t("requests")}</CardTitle></CardHeader><CardContent className="space-y-2">
          {data.requests.map((p) => {
            const mine = p.acceptances.find((a) => a.vendor.id === ctx.company.id)!;
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <div><div className="font-medium">{pickLocalized(p.name, locale)}</div>
                  <div className="text-muted-foreground">{what(p)} · {t("yourShare")} {Number(p.vendorFundPct)}% · {t("firingiShare")} {Number(p.firingiFundPct)}% · {formatDate(p.validFrom, locale)} → {p.validTo ? formatDate(p.validTo, locale) : "∞"}</div></div>
                {mine.status === "PENDING" ? <AcceptButtons id={p.id} /> : <StatusBadge status={mine.status} />}
              </div>
            );
          })}
        </CardContent></Card>
      )}
      <Table>
        <THead><TR><TH>{t("name")}</TH>{as === "ADMIN" && <TH>Owner</TH>}<TH>{t("discount")}</TH><TH>{t("appliesTo")}</TH><TH>Funding</TH><TH>{t("validFrom")} → {t("validTo")}</TH><TH>{t("status")}</TH><TH /></TR></THead>
        <TBody>
          {data.own.length === 0 && <EmptyRow colSpan={8}>—</EmptyRow>}
          {data.own.map((p) => (
            <TR key={p.id}>
              <TD className="font-medium">{pickLocalized(p.name, locale)}<div className="text-xs text-muted-foreground">{t("used", { count: p._count.lineDiscounts })}</div></TD>
              {as === "ADMIN" && <TD>{p.ownerType === "ADMIN" ? "FIRINGI" : p.owner?.legalName}</TD>}
              <TD>{what(p)}{p.code && <div className="font-mono text-xs font-semibold tracking-wide" data-testid="promo-code">{p.code}</div>}</TD>
              <TD className="max-w-xs truncate text-xs">{targetText(p)}</TD>
              <TD className="text-xs">FIRINGI {Number(p.firingiFundPct)}% · vendor {Number(p.vendorFundPct)}%{p.acceptances.length > 0 && <div>{p.acceptances.map((a) => `${a.vendor.legalName}: ${a.status.toLowerCase()}`).join(", ")}</div>}</TD>
              <TD className="text-xs">{formatDate(p.validFrom, locale)} → {p.validTo ? formatDate(p.validTo, locale) : "∞"}</TD>
              <TD><StatusBadge status={p.status} /></TD>
              <TD><PromotionStatusButtons id={p.id} status={p.status} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {funding.length > 0 && (
        <Card className="mt-6"><CardHeader><CardTitle>Who paid the discounts</CardTitle></CardHeader><CardContent>
          <Table>
            <THead><TR><TH>Promotion</TH><TH className="text-right">Lines</TH><TH className="text-right">Total discount</TH><TH className="text-right">Paid by FIRINGI</TH><TH className="text-right">Paid by vendors</TH></TR></THead>
            <TBody>{funding.map((f) => (
              <TR key={f.promotionId}>
                <TD>{pickLocalized(f.promotion.name, locale)} <span className="text-xs text-muted-foreground">({f.promotion.ownerType === "ADMIN" ? "FIRINGI" : f.promotion.owner?.legalName})</span></TD>
                <TD className="text-right tabular-nums">{f._count._all}</TD>
                <TD className="text-right tabular-nums">{formatMoney(f._sum.amount?.toString() ?? 0, locale)}</TD>
                <TD className="text-right tabular-nums">{formatMoney(f._sum.firingiAmount?.toString() ?? 0, locale)}</TD>
                <TD className="text-right tabular-nums">{formatMoney(f._sum.vendorAmount?.toString() ?? 0, locale)}</TD>
              </TR>
            ))}</TBody>
          </Table>
        </CardContent></Card>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold tabular-nums">{value}</p>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</CardContent></Card>;
}

export async function FinanceOverviewView({ ctx }: { ctx: Ctx }) {
  const [o, locale] = await Promise.all([financeOverview(ctx), getLocale()]);
  const m = (v: string) => formatMoney(v, locale);
  return (
    <>
      <PageHeader title="Financial Overview" description="This month. FIRINGI is merchant of record: it sells to buyers and buys from vendors." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Sales invoiced (net)" value={m(o.salesNet)} hint={`${o.invoices} invoices · VAT ${m(o.vat)}`} />
        <Stat label="Credit notes (net)" value={m(o.creditNotesNet)} />
        <Stat label="Commission earned" value={m(o.commission)} hint={`Margin ${m(o.margin)} · delivery fees ${m(o.deliveryFees)}`} />
        <Stat label="Discounts funded" value={m(o.discountFiringi)} hint={`by FIRINGI · vendors funded ${m(o.discountVendors)}`} />
        <Stat label="Accounts receivable" value={m(o.receivable)} hint={`overdue ${m(o.overdue)}`} />
        <Stat label="Accounts payable" value={m(o.payable)} hint="approved vendor invoices" />
      </div>
    </>
  );
}

export async function BalancesView({ ctx, kind }: { ctx: Ctx; kind: "receivable" | "payable" }) {
  const [b, locale] = await Promise.all([balances(ctx), getLocale()]);
  const rows = b[kind];
  return (
    <>
      <PageHeader title={kind === "receivable" ? "Accounts Receivable" : "Accounts Payable"} description={kind === "receivable" ? "Open FIRINGI invoices per buyer." : "Approved vendor invoices not yet paid."} />
      <Table>
        <THead><TR><TH>Company</TH><TH className="text-right">Documents</TH><TH className="text-right">Open</TH>{kind === "receivable" && <TH className="text-right">Overdue</TH>}</TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={4}>Nothing open.</EmptyRow>}
          {rows.map((r) => (
            <TR key={r.id}>
              <TD><Link href={`/admin/companies/${r.id}`} className="text-primary hover:underline">{r.name}</Link></TD>
              <TD className="text-right tabular-nums">{r.count}</TD>
              <TD className="text-right tabular-nums">{formatMoney(r.open, locale)}</TD>
              {kind === "receivable" && <TD className={`text-right tabular-nums ${Number(r.overdue) > 0 ? "text-destructive" : ""}`}>{formatMoney(r.overdue, locale)}</TD>}
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

export async function VatView({ ctx, month }: { ctx: Ctx; month?: string }) {
  const d = month ? new Date(`${month}-01`) : new Date();
  const [r, locale] = await Promise.all([vatReport(ctx, d), getLocale()]);
  const m = (v: string) => formatMoney(v, locale);
  return (
    <>
      <PageHeader title="VAT" description={`${r.from.toISOString().slice(0, 7)} — output VAT on FIRINGI's sales minus input VAT on vendor invoices. Confirm with your accountant before filing.`} />
      <form className="mb-4 flex gap-2"><input type="month" name="month" defaultValue={r.from.toISOString().slice(0, 7)} className="h-9 rounded-md border bg-card px-2 text-sm" /><button className="h-9 rounded-md border bg-card px-3 text-sm">Show</button></form>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Output VAT (sales − credit notes)</CardTitle></CardHeader><CardContent>
          <Table><THead><TR><TH>Rate</TH><TH className="text-right">Base</TH><TH className="text-right">VAT</TH></TR></THead>
            <TBody>{r.outputByRate.map((x) => <TR key={x.rate}><TD>{Number(x.rate)}%</TD><TD className="text-right tabular-nums">{m(x.base)}</TD><TD className="text-right tabular-nums">{m(x.vat)}</TD></TR>)}</TBody></Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Summary</CardTitle></CardHeader><CardContent>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt>Output VAT</dt><dd className="text-right tabular-nums">{m(r.outputVat)}</dd>
            <dt>Input VAT (vendor invoices)</dt><dd className="text-right tabular-nums">− {m(r.inputVat)}</dd>
            <dt className="text-muted-foreground">Reverse charge (declared and deducted)</dt><dd className="text-right tabular-nums text-muted-foreground">{m(r.reverseChargeVat)}</dd>
            <dt className="font-semibold">VAT payable</dt><dd className="text-right font-semibold tabular-nums">{m(r.payable)}</dd>
          </dl>
        </CardContent></Card>
      </div>
    </>
  );
}

export async function CommissionsView({ ctx }: { ctx: Ctx }) {
  const [rows, locale] = await Promise.all([commissionByVendor(ctx), getLocale()]);
  return (
    <>
      <PageHeader title="Commissions" description="Commission earned on delivered orders, per vendor (rate frozen per order line). Change rates on the vendor's page." />
      <Table>
        <THead><TR><TH>Vendor</TH><TH>Current rate</TH><TH className="text-right">Orders</TH><TH className="text-right">Sales (net)</TH><TH className="text-right">Paid to vendor</TH><TH className="text-right">Commission</TH></TR></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={6}>No delivered orders yet.</EmptyRow>}
          {rows.map((r) => (
            <TR key={r.sellerCompanyId}>
              <TD><Link href={`/admin/companies/${r.sellerCompanyId}`} className="text-primary hover:underline">{r.vendor.legalName}</Link><div className="text-xs text-muted-foreground">{r.vendor.type.toLowerCase()}</div></TD>
              <TD>{r.vendor.commissionRules[0] ? `${Number(r.vendor.commissionRules[0].rate)} %` : "—"}</TD>
              <TD className="text-right tabular-nums">{r._count._all}</TD>
              <TD className="text-right tabular-nums">{formatMoney(r._sum.netTotal?.toString() ?? 0, locale)}</TD>
              <TD className="text-right tabular-nums">{formatMoney(r._sum.vendorPayableNet?.toString() ?? 0, locale)}</TD>
              <TD className="text-right font-medium tabular-nums">{formatMoney(r._sum.commissionTotal?.toString() ?? 0, locale)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}

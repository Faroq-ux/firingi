import Link from "next/link";
import { getLocale } from "next-intl/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { PaymentLinkForm, RefundForm, RequestActions, TestProvider } from "@/components/admin/payments-admin";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { onlinePaymentsOverview } from "@/server/payments/admin";
import { listCompanies } from "@/server/data/companies";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Online Payments" };
export const dynamic = "force-dynamic";
const STATUSES = ["OPEN", "PROCESSING", "PAID", "FAILED", "EXPIRED", "CANCELLED"] as const;
const TONE = { OPEN: "secondary", PROCESSING: "warning", PAID: "success", FAILED: "destructive", EXPIRED: "outline", CANCELLED: "outline" } as const;
const METHOD = { CARD: "Card", MB_WAY: "MB WAY", MULTIBANCO: "Multibanco", DIRECT_DEBIT: "Direct debit", BANK_TRANSFER: "Bank transfer", CASH: "Cash", OTHER: "Other" } as Record<string, string>;

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.finance.view", "admin.finance.manage"]);
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const manage = can(ctx, "admin.finance.manage");
  const [o, locale, customers] = await Promise.all([onlinePaymentsOverview(ctx, { status }), getLocale(), manage ? listCompanies(ctx, { types: ["CUSTOMER", "WHOLESALER"], statuses: ["APPROVED"] }) : null]);
  const sim = o.provider?.key === "sim";
  return (
    <>
      <PageHeader title="Online Payments" description="Customers pay FIRINGI's invoices online — MB WAY, Multibanco, card, SEPA direct debit — from the portal or a payment link. Payments are matched to invoices automatically; money that isn't needed stays as customer credit for the next invoices." />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card data-testid="provider-card"><CardHeader><CardTitle>Payment provider</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          {o.provider ? (
            <>
              <p><b>{o.provider.label}</b> <Badge variant={o.provider.mode === "live" ? "success" : "warning"}>{o.provider.mode}</Badge></p>
              <p className="text-muted-foreground">Methods: {o.provider.methods.map((m) => METHOD[m]).join(", ")} · switched on in <Link className="text-primary hover:underline" href="/admin/settings/payment">Payment Settings</Link></p>
              {o.provider.key !== "sim" && <p className="break-all text-xs">Webhook: <span className="font-mono">{o.webhookUrl}</span></p>}
              {sim && <p className="text-xs text-warning">Simulated: no real money moves. Set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET for real payments.</p>}
              <TestProvider />
            </>
          ) : <p>No provider configured — customers pay by bank transfer. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (or another provider) in the server settings.</p>}
          {o.failedEvents > 0 && <p className="text-destructive">{o.failedEvents} provider notification(s) couldn&apos;t be applied — see below.</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Paid online, 30 days</CardTitle></CardHeader><CardContent className="space-y-1 text-sm" data-testid="paid30">
          {o.paid30.length ? o.paid30.map((p) => <p key={p.method} className="flex justify-between"><span>{METHOD[p.method] ?? p.method} · {p.count}</span><span className="tabular-nums">{formatMoney(p.amount, locale)}</span></p>) : <p className="text-muted-foreground">Nothing yet.</p>}
          <p className="flex justify-between border-t pt-1 text-muted-foreground"><span>In progress</span><span>{o.byStatus.PROCESSING?.count ?? 0} · {formatMoney(o.byStatus.PROCESSING?.amount ?? 0, locale)}</span></p>
          <p className="flex justify-between text-muted-foreground"><span>Failed</span><span>{o.byStatus.FAILED?.count ?? 0}</span></p>
        </CardContent></Card>
        {manage && customers && <Card><CardHeader><CardTitle>Payment link</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">A link to pay all of a customer&apos;s open invoices — works without signing in.</p>
          <PaymentLinkForm customers={customers.rows.map((c) => ({ id: c.id, name: c.legalName }))} />
        </CardContent></Card>}
      </div>

      <Card className="mb-4"><CardHeader><CardTitle>Payment requests</CardTitle></CardHeader><CardContent>
        <div className="mb-3 flex flex-wrap gap-1 text-sm">
          <Link href="/admin/finance/online-payments" className={`rounded-full border px-3 py-1 ${!status ? "bg-primary text-primary-foreground" : ""}`}>All</Link>
          {STATUSES.map((s) => <Link key={s} href={`/admin/finance/online-payments?status=${s}`} className={`rounded-full border px-3 py-1 ${status === s ? "bg-primary text-primary-foreground" : ""}`}>{s.toLowerCase()}</Link>)}
        </div>
        <Table data-testid="requests">
          <THead><TR><TH>Customer</TH><TH>For</TH><TH>Method</TH><TH className="text-right">Amount</TH><TH>State</TH><TH>Updated</TH><TH /></TR></THead>
          <TBody>
            {o.requests.map((r) => (
              <TR key={r.id}>
                <TD>{r.company}<div className="text-xs text-muted-foreground">{r.source.toLowerCase().replace("_", " ")}</div></TD>
                <TD className="max-w-xs font-mono text-xs">{r.docs}</TD>
                <TD>{r.method ? METHOD[r.method] : "—"}</TD>
                <TD className="text-right tabular-nums">{formatMoney(r.paidAmount ?? r.amount, locale)}</TD>
                <TD><Badge variant={TONE[r.status]}>{r.status.toLowerCase()}</Badge>{r.failureReason && <div className="max-w-xs text-xs text-destructive">{r.failureReason}</div>}</TD>
                <TD className="text-xs">{formatDate(r.updatedAt, locale, true)}</TD>
                <TD className="text-right">{manage && <RequestActions id={r.id} open={r.status === "OPEN"} multibanco={r.multibanco} simulated={sim} link={r.link} />}</TD>
              </TR>
            ))}
            {!o.requests.length && <EmptyRow colSpan={7}>No payment requests.</EmptyRow>}
          </TBody>
        </Table>
      </CardContent></Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Customer credit</CardTitle></CardHeader><CardContent>
          <p className="mb-2 text-sm text-muted-foreground">Money received but not used on invoices (overpaid, prepaid orders not delivered yet). It pays the customer&apos;s next invoices automatically; refund it if they ask.</p>
          <Table data-testid="credits">
            <THead><TR><TH>Customer</TH><TH className="text-right">Credit</TH><TH /></TR></THead>
            <TBody>
              {o.credits.map((c) => (
                <TR key={c.paymentId}>
                  <TD>{c.company}<div className="text-xs text-muted-foreground">{c.method ? METHOD[c.method] : ""} · {c.paidAt ? formatDate(c.paidAt, locale) : ""}{c.order ? ` · order ${c.order}${c.waitingForOrder ? " (waiting for delivery)" : ""}` : ""}</div></TD>
                  <TD className="text-right tabular-nums">{formatMoney(c.free, locale)}</TD>
                  <TD className="text-right">{manage && !c.waitingForOrder && <RefundForm paymentId={c.paymentId} max={c.free} />}</TD>
                </TR>
              ))}
              {!o.credits.length && <EmptyRow colSpan={3}>No customer credit.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Provider notifications</CardTitle></CardHeader><CardContent>
          <Table data-testid="events">
            <THead><TR><TH>Received</TH><TH>Event</TH><TH>State</TH></TR></THead>
            <TBody>
              {o.events.map((e) => <TR key={e.id}><TD className="text-xs">{formatDate(e.receivedAt, locale, true)}</TD><TD className="font-mono text-xs">{e.provider} · {e.type}</TD><TD>{e.processed ? <Badge variant="success">applied</Badge> : e.error ? <Badge variant="destructive" title={e.error}>error</Badge> : <Badge variant="secondary">pending</Badge>}{e.error && <div className="max-w-xs truncate text-xs text-destructive">{e.error}</div>}</TD></TR>)}
              {!o.events.length && <EmptyRow colSpan={3}>None yet.</EmptyRow>}
            </TBody>
          </Table>
        </CardContent></Card>
      </div>
    </>
  );
}

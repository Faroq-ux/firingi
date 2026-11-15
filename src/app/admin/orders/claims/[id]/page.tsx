import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert, Truck } from "lucide-react";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { claimDetail } from "@/server/claims/service";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHARGEBACK_TONE, ClaimLines, ClaimSummary, Conversation, DecisionCard, SupplierSide } from "@/components/claims/views";
import { DecisionForm, MessageForm, ReplacementDone, ResolveChargeback } from "@/components/claims/forms";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Quality Claim" };
const eur = (v: number) => formatMoney(v, "pt-PT");
const MODE: Record<string, string> = { FIRINGI_FLEET: "FIRINGI fleet", VENDOR_FLEET: "Supplier's own fleet", CARRIER: "Carrier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.claims.manage", "admin.orders.view", "admin.orders.manage"]);
  const { id } = await params;
  const d = await claimDetail(ctx, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  // FIRINGI pages are English whatever the user's language
  const t = createTranslator({ locale: "en", messages: en, namespace: "claims" }) as unknown as (key: string, vars?: Record<string, string | number>) => string;
  const dl = d.delivery!;
  const manage = can(ctx, "admin.claims.manage");
  return (
    <>
      <PageHeader title={`Claim ${d.number}`} description={`${d.buyer.name} → ${d.seller.name}. Created by ${d.createdBy ?? "—"}; the customer would prefer ${d.preferredOutcome === "CREDIT" ? "a credit note" : "a replacement"}.`} icon={ShieldAlert} />
      <ClaimSummary d={d} t={t} locale="en-GB" orderHref={`/admin/orders/${d.order.id}`} />
      <div className="mb-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div>
          {d.can.decide ? (
            <Card className="mb-6 border-2 border-[color:color-mix(in_oklch,var(--vivid-violet)_45%,var(--border))]">
              <CardHeader><CardTitle>Decide</CardTitle><CardDescription>FIRINGI is merchant of record: the customer&rsquo;s credit note comes from FIRINGI, certified through the invoicing provider. AI only suggests — a person decides.</CardDescription></CardHeader>
              <CardContent>
                <DecisionForm claimId={d.id} preferred={d.preferredOutcome} fee={d.invoice?.fee ?? null} supplierFleet={!dl.firingiFleet}
                  lines={d.lines.map((l) => ({ id: l.id, product: `${l.product} — ${l.packaging}`, qty: l.qty, unitGross: l.unitGross }))}
                  delivery={{ eligible: dl.driverChargeback.eligible, cap: dl.driverChargeback.cap, why: dl.driverChargeback.why, driverName: dl.driverName }} />
              </CardContent>
            </Card>
          ) : <DecisionCard d={d} t={t} locale="en-GB" creditNoteHref={d.decision?.creditNoteId ? `/admin/invoices/${d.decision.creditNoteId}` : undefined} />}
          {d.can.replace && <Card className="mb-6"><CardHeader><CardTitle>Replacement</CardTitle><CardDescription>The supplier marks it when the goods are delivered again; FIRINGI can too.</CardDescription></CardHeader><CardContent><ReplacementDone id={d.id} label="Replacement delivered" /></CardContent></Card>}
          <ClaimLines d={d} t={t} locale="en-GB" />
          <SupplierSide d={d} t={t} locale="en-GB" />
        </div>
        <div>
          <Card className="mb-6" data-testid="delivery-facts">
            <CardHeader><CardTitle className="flex items-center gap-2"><Truck className="size-5" aria-hidden />Delivery</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Mode:</span> {dl.mode ? MODE[dl.mode] : "—"}{dl.executor ? ` (${dl.executor})` : ""}</p>
              <p><span className="text-muted-foreground">Driver:</span> {dl.driverName ?? "—"}</p>
              <p><span className="text-muted-foreground">Delivery fee paid by the customer:</span> {dl.feePaid ? eur(dl.fee) : "none (free delivery)"}</p>
              <p className="rounded-lg bg-muted/50 p-2 text-xs">
                {dl.driverChargeback.eligible ? `A driver fault can be charged back to ${dl.driverName}, up to their per-delivery pay of ${eur(dl.driverChargeback.cap)}.`
                  : dl.driverChargeback.why === "FREE_DELIVERY" ? "No driver charge-back possible: the customer paid no delivery fee, so the driver earned no per-delivery pay for it."
                  : dl.driverChargeback.why === "SUPPLIER_FLEET" ? "The supplier's own driver delivered — the supplier's staff, so delivery faults are the supplier's (charged back on its statement)."
                  : "No FIRINGI driver on this delivery."}
              </p>
              {d.invoice && <p><span className="text-muted-foreground">Invoice:</span> <Link href={`/admin/invoices/${d.invoice.id}`} className="text-primary hover:underline">{d.invoice.number}</Link></p>}
            </CardContent>
          </Card>
          {d.chargebacks.length > 0 && (
            <Card className="mb-6" data-testid="admin-claim-chargebacks">
              <CardHeader><CardTitle>Charge-backs</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {d.chargebacks.map((c) => (
                    <li key={c.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold tabular-nums">{eur(c.amount)}</span><Badge variant="secondary">{c.target === "SUPPLIER" ? d.seller.name : c.driver}</Badge><Badge variant={CHARGEBACK_TONE[c.status]}>{c.status.toLowerCase()}</Badge></div>
                      {c.disputeNote && <p className="break-words text-xs text-muted-foreground">Supplier: {c.disputeNote}</p>}
                      {manage && <ResolveChargeback id={c.id} status={c.status} target={c.target} />}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          <Conversation d={d} t={t} locale="en-GB" english>
            {d.can.message && <MessageForm claimId={d.id} allowInternal labels={{ placeholder: "Message to the customer and the supplier — or an internal note", send: "Send", internal: "FIRINGI only", photos: "Photos" }} />}
          </Conversation>
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { Gavel } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { buyerAddresses, invitableSuppliers, myTenders } from "@/server/tenders/service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { tenderLabels } from "@/components/tenders/labels";
import { NewTenderForm } from "@/components/tenders/client";

export const metadata = { title: "New Tender" };
export const dynamic = "force-dynamic";

export default async function NewTenderPage() {
  const ctx = await pagePortal("buy");
  pagePermission(ctx, "buyer.orders.place");
  const [{ l }, m] = await Promise.all([tenderLabels(), myTenders(ctx)]);
  const [addresses, suppliers] = m.access.post ? await Promise.all([buyerAddresses(ctx), invitableSuppliers(ctx)]) : [[], []];
  const s = m.settings;
  return (
    <>
      <PageHeader title={l.newTender} icon={Gavel} description={l.newIntro} />
      <Link href="/buy/orders/tenders" className="mb-3 inline-block text-sm text-primary hover:underline">← {l.title}</Link>
      {!m.access.post ? <p className="rounded-xl border border-dashed p-4 text-sm" data-testid="td-closed">{l[`closed.${m.access.why ?? "TYPE_OFF"}`]}</p> : (
        <Card><CardContent className="pt-6"><NewTenderForm l={l} addresses={addresses} suppliers={suppliers} opts={{ invitations: s.invitations, targetPrices: s.targetPrices, minHours: s.minHours, maxDays: s.maxDays, maxLines: s.maxLines }} /></CardContent></Card>
      )}
    </>
  );
}

import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SimMandate } from "@/components/payments/sim-pages";
import { simMandateData } from "@/server/payments/sim-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Simulated direct debit mandate", robots: { index: false } };

export default async function SimMandatePage({ params }: { params: Promise<{ ref: string }> }) {
  const d = await simMandateData((await params).ref);
  if (!d) notFound();
  return (
    <Card><CardContent className="space-y-4 py-6">
      <div className="text-center"><h1 className="text-lg font-semibold">SEPA direct debit mandate</h1><p className="text-xs font-medium uppercase tracking-wide text-warning">Simulated payment provider — test only</p></div>
      <p className="text-sm text-muted-foreground">{d.company} authorises FIRINGI to collect its invoices from this account.</p>
      <SimMandate setupRef={d.setupRef} holder={d.holder} />
    </CardContent></Card>
  );
}

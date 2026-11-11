import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SimCheckout } from "@/components/payments/sim-pages";
import { simCheckoutData } from "@/server/payments/sim-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Simulated checkout", robots: { index: false } };

export default async function SimCheckoutPage({ params }: { params: Promise<{ ref: string }> }) {
  const d = await simCheckoutData((await params).ref);
  if (!d) notFound();
  return (
    <Card><CardContent className="space-y-4 py-6">
      <div className="text-center"><h1 className="text-lg font-semibold">Card payment</h1><p className="text-xs font-medium uppercase tracking-wide text-warning">Simulated payment provider — test only, no real money</p></div>
      <SimCheckout providerRef={d.providerRef} amount={d.amount} />
    </CardContent></Card>
  );
}

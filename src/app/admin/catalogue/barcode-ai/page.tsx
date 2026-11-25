import { ScanBarcode } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { BA_MANAGE, BA_VIEW, barcodeAiAccess, barcodeAiAdminFacts, barcodeAiOverrides, barcodeAiSettings } from "@/server/catalogue/barcode-ai";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarcodeAiForm, CompanyBarcodeAiSwitch, FindBarcodeAiCompany } from "@/components/catalogue/barcode-ai-admin";

export const metadata = { title: "Add by Barcode (AI)" };

/** FIRINGI's switches for suppliers adding products by barcode with AI (English). */
export default async function BarcodeAiAdminPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, BA_VIEW);
  const [s, overrides, { countries, proposed }, ai] = await Promise.all([barcodeAiSettings(), barcodeAiOverrides(ctx), barcodeAiAdminFacts(ctx), barcodeAiAccess(ctx)]);
  const manage = can(ctx, BA_MANAGE);
  const L = (n: unknown) => (n as Record<string, string>)?.en ?? String(n ?? "");
  return (
    <>
      <PageHeader icon={ScanBarcode} title="Add by Barcode (AI)" description="Suppliers type or scan a barcode; if the product isn't on FIRINGI, AI fills in the proposal from the open product databases (food, drinks, cosmetics, hygiene, pet, household and more) or from photos of the package. The supplier checks it and adds the price; you approve new products as usual." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>Switches</CardTitle><CardDescription>AI: {ai.ai || ai.settings.parts.ai ? (process.env.ANTHROPIC_API_KEY ? "connected" : "no AI key — the database data is mapped by rules") : "switched off"} · {proposed} AI drafts in the last 30 days.</CardDescription></CardHeader>
          <CardContent>{manage ? <BarcodeAiForm initial={s} countries={countries.map((c) => ({ code: c.code, name: L(c.name) }))} /> : <p className="text-sm text-muted-foreground">You can view these settings; changing them needs the catalogue manage right.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Single suppliers</CardTitle><CardDescription>Switch one supplier on (even in a country that is off) or off.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {manage && <FindBarcodeAiCompany />}
            <ul className="divide-y" data-testid="ba-overrides">
              {overrides.length === 0 && <li className="py-4 text-sm text-muted-foreground">No supplier switched one by one.</li>}
              {overrides.map((o) => <li key={o.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="ba-override"><span className="min-w-0 flex-1">{o.name} <span className="text-xs text-muted-foreground">· {o.type.toLowerCase()} · {o.country}</span></span>{manage ? <CompanyBarcodeAiSwitch companyId={o.id} state={o.state} /> : <span>{o.state === "ON" ? "Always on" : "Off"}</span>}</li>)}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

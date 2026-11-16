import { BookOpenCheck } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import Link from "next/link";
import { companiesWithFeatures } from "@/server/accounting/features";
import { aiSettings } from "@/server/ai/assistant";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { FeatureSwitch } from "@/components/multisite/controls";

export const metadata = { title: "Business Features" };
const TYPE: Record<string, string> = { CUSTOMER: "Customer", WHOLESALER: "Wholesaler", DISTRIBUTOR: "Distributor" };

export default async function BusinessFeatures() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage"]);
  const rows = await companiesWithFeatures(ctx);
  const manage = ctx.permissions.has("admin.settings.manage");
  const on = rows.filter((r) => r.accounting).length;
  const assistants = rows.filter((r) => r.assistant).length;
  const photos = rows.filter((r) => r.assistant && r.photos).length;
  const ai = await aiSettings();
  const globalOff = [!ai.buyers && "all customers", !ai.suppliers && "all suppliers"].filter(Boolean).join(" and ");
  return (
    <>
      <PageHeader title="Business Features" icon={BookOpenCheck} description="Optional tools FIRINGI switches on per company. Accounting: daily sales, expenses (rent, utilities, salaries, social security…), purchases on FIRINGI and profit & loss — the company's own bookkeeping; FIRINGI staff never see the figures, only whether it is on. Assistant: FIRINGI's AI support agent for suppliers and customers, in their language (typed or spoken) — it answers about their own orders, deliveries, invoices, statements and claims, helps customers find products and can put them in the cart (the customer always places the order), and passes the chat to FIRINGI support when a person is needed. It only reads the company's own data. Photos: customers and suppliers can send photos (products, labels, order lists, delivery notes) and scan barcodes in the Assistant. Loyalty: customers and wholesalers earn and spend points (Marketing › Loyalty & Rewards); on by default. Order chat: the company can message about its orders (Orders › Order Chat); Hide contacts: phone numbers, e-mails, IBANs and links it types are hidden — switch off only for a trusted company." />
      {(globalOff || !ai.photos) && (
        <p role="status" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="ai-global-off">
          {globalOff && <>The Assistant is switched off for <b>{globalOff}</b> in <Link href="/admin/ai/assistant" className="underline">AI settings</Link> — the switches below apply once it is on again. </>}
          {!ai.photos && <>Photos &amp; barcode scan are switched off for everyone in <Link href="/admin/ai/assistant" className="underline">AI settings</Link>.</>}
        </p>
      )}
      <Card className="mb-4"><CardContent className="flex flex-wrap gap-6 pt-6 text-sm"><span>Accounting on for <b>{on}</b> of {rows.length} companies</span><span>Assistant on for <b data-testid="assistant-on-count">{assistants}</b></span><span>Photos on for <b data-testid="photos-on-count">{photos}</b></span><span className="text-muted-foreground">Accounting is off by default; the Assistant and its photos are on by default. Switching off hides it; what the company recorded is kept.</span></CardContent></Card>
      <DataTable tableId="admin.business-features" testId="business-features" empty="No suppliers or customers yet."
        columns={[{ key: "company", label: "Company" }, { key: "type", label: "Type", filter: true }, { key: "country", label: "Country", filter: true }, { key: "accounting", label: "Accounting", type: "badge", filter: true }, { key: "entries", label: "Entries", type: "number" }, { key: "switch", label: "Accounting switch" }, { key: "assistant", label: "Assistant", type: "badge", filter: true }, { key: "assistantSwitch", label: "Assistant switch" }, { key: "photos", label: "Photos", type: "badge", filter: true }, { key: "photosSwitch", label: "Photos switch" }, { key: "loyalty", label: "Loyalty", type: "badge", filter: true }, { key: "loyaltySwitch", label: "Loyalty switch" }, { key: "ads", label: "Advertising", type: "badge", filter: true }, { key: "adsSwitch", label: "Advertising switch" }, { key: "chat", label: "Order chat", type: "badge", filter: true }, { key: "chatSwitch", label: "Order chat switch" }, { key: "chatMask", label: "Hide contacts", type: "badge", filter: true }, { key: "chatMaskSwitch", label: "Hide contacts switch" }]}
        rows={rows.map((r) => ({
          id: r.id, href: `/admin/companies/${r.id}`,
          cells: {
            company: { t: r.name, href: `/admin/companies/${r.id}`, sub: r.name !== r.legalName ? r.legalName : undefined }, type: TYPE[r.type] ?? r.type, country: r.country,
            accounting: { t: r.accounting ? "On" : "Off", tone: r.accounting ? "success" : "outline" }, entries: r.entries,
            switch: manage ? { t: r.accounting ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.accounting} label={`Accounting for ${r.name}`} /> } : "—",
            assistant: { t: r.assistant ? "On" : "Off", tone: r.assistant ? "success" : "outline" },
            assistantSwitch: manage ? { t: r.assistant ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.assistant} feature="ASSISTANT" label={`Assistant for ${r.name}`} /> } : "—",
            photos: { t: r.photos ? "On" : "Off", tone: r.photos && r.assistant ? "success" : "outline" },
            photosSwitch: manage ? { t: r.photos ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.photos} feature="ASSISTANT_PHOTOS" label={`Photos & barcode scan for ${r.name}`} /> } : "—",
            loyalty: r.loyalty === null ? "—" : { t: r.loyalty ? "On" : "Off", tone: r.loyalty ? "success" : "outline" },
            loyaltySwitch: r.loyalty === null ? "—" : manage ? { t: r.loyalty ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.loyalty} feature="LOYALTY" label={`Loyalty for ${r.name}`} /> } : "—",
            ads: r.ads === null ? "—" : { t: r.ads ? "On" : "Off", tone: r.ads ? "success" : "outline" },
            adsSwitch: r.ads === null ? "—" : manage ? { t: r.ads ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.ads} feature="ADS" label={`Advertising for ${r.name}`} /> } : "—",
            chat: { t: r.chat ? "On" : "Off", tone: r.chat ? "success" : "outline" },
            chatSwitch: manage ? { t: r.chat ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.chat} feature="CHAT" label={`Order chat for ${r.name}`} /> } : "—",
            chatMask: { t: r.chatMask ? "On" : "Off", tone: r.chatMask ? "success" : "outline" },
            chatMaskSwitch: manage ? { t: r.chatMask ? "On" : "Off", node: <FeatureSwitch companyId={r.id} enabled={r.chatMask} feature="CHAT_MASK" label={`Hide contact details for ${r.name}`} /> } : "—",
          },
        }))} />
    </>
  );
}

import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { waBusinesses, waSettings } from "@/server/whatsapp/ordering";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessControls, SmallOrdersForm, WaSettingsForm } from "@/components/whatsapp/admin";

export const metadata = { title: "WhatsApp Ordering Settings" };
export const dynamic = "force-dynamic";

export default async function WhatsAppOrderingSettingsPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.settings.view", "admin.settings.manage", "admin.messages.manage"]);
  const [s, b] = await Promise.all([waSettings(), waBusinesses(ctx)]);
  const typeName = (t: string) => (t === "CUSTOMER" ? "Wholesale customer" : "Wholesaler");
  return (
    <>
      <PageHeader title="WhatsApp Ordering" icon={MessageCircle} description="Businesses order by WhatsApp: FIRINGI's AI fills the cart from text, photos and voice notes and proposes the order with each supplier's own minimum and free delivery. Only the customer's YES places it." />
      <Card className="mb-6">
        <CardHeader><CardTitle>Settings</CardTitle><CardDescription>Messages arrive through the WhatsApp provider set in <Link className="underline" href="/admin/notifications/whatsapp">WhatsApp Integration</Link>. Conversations and orders: <Link className="underline" href="/admin/notifications/whatsapp-ordering">WhatsApp Orders</Link>.</CardDescription></CardHeader>
        <CardContent><WaSettingsForm initial={s} /></CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>Small orders per month</CardTitle><CardDescription>A small order reaches FIRINGI&apos;s minimum order but not the supplier&apos;s free-delivery amount, so FIRINGI delivers it. After a customer has used this month&apos;s small orders, an order must reach the supplier&apos;s free-delivery amount (or FIRINGI&apos;s free delivery). Cancelled orders don&apos;t count.</CardDescription></CardHeader>
        <CardContent><SmallOrdersForm initial={b.small} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Businesses</CardTitle><CardDescription>Switch WhatsApp ordering off for one business, or give a wholesale customer its own small-order limit (empty = the general {b.small.perMonth}).</CardDescription></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" data-testid="wa-businesses">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Business</th><th>Type</th><th>WhatsApp number</th><th className="text-right">Small orders this month</th><th className="pl-4">WhatsApp · own limit</th></tr></thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.id} className="border-t" data-testid={`wa-business-${r.id}`}>
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td>{typeName(r.type)}</td>
                    <td className="tabular-nums">{r.whatsapp ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="text-right tabular-nums">{r.type === "CUSTOMER" ? `${r.used} / ${r.unlimited ? "no limit" : r.perMonth ?? b.small.perMonth}` : "—"}</td>
                    <td className="pl-4"><BusinessControls id={r.id} type={r.type} whatsappOn={r.whatsappOn} perMonth={r.perMonth} unlimited={r.unlimited} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

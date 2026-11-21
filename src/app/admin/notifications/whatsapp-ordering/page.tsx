import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { can, pagePermission, pagePortal } from "@/server/rbac/guard";
import { waOverview } from "@/server/whatsapp/ordering";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PauseButton } from "@/components/whatsapp/admin";

export const metadata = { title: "WhatsApp Orders" };
export const dynamic = "force-dynamic";

const eur = (v: string | number) => `${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const when = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Lisbon" });
const DRAFT: Record<string, "default" | "warning" | "destructive" | "secondary"> = { PENDING: "warning", PLACED: "default", CANCELLED: "secondary", EXPIRED: "secondary", CHANGED: "secondary" };

export default async function WhatsAppOrdersPage() {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.notifications.view", "admin.messages.manage", "admin.settings.manage"]);
  const ov = await waOverview(ctx);
  const manage = can(ctx, ["admin.messages.manage", "admin.settings.manage"]);
  const tiles = [
    { label: "Messages (7 days)", value: ov.tiles.messages7 },
    { label: "Answered by the AI (7 days)", value: ov.tiles.answered7 },
    { label: "Orders by WhatsApp (30 days)", value: ov.tiles.orders30 },
    { label: "Order value (30 days)", value: eur(ov.tiles.value30) },
    { label: "Proposals waiting for YES", value: ov.tiles.pendingDrafts },
    { label: "Taken over by staff", value: ov.tiles.paused },
  ];
  const warn: string[] = [];
  if (!ov.settings.enabled) warn.push("WhatsApp ordering is switched off.");
  if (!ov.provider.ready) warn.push(`The WhatsApp provider (${ov.provider.driver}) is missing ${ov.provider.missing.join(", ") || "its settings"} — messages are only logged.`);
  if (!ov.aiReady) warn.push("No AI is connected (ANTHROPIC_API_KEY) — the agent cannot answer.");
  if (ov.settings.inputs.voice && !ov.voiceReady) warn.push("Voice notes are on but speech-to-text is not set up (STT_URL, STT_API_KEY) — customers are asked to type.");
  return (
    <>
      <PageHeader title="WhatsApp Orders" icon={MessageCircle} description="Conversations with FIRINGI's AI on WhatsApp, the order proposals waiting for a YES, and the orders placed. Take over a conversation to answer from the inbox — the AI stays quiet until you give it back." />
      {warn.length > 0 && <div className="mb-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="wa-warnings">{warn.map((w) => <p key={w}>{w}</p>)}</div>}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6" data-testid="wa-tiles">
        {tiles.map((t) => <Card key={t.label}><CardContent className="pt-5"><p className="text-xs text-muted-foreground">{t.label}</p><p className="text-xl font-semibold tabular-nums">{t.value}</p></CardContent></Card>)}
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Conversations</CardTitle><CardDescription>Messages and answers are in the <Link className="underline" href="/admin/notifications/customer-messages">customer inbox</Link>. Settings: <Link className="underline" href="/admin/settings/whatsapp-ordering">WhatsApp Ordering</Link>.</CardDescription></CardHeader>
        <CardContent>
          {ov.conversations.length === 0 ? <p className="text-sm text-muted-foreground">No WhatsApp conversations yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="wa-conversations">
                <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Business</th><th>Number</th><th>Last message</th><th>When</th><th /></tr></thead>
                <tbody>
                  {ov.conversations.map((c) => (
                    <tr key={c.id} className="border-t align-top">
                      <td className="py-1.5 font-medium">{c.company}</td>
                      <td className="tabular-nums">{c.number}</td>
                      <td className="max-w-[360px] text-muted-foreground">{c.last}</td>
                      <td className="whitespace-nowrap">{when(c.updatedAt)}{c.pausedUntil && <div><Badge variant="warning">Staff until {when(c.pausedUntil)}</Badge></div>}</td>
                      <td className="text-right">{manage && <PauseButton id={c.id} paused={!!c.pausedUntil} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Order proposals</CardTitle><CardDescription>What the AI proposed. Placed only on the customer&apos;s YES, and only if the cart is unchanged.</CardDescription></CardHeader>
          <CardContent>
            {ov.drafts.length === 0 ? <p className="text-sm text-muted-foreground">No proposals yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm" data-testid="wa-drafts">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Business</th><th>Status</th><th className="text-right">Total</th><th className="pl-3">Orders</th><th>When</th></tr></thead>
                  <tbody>
                    {ov.drafts.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="py-1.5">{d.company}</td>
                        <td><Badge variant={DRAFT[d.status] ?? "secondary"}>{d.status.charAt(0) + d.status.slice(1).toLowerCase()}</Badge>{d.error && <div className="text-xs text-destructive">{d.error}</div>}</td>
                        <td className="text-right tabular-nums">{eur(d.total)}</td>
                        <td className="pl-3">{d.orders.join(", ") || "—"}</td>
                        <td className="whitespace-nowrap">{when(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Orders placed by WhatsApp</CardTitle><CardDescription>Last 30 days.</CardDescription></CardHeader>
          <CardContent>
            {ov.orders.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm" data-testid="wa-orders">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Order</th><th>Business</th><th className="text-right">Total</th><th className="pl-3">Status</th><th>Placed</th></tr></thead>
                  <tbody>
                    {ov.orders.map((o) => (
                      <tr key={o.id} className="border-t">
                        <td className="py-1.5"><Link className="text-primary hover:underline" href={`/admin/orders/${o.id}`}>{o.number}</Link></td>
                        <td>{o.company}</td>
                        <td className="text-right tabular-nums">{eur(o.total)}</td>
                        <td className="pl-3">{o.status.replaceAll("_", " ").toLowerCase()}</td>
                        <td className="whitespace-nowrap">{when(o.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

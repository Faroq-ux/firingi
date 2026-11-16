import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { pagePermission, pagePortal } from "@/server/rbac/guard";
import { chatOverview, flaggedMessages } from "@/server/chat/service";
import { CHANNEL_LABEL, FLAG_LABEL, type ChatFlag } from "@/lib/chat";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChatTabs, ReviewFlagButton } from "@/components/chat/admin";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Flagged Messages" };
export const dynamic = "force-dynamic";

const SIDE: Record<string, string> = { BUYER: "Customer", SUPPLIER: "Supplier", DRIVER: "Driver", FIRINGI: "FIRINGI" };

export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const ctx = await pagePortal("admin");
  pagePermission(ctx, ["admin.orders.view", "admin.orders.manage", "admin.support.manage"]);
  const all = (await searchParams).all === "1";
  const [rows, o] = await Promise.all([flaggedMessages(ctx, { open: !all }), chatOverview(ctx)]);
  const manage = ctx.permissions.has("admin.orders.manage") || ctx.permissions.has("admin.support.manage") || ctx.permissions.has("admin.settings.manage");
  return (
    <>
      <PageHeader title="Flagged Messages" icon={ShieldAlert}
        description="Messages where someone typed a phone number, e-mail, IBAN or link — a sign they may be taking the business off FIRINGI. Participants saw [•••] instead (unless hiding is off for that company); you see what was typed." />
      <ChatTabs active="/admin/orders/chat/flagged" flagged={o.openFlags} />
      <div className="mb-3 flex gap-2 text-sm">
        <Link href="?" className={`rounded-md border px-3 py-1 ${!all ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>To review</Link>
        <Link href="?all=1" className={`rounded-md border px-3 py-1 ${all ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>All</Link>
      </div>
      <Card><CardContent className="pt-4">
        {!rows.length ? <p className="py-8 text-center text-sm text-muted-foreground" data-testid="flagged-empty">Nothing to review.</p> : (
          <ul className="divide-y" data-testid="flagged-list">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1.5 py-3 text-sm" data-testid="flagged-row">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/orders/${r.orderId}#chat`} className="font-mono font-semibold text-primary hover:underline">{r.number}</Link>
                  <span className="text-muted-foreground">{CHANNEL_LABEL[r.channel]}</span>
                  <span>· {r.author} ({SIDE[r.side]}, {r.company})</span>
                  {r.flags.map((f) => <Badge key={f} variant="secondary">{FLAG_LABEL[f as ChatFlag]}</Badge>)}
                  {r.hidden ? <Badge>hidden</Badge> : <Badge variant="destructive">shown — hiding off</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{formatDate(r.at, "en-GB", true)}</span>
                </div>
                <p className="break-words rounded-md bg-muted/50 p-2"><span className="text-xs text-muted-foreground">Typed: </span>{r.typed}</p>
                {r.hidden && <p className="break-words text-xs text-muted-foreground">They saw: {r.shown}</p>}
                {manage && !r.reviewed && <ReviewFlagButton id={r.id} />}
                {r.reviewed && <p className="text-xs text-muted-foreground">Reviewed</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>
    </>
  );
}

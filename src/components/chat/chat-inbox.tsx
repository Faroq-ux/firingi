/** Inbox of order conversations (Phase 35) — buyers, suppliers, drivers (translated) and FIRINGI (English). */
import Link from "next/link";
import { Camera, MessagesSquare } from "lucide-react";
import type { Ctx } from "@/server/context";
import { chatInbox, type Portal } from "@/server/chat/service";
import { CHANNEL_LABEL, FLAG_LABEL, type ChatChannelKey, type ChatFlag } from "@/lib/chat";
import { Badge } from "@/components/ui/badge";
import { chatLabels } from "./order-chat-panel";

const href = (portal: Portal, r: { orderId: string; deliveryId: string | null }) =>
  portal === "driver" ? `/driver/deliveries/${r.deliveryId}#chat` : `/${portal}/orders/${r.orderId}#chat`;

export async function ChatInbox({ ctx, portal }: { ctx: Ctx; portal: Portal }) {
  const english = portal === "admin";
  const [{ l, locale }, rows] = await Promise.all([chatLabels(english), chatInbox(ctx, portal)]);
  const when = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const withName = (w: string, channel: string) => (w === "DRIVER" ? l.tabDriver : english ? `${w} · ${CHANNEL_LABEL[channel as ChatChannelKey]}` : w);
  if (!rows.length) return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground" data-testid="chat-inbox-empty">
      <MessagesSquare className="size-8 opacity-60" />{l.noThreads}
    </div>
  );
  return (
    <ul className="divide-y" data-testid="chat-inbox">
      {rows.map((r) => (
        <li key={r.threadId}>
          <Link href={href(portal, r)} className="flex items-start gap-3 rounded-lg px-2 py-3 transition hover:bg-accent/50" data-testid="chat-inbox-row">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${r.unread ? "bg-[var(--vivid-pink,#db2777)]" : "bg-transparent"}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-sm font-semibold text-primary">{r.number}</span>
                <span className="text-sm font-medium">{withName(r.with, r.channel)}</span>
                {r.unread > 0 && <Badge className="bg-[var(--vivid-pink,#db2777)] text-white">{l.unread.replace("{n}", String(r.unread))}</Badge>}
                {english && r.last?.flags.map((f) => <Badge key={f} variant="secondary">{FLAG_LABEL[f as ChatFlag]}</Badge>)}
              </span>
              {r.last && (
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                  <span className="font-medium text-foreground/80">{r.last.side === "DRIVER" ? l.driver : r.last.name}:</span> {r.last.body || null}
                  {r.last.photos > 0 && <Camera className="ml-1 inline size-3.5 align-[-2px]" aria-label={l.photo} />}
                </span>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{when.format(r.lastAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

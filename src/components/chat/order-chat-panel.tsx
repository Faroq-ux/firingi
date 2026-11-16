/** Order chat card for an order page (Phase 35) — server part: loads the conversations the viewer is in. */
import { getLocale, getMessages } from "next-intl/server";
import type { Ctx } from "@/server/context";
import { orderChat, type Portal } from "@/server/chat/service";
import { CHANNEL_LABEL, type ChatChannelKey } from "@/lib/chat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import en from "@/messages/en.json";
import { OrderChat, type ChatTab } from "./order-chat";

type Msgs = typeof en.chat;
const flat = (o: Record<string, unknown>, p = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)))));

export async function chatLabels(english: boolean) {
  if (english) return { l: flat(en.chat), locale: "en" };
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  return { l: { ...flat(en.chat), ...flat(((m as { chat?: Partial<Msgs> }).chat ?? {}) as Record<string, unknown>) }, locale };
}

function tabLabel(as: string, channel: ChatChannelKey, l: Record<string, string>) {
  if (as === "FIRINGI") return CHANNEL_LABEL[channel];
  if (channel === "DRIVER") return as === "DRIVER" ? l.tabCustomer : l.tabDriver;
  if (channel === "BUYER_SUPPLIER") return as === "BUYER" ? l.tabSupplier : l.tabCustomer;
  return "FIRINGI";
}

export async function OrderChatPanel({ ctx, orderId, portal, bare = false }: { ctx: Ctx; orderId: string; portal: Portal; bare?: boolean }) {
  const english = portal === "admin";
  const { l, locale } = await chatLabels(english);
  const view = await orderChat(ctx, orderId, portal, { locale: english ? "en" : locale }).catch(() => null);
  if (!view || !view.channels.length) return null;
  const tabs: ChatTab[] = view.channels.map((c) => ({
    channel: c.channel, label: tabLabel(view.as, c.channel, l), canWrite: c.canWrite, why: c.why, unread: c.unread,
    messages: c.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  }));
  const body = <OrderChat orderId={orderId} portal={portal} tabs={tabs} photos={view.photos} translate={view.translate && !english} staff={view.as === "FIRINGI"} l={l} locale={locale} />;
  if (bare) return <div id="chat">{body}</div>;
  return (
    <Card className="mt-6 scroll-mt-20" id="chat" data-testid="order-chat-card">
      <CardHeader><CardTitle>{l.cardTitle}</CardTitle><CardDescription>{l.cardHint}</CardDescription></CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

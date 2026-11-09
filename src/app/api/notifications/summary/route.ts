import { getContext } from "@/server/context";
import { myNotifications, unreadCount } from "@/server/services/notifications";

/** The bell: unread count + latest notifications of the signed-in user. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const [unread, latest] = await Promise.all([unreadCount(ctx), myNotifications(ctx, { take: 8 })]);
  return Response.json({ unread, latest: latest.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: !!n.readAt, at: n.createdAt })) }, { headers: { "cache-control": "private, no-store" } });
}

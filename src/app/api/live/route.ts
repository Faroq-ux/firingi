import { getContext } from "@/server/context";
import { liveEvents } from "@/server/services/live";
import type { Portal } from "@/server/rbac/guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/live?portal=admin|vendor|buy&format=json[&since=ISO] — the latest activity as JSON (the
 * dashboards ask every few seconds while visible). Without format=json: a Server-Sent Events stream
 * (checked every 5 s, ends after 5 minutes) for screens that prefer a push connection.
 */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.sessionId.startsWith("api:")) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url).searchParams;
  const portal = (u.get("portal") ?? "buy") as Portal;
  // JSON mode (what the dashboards use): ?since=ISO → events after it; without it, the latest.
  if (u.get("format") === "json") {
    const since = u.get("since") ? new Date(u.get("since")!) : null;
    const events = await liveEvents(ctx, portal, since && !Number.isNaN(since.getTime()) ? since : new Date(Date.now() - 7 * 86400_000), since ? 20 : 15);
    return Response.json({ events }, { headers: { "cache-control": "private, no-store" } });
  }
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null, stop: ReturnType<typeof setTimeout> | null = null;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const first = await liveEvents(ctx, portal, new Date(Date.now() - 7 * 86400_000), 15).catch(() => []);
      let since = first[0] ? new Date(first[0].at) : new Date();
      send("init", first);
      const close = () => { if (timer) clearInterval(timer); if (stop) clearTimeout(stop); try { controller.close(); } catch { /* closed */ } };
      timer = setInterval(async () => {
        try {
          const fresh = await liveEvents(ctx, portal, since, 20);
          if (fresh.length) { since = new Date(fresh[0].at); send("events", fresh); } else controller.enqueue(enc.encode(": ping\n\n"));
        } catch { close(); }
      }, 5000);
      stop = setTimeout(close, 5 * 60_000);
      req.signal.addEventListener("abort", close);
    },
    cancel() { if (timer) clearInterval(timer); if (stop) clearTimeout(stop); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}

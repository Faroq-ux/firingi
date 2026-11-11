import { recordError } from "@/server/ops/errors";

/** Browser errors (window.onerror / unhandled rejections) reported by FIRINGI's pages. Throttled server-side. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { message?: unknown; stack?: unknown; path?: unknown } | null;
  if (!body || typeof body.message !== "string" || !body.message.trim()) return new Response(null, { status: 204 });
  await recordError({ source: "browser", message: body.message, stack: typeof body.stack === "string" ? body.stack : null, path: typeof body.path === "string" ? body.path : null, userAgent: req.headers.get("user-agent") });
  return new Response(null, { status: 204 });
}

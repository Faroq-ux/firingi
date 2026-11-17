/** Phase 39: the data a phone keeps for offline use (per portal). Never cached by the browser or proxies. */
import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { snapshot } from "@/server/app/service";
import { APP_PORTALS, type AppPortal } from "@/lib/app";
import { AppError } from "@/server/errors";

const NO_STORE = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: NO_STORE });
  const portal = new URL(req.url).searchParams.get("portal") as AppPortal;
  if (!APP_PORTALS.includes(portal)) return new Response(JSON.stringify({ error: "Unknown portal" }), { status: 400, headers: NO_STORE });
  try {
    return new Response(JSON.stringify(await snapshot(ctx, portal, await getLocale())), { headers: NO_STORE });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (!(e instanceof AppError)) console.error("app snapshot", e);
    return new Response(JSON.stringify({ error: e instanceof AppError ? e.message : "Error" }), { status, headers: NO_STORE });
  }
}

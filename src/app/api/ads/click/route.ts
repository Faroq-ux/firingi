/**
 * A buyer clicked a sponsored product (Phase 34): counted (and charged for a per-click campaign),
 * then sent to the product page. Signed-out visitors go to the sign-in page.
 */
import { NextResponse } from "next/server";
import { getContext } from "@/server/context";
import { recordClick } from "@/server/ads/service";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = u.searchParams.get("c") ?? "", o = u.searchParams.get("o") ?? "";
  const ctx = await getContext();
  if (!ctx) return NextResponse.redirect(new URL("/login", req.url));
  if (!/^[a-z0-9]{10,40}$/i.test(c) || !/^[a-z0-9]{10,40}$/i.test(o)) return NextResponse.redirect(new URL("/buy/catalogue/browse", req.url));
  const r = await recordClick(ctx, c, o).catch(() => ({ href: `/buy/catalogue/offers/${o}` }));
  return NextResponse.redirect(new URL(r.href, req.url));
}

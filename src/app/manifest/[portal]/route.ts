/**
 * Phase 39: the web app manifest of each portal (/manifest/buy?l=pt-PT …): name, icons, colours,
 * start page and long-press shortcuts in the person's language. Public (no data in it).
 */
import { NAV_BY_PORTAL, resolveNav, type ResolvedSection } from "@/config/nav/resolve";
import { APP_SHORTCUTS } from "@/config/app-bar";
import { APP_PORTALS, type AppPortal } from "@/lib/app";
import { UI_LOCALES } from "@/i18n/config";
import type { PermissionCode } from "@/server/rbac/permissions";
import en from "@/messages/en.json";

const ALL = { has: () => true } as unknown as Set<PermissionCode>;

function labelFor(nav: ResolvedSection[], href: string): string | null {
  let found: string | null = null;
  const walk = (x: unknown) => {
    if (found || !x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    const o = x as Record<string, unknown>;
    if (o.href === href && typeof o.label === "string") { found = o.label; return; }
    Object.values(o).forEach(walk);
  };
  walk(nav);
  return found;
}

export async function GET(req: Request, { params }: { params: Promise<{ portal: string }> }) {
  const portal = (await params).portal.replace(/\.webmanifest$/, "") as AppPortal;
  if (!APP_PORTALS.includes(portal)) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams.get("l") ?? "en";
  const locale = (UI_LOCALES as readonly string[]).includes(q) ? q : "en";
  const m = locale === "en" ? en : ((await import(`@/messages/${locale}.json`)).default as typeof en);
  const app = { ...en.app, ...((m as { app?: Partial<typeof en.app> }).app ?? {}) };
  const navLabels = (m as { navLabels?: Record<string, string> }).navLabels ?? {};
  const nav = resolveNav(NAV_BY_PORTAL[portal], ALL, locale, navLabels);
  const special: Record<string, string> = { "/buy/orders/scan": app.scanTitle, "/offline": app.offlineTitle };
  const shortcuts = APP_SHORTCUTS[portal]
    .map((href) => ({ href, name: labelFor(nav, href) ?? special[href] }))
    .filter((s): s is { href: string; name: string } => !!s.name)
    .map((s) => ({ name: s.name, short_name: s.name.length > 12 ? s.name.slice(0, 12) : s.name, url: `${s.href}?source=shortcut`, icons: [{ src: "/icons/badge-96.png", sizes: "96x96", type: "image/png" }] }));
  const name = `FIRINGI · ${app[`portal_${portal}` as keyof typeof app] ?? portal}`;
  const body = {
    id: `/${portal}`,
    name, short_name: "FIRINGI",
    description: app.manifestDescription,
    lang: locale, dir: "ltr",
    start_url: `/${portal}?source=app`, scope: "/",
    display: "standalone", display_override: ["standalone", "minimal-ui"], orientation: "portrait",
    background_color: "#0b1020", theme_color: "#3b6cf6",
    categories: ["business", "shopping", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts,
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

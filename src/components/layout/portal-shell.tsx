/**
 * Server component used by every portal layout: guards the portal, filters the nav by
 * permission, resolves labels and renders the AppShell.
 */
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { platformSettings } from "@/server/services/platform-settings";
import { pagePortal, portalsFor, type Portal } from "@/server/rbac/guard";
import { NAV_BY_PORTAL, resolveNav } from "@/config/nav/resolve";
import { allowedLocales } from "@/server/data/geo";
import { cartCount } from "@/server/services/cart";
import { unreadCount } from "@/server/services/notifications";
import { can } from "@/server/rbac/guard";
import { hiddenWarehouseNav } from "@/server/warehouse/features";
import { hiddenCompanyNav } from "@/server/accounting/features";
import { pilotBanner } from "@/server/launch/service";
import { AppShell } from "./app-shell";
import { appSettings, portalAllowed } from "@/server/app/service";
import { APP_BAR } from "@/config/app-bar";
import type { BarLink } from "@/components/app/bottom-bar";

/** Hrefs and labels of the menu this person sees (permission-filtered). */
function navLinks(nav: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    const o = x as Record<string, unknown>;
    if (typeof o.href === "string" && typeof o.label === "string" && o.live !== false) out.set(o.href, o.label);
    Object.values(o).forEach(walk);
  };
  walk(nav);
  return out;
}

export async function PortalShell({ portal, children }: { portal: Portal; children: React.ReactNode }) {
  // The layout never redirects for two-factor setup (pages do), so the Security page itself renders.
  const ctx = await pagePortal(portal, { securitySetup: true });
  const [locale, t, tp, tc, locales, tn] = await Promise.all([
    getLocale(),
    getTranslations("common"),
    getTranslations("portal"),
    getTranslations("companyType"),
    allowedLocales(ctx.company.countryId),
    getTranslations("notifications"),
  ]);
  const messages = (await getMessages()) as { navLabels?: Record<string, string>; shell?: { cart?: string; soon?: string } };
  // Warehouse features FIRINGI switched off for this supplier are hidden (the scanner needs pick & pack or shelves)
  const off = portal === "vendor" ? await hiddenWarehouseNav(ctx) : new Set<string>();
  // Optional features FIRINGI hasn't switched on for this company (accounting) are hidden too
  if (portal === "vendor" || portal === "buy") for (const k of await hiddenCompanyNav(ctx, portal)) off.add(k);
  if (off.has("PICK_PACK") && off.has("BINS")) off.add("SCAN");
  const nav = resolveNav(NAV_BY_PORTAL[portal], ctx.permissions, locale, messages.navLabels, off);
  const cart = portal === "buy" && can(ctx, "buyer.orders.place") ? { count: await cartCount(ctx), label: messages.shell?.cart ?? "Cart" } : null;
  const companyLabel = ctx.company.tradeName ?? ctx.company.legalName;

  const notice = (await platformSettings()).notice;
  // Phase 39: installable app — runtime (offline data, outbox, install card) and the phone bottom bar
  const appCfg = await appSettings();
  const appOn = appCfg.portals[portal as keyof typeof appCfg.portals] && portalAllowed(ctx, portal as "buy");
  const ta = await getTranslations("app");
  const links = navLinks(nav);
  const unread = await unreadCount(ctx);
  const bar: BarLink[] = APP_BAR[portal as keyof typeof APP_BAR]
    .filter((i) => (i.special === "scan" ? portal === "buy" && can(ctx, "buyer.orders.place") : links.has(i.href)))
    .map((i) => ({ href: i.href, icon: i.icon, label: i.special === "scan" ? ta("scanShort") : links.get(i.href)!, badge: i.href.endsWith("/cart") ? cart?.count : undefined }));
  // Phase 33: during the pilot, customers and suppliers see who to tell what works and what doesn't
  const pilot = portal === "buy" || portal === "vendor" ? await pilotBanner(ctx) : null;
  const tl = pilot ? await getTranslations("launch") : null;
  return (
    <AppShell
      portal={portal}
      nav={nav}
      title="FIRINGI"
      subtitle={portal === "admin" ? tp("admin") : `${tp(portal)} · ${tc(ctx.company.type)}`}
      soonLabel={messages.shell?.soon ?? "soon"}
      app={{ enabled: appOn, userId: ctx.user.id, installPrompt: appCfg.installPrompt, unread, bar, moreLabel: t("menu") }}
      topbar={{
        userId: ctx.user.id,
        userName: ctx.user.name,
        userEmail: ctx.user.email,
        companyId: ctx.company.id,
        companyLabel,
        memberships: ctx.memberships.map((m) => ({ companyId: m.companyId, label: m.legalName })),
        portals: portalsFor(ctx)
          .filter((p) => p !== "driver" || portal === "driver")
          .map((p) => ({ key: p, label: tp(p), href: `/${p}`, active: p === portal })),
        locale,
        locales,
        labels: { signOut: t("signOut"), language: t("language"), company: t("company"), menu: t("menu"), security: (await getTranslations("security"))("title"), search: (await getTranslations("palette"))("search") },
        securityHref: portal === "driver" ? null : `/${portal}/me/security`,
        searchCountry: portal === "admin" ? await (async () => {
          const { adminCountryOptions, adminSearchCountry } = await import("@/server/services/admin-search");
          return { value: (await adminSearchCountry()) ?? "", options: await adminCountryOptions(ctx) };
        })() : null,
        cart,
        bell: { initialUnread: unread, base: `/${portal}`, labels: { title: tn("title"), empty: tn("empty"), markAllRead: tn("markAllRead"), viewAll: tn("viewAll"), preferences: tn("preferences") } },
        theme: {
          initial: (["light", "dark", "system"].includes((await cookies()).get("theme")?.value ?? "") ? (await cookies()).get("theme")!.value : "system") as "light" | "dark" | "system",
          labels: { light: t("themeLight"), dark: t("themeDark"), system: t("themeSystem") },
        },
      }}
    >
      {notice && <p className="mb-4 rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm" role="status" data-testid="platform-notice">{notice}</p>}
      {pilot && tl && (
        <p className="mb-4 flex flex-wrap items-center gap-x-2 rounded-md border border-[color:color-mix(in_oklab,var(--vivid-teal)_45%,transparent)] bg-[color-mix(in_oklab,var(--vivid-teal)_10%,transparent)] px-3 py-2 text-sm" role="status" data-testid="pilot-banner">
          <span>🚀 {tl("bannerText")}</span>
          <a href={`/${portal}/support`} className="font-medium text-primary hover:underline">{tl("bannerLink")}</a>
          {pilot.supportEmail && <span className="text-muted-foreground">· {pilot.supportEmail}</span>}
        </p>
      )}
      {children}
    </AppShell>
  );
}

/**
 * Server component used by every portal layout: guards the portal, filters the nav by
 * permission, resolves labels and renders the AppShell.
 */
import { getLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { pagePortal, portalsFor, type Portal } from "@/server/rbac/guard";
import { NAV_BY_PORTAL, resolveNav } from "@/config/nav/resolve";
import { allowedLocales } from "@/server/data/geo";
import { cartCount } from "@/server/services/cart";
import { can } from "@/server/rbac/guard";
import { AppShell } from "./app-shell";

export async function PortalShell({ portal, children }: { portal: Portal; children: React.ReactNode }) {
  const ctx = await pagePortal(portal);
  const [locale, t, tp, tc, locales] = await Promise.all([
    getLocale(),
    getTranslations("common"),
    getTranslations("portal"),
    getTranslations("companyType"),
    allowedLocales(ctx.company.countryId),
  ]);
  const nav = resolveNav(NAV_BY_PORTAL[portal], ctx.permissions, locale);
  const cart = portal === "buy" && can(ctx, "buyer.orders.place") ? { count: await cartCount(ctx), label: locale.startsWith("pt") ? "Carrinho" : "Cart" } : null;
  const companyLabel = ctx.company.tradeName ?? ctx.company.legalName;

  return (
    <AppShell
      nav={nav}
      title="FIRINGI"
      subtitle={portal === "admin" ? tp("admin") : `${tp(portal)} · ${tc(ctx.company.type)}`}
      soonLabel={locale.startsWith("pt") ? "breve" : locale.startsWith("es") ? "pronto" : "soon"}
      topbar={{
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
        labels: { signOut: t("signOut"), language: t("language"), company: t("company"), menu: t("menu") },
        cart,
        theme: {
          initial: (["light", "dark", "system"].includes((await cookies()).get("theme")?.value ?? "") ? (await cookies()).get("theme")!.value : "system") as "light" | "dark" | "system",
          labels: { light: t("themeLight"), dark: t("themeDark"), system: t("themeSystem") },
        },
      }}
    >
      {children}
    </AppShell>
  );
}

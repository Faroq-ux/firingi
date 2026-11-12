/**
 * Turns a nav config into what one user may see (permission-filtered, labels resolved),
 * and finds the nav item for a placeholder URL.
 */
import type { Portal } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { pickLocalized } from "@/i18n/config";
import { ADMIN_NAV } from "./admin";
import { BUY_NAV, DRIVER_NAV, VENDOR_NAV } from "./portals";
import type { NavItem, NavSection } from "./types";

export const NAV_BY_PORTAL: Record<Portal, NavSection[]> = {
  admin: ADMIN_NAV,
  vendor: VENDOR_NAV,
  buy: BUY_NAV,
  driver: DRIVER_NAV,
};

export type ResolvedItem = { key: string; label: string; href: string; live: boolean };
export type ResolvedGroup = { key: string; label: string; items: ResolvedItem[] };
export type ResolvedSection = { key: string; label: string; icon: string; items: ResolvedItem[]; groups: ResolvedGroup[] };

const visible = (item: NavItem, perms: Set<PermissionCode>, off?: Set<string>) =>
  item.permission.some((p) => perms.has(p)) && !(item.feature && off?.has(item.feature));

/**
 * `navLabels` (from the locale's message file, keyed by the English label) translates labels
 * for languages that are not written inline in the nav config.
 */
export function resolveNav(nav: NavSection[], perms: Set<PermissionCode>, locale: string, navLabels: Record<string, string> = {}, off?: Set<string>): ResolvedSection[] {
  const label = (v: unknown) => {
    const o = v as Record<string, string>;
    return o[locale] ?? o[locale.split("-")[0]] ?? navLabels[o.en] ?? pickLocalized(v, "en");
  };
  const mapItem = (i: NavItem): ResolvedItem => ({ key: i.key, label: label(i.label), href: i.href, live: i.live });
  return nav
    .map((s) => ({
      key: s.key,
      label: label(s.label),
      icon: s.icon,
      items: (s.items ?? []).filter((i) => visible(i, perms, off)).map(mapItem),
      groups: (s.groups ?? [])
        .map((g) => ({ key: g.key, label: label(g.label), items: g.items.filter((i) => visible(i, perms, off)).map(mapItem) }))
        .filter((g) => g.items.length > 0),
    }))
    .filter((s) => s.items.length > 0 || s.groups.length > 0);
}

export function allItems(nav: NavSection[]): NavItem[] {
  return nav.flatMap((s) => [...(s.items ?? []), ...(s.groups ?? []).flatMap((g) => g.items)]);
}

/** Find the (non-live) nav item a placeholder URL belongs to. */
export function findNavItem(portal: Portal, pathname: string): { item: NavItem; section: NavSection } | null {
  for (const s of NAV_BY_PORTAL[portal]) {
    for (const i of [...(s.items ?? []), ...(s.groups ?? []).flatMap((g) => g.items)]) {
      if (i.href.split("?")[0] === pathname) return { item: i, section: s };
    }
  }
  return null;
}

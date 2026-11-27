"use client";
/**
 * Collapsible sidebar. Receives an already permission-filtered, localized nav from the
 * server, so nothing the user may not see is ever sent to the browser.
 */
import Link from "next/link";
import { BRAND_SLOGAN } from "@/config/brand";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { openPalette } from "./command-palette";
import {
  BarChart3, Bell, Bot, Building2, Calculator, CalendarClock, ChefHat, ChevronDown, Coins, Contact, Gift, Globe, Handshake, LayoutDashboard, LifeBuoy, Megaphone, Package,
  Receipt, Recycle, ScanBarcode, Settings, ShieldCheck, ShoppingBag, Store, TrendingUp, Truck, UserCog, UserRound, Users, Wallet, Warehouse, type LucideIcon,
} from "lucide-react";
import type { ResolvedItem, ResolvedSection } from "@/config/nav/resolve";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";

export const ICONS: Record<string, LucideIcon> = {
  BarChart3, Bell, Bot, Building2, Calculator, CalendarClock, ChefHat, Coins, Contact, Gift, Globe, Handshake, LayoutDashboard, LifeBuoy, Megaphone, Package, Receipt,
  Recycle, ScanBarcode, Settings, ShieldCheck, ShoppingBag, Store, TrendingUp, Truck, UserCog, UserRound, Users, Wallet, Warehouse,
};

function isActive(item: ResolvedItem, pathname: string, search: string) {
  const [path, query] = item.href.split("?");
  if (path !== pathname) return false;
  return query ? search.includes(query) : !search.includes("view=");
}

function sectionHasActive(s: ResolvedSection, pathname: string, search: string) {
  return [...s.items, ...s.groups.flatMap((g) => g.items)].some((i) => isActive(i, pathname, search));
}

function NavLink({ item, pathname, search, soonLabel }: { item: ResolvedItem; pathname: string; search: string; soonLabel: string }) {
  const active = isActive(item, pathname, search);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative ml-4 flex items-center justify-between gap-2 rounded-lg py-1 pl-3.5 pr-2 text-[12.5px] transition-all duration-150 hover:translate-x-0.5 before:absolute before:-left-px before:top-1/2 before:h-4 before:w-px before:-translate-y-1/2 before:bg-white/10",
        active ? "nav-active before:hidden" : "text-sidebar-foreground/80 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      <span className="truncate">{item.label}</span>
      {!item.live && <span className={cn("text-[10px] uppercase tracking-wide", active ? "text-white/70" : "text-sidebar-muted")}>{soonLabel}</span>}
    </Link>
  );
}

export function Sidebar({ nav, title, subtitle, soonLabel, collapsed = false, onCollapse }: { nav: ResolvedSection[]; title: string; subtitle: string; soonLabel: string; collapsed?: boolean; onCollapse?: (v: boolean) => void }) {
  const t = useTranslations("palette");
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(nav.map((s) => [s.key, sectionHasActive(s, pathname, search)])),
  );
  useEffect(() => {
    // Expand the section containing the current page after navigation.
    const active = nav.find((s) => sectionHasActive(s, pathname, search));
    if (active) setOpen((o) => (o[active.key] ? o : { ...o, [active.key]: true }));
  }, [pathname, search, nav]);

  if (collapsed)
    return (
      <nav className="sidebar-aurora flex h-full flex-col items-center gap-1 py-3 text-sidebar-foreground" data-testid="sidebar-rail">
        <div className="mb-2 text-white"><Wordmark className="text-[13px]" /></div>
        <button type="button" onClick={openPalette} title={t("search")} aria-label={t("search")} className="grid size-9 place-items-center rounded-lg text-sidebar-foreground/80 hover:bg-white/10 hover:text-white"><Search className="size-[18px]" /></button>
        <div className="my-1 h-px w-8 bg-white/10" />
        <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {nav.map((s) => {
            const Icon = ICONS[s.icon] ?? LayoutDashboard;
            const active = sectionHasActive(s, pathname, search);
            return (
              <button key={s.key} type="button" title={s.label} aria-label={s.label} onClick={() => { setOpen((o) => ({ ...o, [s.key]: true })); onCollapse?.(false); }}
                className={cn("grid size-9 place-items-center rounded-lg transition-all", active ? "nav-active" : "text-sidebar-foreground/75 hover:bg-white/10 hover:text-white")}>
                <Icon className="size-5" />
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => onCollapse?.(false)} title={t("expand")} aria-label={t("expand")} className="grid size-9 place-items-center rounded-lg text-sidebar-muted hover:bg-white/10 hover:text-white" data-testid="sidebar-expand"><PanelLeftOpen className="size-5" /></button>
      </nav>
    );

  return (
    <nav className="sidebar-aurora flex h-full flex-col text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-3">
                <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[14px] font-bold tracking-[0.1em] text-white">{title === "FIRINGI" ? <Wordmark className="text-[24px]" /> : title}</div>
          <div className="truncate text-[11px] text-sidebar-muted">{subtitle}</div>
        </div>
        {onCollapse && <button type="button" onClick={() => onCollapse(true)} title={t("collapse")} aria-label={t("collapse")} className="hidden rounded-lg p-1.5 text-sidebar-muted hover:bg-white/10 hover:text-white lg:block" data-testid="sidebar-collapse"><PanelLeftClose className="size-4" /></button>}
      </div>
      <div className="px-2.5 pb-1.5">
        <button type="button" onClick={openPalette} title={`${t("search")} (Ctrl+K)`} className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-left text-[12.5px] text-sidebar-foreground/75 transition-colors hover:border-white/20 hover:bg-white/10" data-testid="palette-open">
          <Search className="size-4" /><span className="flex-1">{t("search")}</span>
        </button>
      </div>
      <div className="flex-1 space-y-px overflow-y-auto px-1.5 py-1.5">
        {nav.map((s, idx) => {
          const Icon = ICONS[s.icon] ?? LayoutDashboard;
          const isOpen = open[s.key];
          return (
            <div key={s.key}>
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}
                aria-expanded={isOpen}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12.5px] font-medium transition-colors hover:bg-white/[0.06]",
                  sectionHasActive(s, pathname, search) && "text-white",
                )}
              >
                <span className="sr-only">{nav.length > 8 ? idx + 1 : ""}</span>
                <span className={cn("grid size-6 shrink-0 place-items-center rounded-md transition-all", sectionHasActive(s, pathname, search) ? "bg-[linear-gradient(135deg,var(--vivid-blue),var(--vivid-violet))] text-white shadow-[0_0_14px_-3px_var(--vivid-violet)]" : "bg-white/[0.06] text-sidebar-muted group-hover:text-white")}><Icon className="size-3.5" /></span>
                <span className="flex-1 truncate">{s.label}</span>
                <ChevronDown className={cn("size-3.5 text-sidebar-muted transition-transform duration-200", isOpen && "rotate-180")} />
              </button>
              <div className="collapsible" data-open={isOpen ? "true" : "false"} inert={!isOpen}>
                <div className={cn("space-y-0.5", isOpen && "mb-1 mt-0.5")}>
                  {s.items.map((i) => <NavLink key={i.key} item={i} pathname={pathname} search={search} soonLabel={soonLabel} />)}
                  {s.groups.map((g) => (
                    <div key={g.key} className="pt-1">
                      <div className="pb-0.5 pl-8 pt-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">{g.label}</div>
                      {g.items.map((i) => <NavLink key={i.key} item={i} pathname={pathname} search={search} soonLabel={soonLabel} />)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-white/10 px-3 py-2 text-[9px] font-medium tracking-[0.22em] text-sidebar-muted">{BRAND_SLOGAN}</div>
    </nav>
  );
}

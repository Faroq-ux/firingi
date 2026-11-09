"use client";
/**
 * Collapsible sidebar. Receives an already permission-filtered, localized nav from the
 * server, so nothing the user may not see is ever sent to the browser.
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3, Bell, Bot, Building2, ChevronDown, Coins, Contact, Globe, Handshake, LayoutDashboard, Megaphone, Package,
  Receipt, Settings, ShieldCheck, ShoppingBag, Store, Truck, UserCog, UserRound, Users, Wallet, type LucideIcon,
} from "lucide-react";
import type { ResolvedItem, ResolvedSection } from "@/config/nav/resolve";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  BarChart3, Bell, Bot, Building2, Coins, Contact, Globe, Handshake, LayoutDashboard, Megaphone, Package, Receipt,
  Settings, ShieldCheck, ShoppingBag, Store, Truck, UserCog, UserRound, Users, Wallet,
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
        "flex items-center justify-between gap-2 rounded-md py-1.5 pl-9 pr-2 text-[13px] transition-all duration-150 hover:translate-x-0.5",
        active ? "bg-sidebar-active text-white" : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-white",
      )}
    >
      <span className="truncate">{item.label}</span>
      {!item.live && <span className={cn("text-[10px] uppercase tracking-wide", active ? "text-white/70" : "text-sidebar-muted")}>{soonLabel}</span>}
    </Link>
  );
}

export function Sidebar({ nav, title, subtitle, soonLabel }: { nav: ResolvedSection[]; title: string; subtitle: string; soonLabel: string }) {
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

  return (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-4">
        <div className="grid size-8 place-items-center rounded-md bg-sidebar-active text-sm font-bold text-white">F</div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-wide text-white">{title}</div>
          <div className="text-[11px] text-sidebar-muted">{subtitle}</div>
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
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
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] font-medium hover:bg-sidebar-accent",
                  sectionHasActive(s, pathname, search) && "text-white",
                )}
              >
                <span className="w-4 text-right text-[10px] text-sidebar-muted">{nav.length > 8 ? idx + 1 : ""}</span>
                <Icon className="size-4 shrink-0 text-sidebar-muted" />
                <span className="flex-1 truncate">{s.label}</span>
                <ChevronDown className={cn("size-3.5 text-sidebar-muted transition-transform duration-200", isOpen && "rotate-180")} />
              </button>
              <div className="collapsible" data-open={isOpen ? "true" : "false"} inert={!isOpen}>
                <div className={cn("space-y-0.5", isOpen && "mb-1 mt-0.5")}>
                  {s.items.map((i) => <NavLink key={i.key} item={i} pathname={pathname} search={search} soonLabel={soonLabel} />)}
                  {s.groups.map((g) => (
                    <div key={g.key} className="pt-1">
                      <div className="pb-0.5 pl-9 pt-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">{g.label}</div>
                      {g.items.map((i) => <NavLink key={i.key} item={i} pathname={pathname} search={search} soonLabel={soonLabel} />)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

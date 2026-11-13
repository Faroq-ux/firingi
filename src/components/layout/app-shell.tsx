"use client";
import { TableLabeler } from "@/components/ui/table-labeler";
import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { Topbar, type TopbarProps } from "./topbar";
import { NavProgress } from "./nav-progress";
import { CommandPalette } from "./command-palette";
import { NavContext } from "./nav-context";
import type { ResolvedSection } from "@/config/nav/resolve";
import { cn } from "@/lib/utils";

export function AppShell({
  nav, title, subtitle, soonLabel, topbar, portal, children,
}: { nav: ResolvedSection[]; title: string; subtitle: string; soonLabel: string; topbar: Omit<TopbarProps, "onMenu">; portal: string; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Laptop and up (≥ 1024 px): the sidebar stays open and can fold; below that it's a drawer, so tablets get the full width.
  // Desktop: the sidebar can fold into an icon rail (remembered on this device).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem("firingi.sidebar.collapsed") === "1"); } catch { /* private mode */ } }, []);
  const collapse = (v: boolean) => { setCollapsed(v); try { localStorage.setItem("firingi.sidebar.collapsed", v ? "1" : "0"); } catch { /* private mode */ } };
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <NavContext.Provider value={nav}>
    <div className="flex min-h-dvh">
      <Suspense><NavProgress /></Suspense>
      <TableLabeler />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 -translate-x-full shadow-[8px_0_40px_-20px_rgb(0_0_0/0.5)] transition-[transform,width] duration-300 ease-out lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
          mobileOpen && "translate-x-0",
          collapsed && "lg:w-[72px]",
        )}
      >
        <Suspense>
          <Sidebar nav={nav} title={title} subtitle={subtitle} soonLabel={soonLabel} collapsed={collapsed && !mobileOpen} onCollapse={collapse} />
        </Suspense>
      </aside>
      <CommandPalette nav={nav} portal={portal} />
      {mobileOpen && <div className="animate-fade fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar {...topbar} onMenu={() => setMobileOpen(true)} />
        <main key={pathname} className="animate-page mx-auto w-full min-w-0 max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
    </NavContext.Provider>
  );
}

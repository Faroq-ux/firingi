"use client";
import { Suspense, useState } from "react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { Topbar, type TopbarProps } from "./topbar";
import { NavProgress } from "./nav-progress";
import type { ResolvedSection } from "@/config/nav/resolve";
import { cn } from "@/lib/utils";

export function AppShell({
  nav, title, subtitle, soonLabel, topbar, children,
}: { nav: ResolvedSection[]; title: string; subtitle: string; soonLabel: string; topbar: Omit<TopbarProps, "onMenu">; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex min-h-dvh">
      <Suspense><NavProgress /></Suspense>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 -translate-x-full transition-transform duration-300 ease-out md:sticky md:top-0 md:h-dvh md:translate-x-0",
          mobileOpen && "translate-x-0",
        )}
      >
        <Suspense>
          <Sidebar nav={nav} title={title} subtitle={subtitle} soonLabel={soonLabel} />
        </Suspense>
      </aside>
      {mobileOpen && <div className="animate-fade fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] md:hidden" onClick={() => setMobileOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar {...topbar} onMenu={() => setMobileOpen(true)} />
        <main key={pathname} className="animate-page mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

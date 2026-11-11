"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { EllipsisVertical, LogOut, Menu, ShoppingCart } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { setLocaleAction, switchCompanyAction } from "@/server/actions/session";
import { cn } from "@/lib/utils";
import { ThemeToggle, type ThemeChoice } from "@/components/theme/theme";
import { NotificationBell, type BellLabels } from "@/components/notifications/bell";

export type TopbarProps = {
  userName: string;
  userEmail: string;
  companyId: string;
  companyLabel: string;
  memberships: { companyId: string; label: string }[];
  portals: { key: string; label: string; href: string; active: boolean }[];
  locale: string;
  locales: { code: string; native: string }[];
  labels: { signOut: string; language: string; company: string; menu: string; security?: string };
  securityHref?: string | null;
  cart?: { count: number; label: string } | null;
  bell?: { initialUnread: number; base: string; labels: BellLabels } | null;
  theme: { initial: ThemeChoice; labels: Record<ThemeChoice, string> };
  onMenu?: () => void;
};

export function Topbar(p: TopbarProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Phones: language, theme and sign-out fold into a small menu so the bar never overflows.
  const [more, setMore] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMore(false), [pathname]);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b sm:gap-3 bg-card/95 px-3 backdrop-blur md:px-5">
      <button type="button" className="rounded-md p-2 hover:bg-accent md:hidden" onClick={p.onMenu} aria-label={p.labels.menu}>
        <Menu className="size-5" />
      </button>

      {p.portals.length > 1 && (
        <div className="flex shrink-0 rounded-lg bg-muted p-0.5 text-xs sm:text-sm" role="tablist">
          {p.portals.map((x) => (
            <Link
              key={x.key}
              href={x.href}
              role="tab"
              aria-selected={x.active}
              className={cn("rounded-md px-2 py-1 font-medium sm:px-3", x.active ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {x.label}
            </Link>
          ))}
        </div>
      )}

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
        {p.bell && <NotificationBell {...p.bell} />}
        {p.cart && (
          <Link href="/buy/orders/cart" className="relative rounded-md p-2 hover:bg-accent" aria-label={`${p.cart.label} (${p.cart.count})`}>
            <ShoppingCart className="size-5" />
            {p.cart.count > 0 && <span key={p.cart.count} className="animate-pop absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{p.cart.count}</span>}
          </Link>
        )}
        {p.memberships.length > 1 ? (
          <select
            aria-label={p.labels.company}
            className="h-8 w-24 rounded-md border bg-card px-1 text-sm sm:w-auto sm:max-w-48 sm:px-2"
            value={p.companyId}
            disabled={pending}
            onChange={(e) =>
              start(async () => {
                const r = await switchCompanyAction(e.target.value);
                if (r.ok) router.push(r.redirectTo);
              })
            }
          >
            {p.memberships.map((m) => <option key={m.companyId} value={m.companyId}>{m.label}</option>)}
          </select>
        ) : (
          <span className="hidden max-w-56 truncate text-sm text-muted-foreground sm:inline">{p.companyLabel}</span>
        )}

        <button type="button" className="rounded-md p-2 hover:bg-accent sm:hidden" aria-expanded={more} aria-label={`${p.labels.language} · ${p.labels.signOut}`} data-testid="topbar-more" onClick={() => setMore((v) => !v)}>
          <EllipsisVertical className="size-5" />
        </button>
        <div className={cn("items-center gap-2 sm:static sm:flex sm:flex-row sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none", more ? "animate-fade absolute right-2 top-14 z-30 flex flex-col items-stretch rounded-lg border bg-card p-3 shadow-lg" : "hidden")}>
        <select
          aria-label={p.labels.language}
          className="h-8 rounded-md border bg-card px-2 text-sm"
          value={p.locale}
          disabled={pending}
          onChange={(e) => start(async () => { await setLocaleAction(e.target.value); router.refresh(); })}
        >
          {p.locales.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
        </select>

        <ThemeToggle initial={p.theme.initial} labels={p.theme.labels} labelClassName="sm:hidden" />
        {p.securityHref ? (
          <Link href={p.securityHref} title={p.labels.security} data-testid="my-security" className="hidden rounded-md px-1 text-right leading-tight hover:bg-accent lg:block">
            <div className="text-sm font-medium">{p.userName}</div>
            <div className="text-xs text-muted-foreground">{p.userEmail}</div>
          </Link>
        ) : (
          <div className="hidden text-right leading-tight lg:block">
            <div className="text-sm font-medium">{p.userName}</div>
            <div className="text-xs text-muted-foreground">{p.userEmail}</div>
          </div>
        )}
        <button
          type="button"
          title={p.labels.signOut}
          aria-label={p.labels.signOut}
          className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-accent"
          onClick={() => start(async () => { await authClient.signOut(); router.push("/login"); router.refresh(); })}
        >
          <LogOut className="size-4" />
          <span className="sm:hidden" aria-hidden>{p.labels.signOut}</span>
        </button>
        </div>
      </div>
    </header>
  );
}

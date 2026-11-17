"use client";
/** Phase 39: thumb-friendly bottom navigation on phones and tablets (below the laptop breakpoint, where the menu is a drawer). */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Boxes, ClipboardCheck, History, Inbox, LayoutDashboard, Menu, MessageSquare, Package, ScanBarcode, ShoppingCart, Store, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { AlertTriangle, Boxes, ClipboardCheck, History, Inbox, LayoutDashboard, MessageSquare, Package, ScanBarcode, ShoppingCart, Store, Truck } as const;
export type BarLink = { href: string; label: string; icon: string; badge?: number };

export function BottomBar({ items, moreLabel, onMore }: { items: BarLink[]; moreLabel: string; onMore: () => void }) {
  const pathname = usePathname();
  if (!items.length) return null;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label={moreLabel} data-testid="bottom-bar">
      <ul className="mx-auto flex max-w-xl items-stretch justify-around">
        {items.map((i) => {
          const Icon = ICONS[i.icon as keyof typeof ICONS] ?? Package;
          const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
          return (
            <li key={i.href} className="min-w-0 flex-1">
              <Link href={i.href} className={cn("relative flex flex-col items-center gap-0.5 px-1 py-2 text-[11px] leading-tight", active ? "text-primary" : "text-muted-foreground hover:text-foreground")} aria-current={active ? "page" : undefined} data-testid={`bar-${i.href.split("/").pop()}`}>
                <Icon className="size-5" />
                <span className="line-clamp-2 w-full hyphens-auto break-words text-center">{i.label}</span>
                {!!i.badge && <span className="absolute right-[calc(50%-18px)] top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold text-primary-foreground">{i.badge > 99 ? "99+" : i.badge}</span>}
              </Link>
            </li>
          );
        })}
        <li className="min-w-0 flex-1">
          <button type="button" onClick={onMore} className="flex w-full flex-col items-center gap-0.5 px-1 py-2 text-[11px] leading-tight text-muted-foreground hover:text-foreground" data-testid="bar-more">
            <Menu className="size-5" /><span className="line-clamp-2 w-full hyphens-auto break-words text-center">{moreLabel}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

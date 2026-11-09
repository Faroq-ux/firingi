"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut, Menu } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { setLocaleAction, switchCompanyAction } from "@/server/actions/session";
import { cn } from "@/lib/utils";

export type TopbarProps = {
  userName: string;
  userEmail: string;
  companyId: string;
  companyLabel: string;
  memberships: { companyId: string; label: string }[];
  portals: { key: string; label: string; href: string; active: boolean }[];
  locale: string;
  locales: { code: string; native: string }[];
  labels: { signOut: string; language: string; company: string; menu: string };
  onMenu?: () => void;
};

export function Topbar(p: TopbarProps) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/95 px-3 backdrop-blur md:px-5">
      <button type="button" className="rounded-md p-2 hover:bg-accent md:hidden" onClick={p.onMenu} aria-label={p.labels.menu}>
        <Menu className="size-5" />
      </button>

      {p.portals.length > 1 && (
        <div className="flex rounded-lg bg-muted p-0.5 text-sm" role="tablist">
          {p.portals.map((x) => (
            <Link
              key={x.key}
              href={x.href}
              role="tab"
              aria-selected={x.active}
              className={cn("rounded-md px-3 py-1 font-medium", x.active ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {x.label}
            </Link>
          ))}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {p.memberships.length > 1 ? (
          <select
            aria-label={p.labels.company}
            className="h-8 max-w-48 rounded-md border bg-card px-2 text-sm"
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

        <select
          aria-label={p.labels.language}
          className="h-8 rounded-md border bg-card px-2 text-sm"
          value={p.locale}
          disabled={pending}
          onChange={(e) => start(async () => { await setLocaleAction(e.target.value); router.refresh(); })}
        >
          {p.locales.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
        </select>

        <div className="hidden text-right leading-tight lg:block">
          <div className="text-sm font-medium">{p.userName}</div>
          <div className="text-xs text-muted-foreground">{p.userEmail}</div>
        </div>
        <button
          type="button"
          title={p.labels.signOut}
          aria-label={p.labels.signOut}
          className="rounded-md p-2 hover:bg-accent"
          onClick={() => start(async () => { await authClient.signOut(); router.push("/login"); router.refresh(); })}
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}

"use client";
/** Topbar bell: unread count (polled), latest notifications, mark all as read. */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { markReadAction } from "@/server/actions/notifications";

type Item = { id: string; title: string; body: string | null; link: string | null; read: boolean; at: string };
export type BellLabels = { title: string; empty: string; markAllRead: string; viewAll: string; preferences: string };

export function NotificationBell({ initialUnread, base, labels }: { initialUnread: number; base: string; labels: BellLabels }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications/summary", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { unread: number; latest: Item[] };
      setUnread(j.unread);
      setItems(j.latest);
    } catch { /* offline: keep the last state */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load, pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const read = async (id: string) => { await markReadAction({ id }); load(); };
  return (
    <div ref={ref} className="relative">
      <button type="button" data-testid="bell" className="relative rounded-md p-2 hover:bg-accent" aria-label={`${labels.title} (${unread})`} onClick={() => { setOpen((o) => !o); load(); }}>
        <Bell className="size-5" />
        {unread > 0 && <span key={unread} className="animate-pop absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="animate-page absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border bg-card shadow-lg" data-testid="bell-panel">
          <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
            {labels.title}
            {unread > 0 && <button type="button" className="text-xs font-normal text-primary hover:underline" onClick={() => read("ALL")}>{labels.markAllRead}</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items && items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{labels.empty}</li>}
            {items?.map((n) => (
              <li key={n.id}>
                <button type="button" className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent ${n.read ? "text-muted-foreground" : ""}`}
                  onClick={async () => { if (!n.read) await read(n.id); setOpen(false); if (n.link) router.push(n.link); }}>
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                    <div className="min-w-0"><div className={n.read ? "" : "font-medium"}>{n.title}</div>{n.body && <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t px-3 py-2 text-xs">
            <Link href={`${base}/me/notifications`} className="text-primary hover:underline" onClick={() => setOpen(false)}>{labels.viewAll}</Link>
            <Link href={`${base}/me/notification-settings`} className="text-primary hover:underline" onClick={() => setOpen(false)}>{labels.preferences}</Link>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
/**
 * Command palette (Ctrl+K / ⌘K, or the search button): jump to any page of the portal, find
 * orders, companies, products and invoices, switch the theme. Only what the user may open is
 * listed (the nav comes permission-filtered from the server; /api/search checks again).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Building2, CornerDownLeft, FileText, History, LayoutGrid, Moon, Package, Search, ShoppingBag, Sun } from "lucide-react";
import type { ResolvedSection } from "@/config/nav/resolve";
import { cn } from "@/lib/utils";

type Hit = { kind: string; id: string; title: string; subtitle: string; href: string };
type Item = { key: string; group: string; title: string; subtitle?: string; icon: React.ElementType; run: () => void };
const RECENT_KEY = "firingi.palette.recent";
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ICON: Record<string, React.ElementType> = { order: Package, company: Building2, product: ShoppingBag, invoice: FileText };

export const openPalette = () => window.dispatchEvent(new Event("firingi:palette"));

export function CommandPalette({ nav, portal }: { nav: ResolvedSection[]; portal: string }) {
  const t = useTranslations("palette");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<{ href: string; title: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } };
    const ev = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener("firingi:palette", ev);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("firingi:palette", ev); };
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ(""); setHits([]); setSel(0);
    try { setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 5)); } catch { setRecent([]); }
    setTimeout(() => input.current?.focus(), 10);
  }, [open]);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setHits([]); return; }
    const c = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?portal=${portal}&q=${encodeURIComponent(q)}`, { signal: c.signal }).then((r) => r.json()).then((d) => setHits(d.hits ?? [])).catch(() => null).finally(() => setLoading(false));
    }, 180);
    return () => { clearTimeout(timer); c.abort(); };
  }, [q, open, portal]);

  const go = (href: string, title: string) => {
    try { const r = [{ href, title }, ...recent.filter((x) => x.href !== href)].slice(0, 5); localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch { /* private mode */ }
    setOpen(false);
    router.push(href);
  };

  const items = useMemo<Item[]>(() => {
    const f = fold(q.trim());
    const pages = nav.flatMap((s) => [...s.items, ...s.groups.flatMap((g) => g.items)].map((i) => ({ i, section: s.label })))
      .filter(({ i, section }) => i.live && (!f || fold(`${i.label} ${section}`).includes(f)))
      .slice(0, f ? 8 : 0)
      .map(({ i, section }) => ({ key: `p:${i.href}`, group: t("pages"), title: i.label, subtitle: section, icon: LayoutGrid, run: () => go(i.href, i.label) }));
    const found = hits.map((h) => ({ key: `h:${h.kind}:${h.id}`, group: t(`kinds.${h.kind}`), title: h.title, subtitle: h.subtitle, icon: ICON[h.kind] ?? Search, run: () => go(h.href, h.title) }));
    const rec = !f ? recent.map((r) => ({ key: `r:${r.href}`, group: t("recent"), title: r.title, icon: History, run: () => go(r.href, r.title) })) : [];
    const actions: Item[] = [
      { key: "a:dark", group: t("actions"), title: t("dark"), icon: Moon, run: () => { window.dispatchEvent(new CustomEvent("firingi:theme", { detail: "dark" })); setOpen(false); } },
      { key: "a:light", group: t("actions"), title: t("light"), icon: Sun, run: () => { window.dispatchEvent(new CustomEvent("firingi:theme", { detail: "light" })); setOpen(false); } },
    ].filter((a) => !f || fold(a.title).includes(f));
    return [...rec, ...pages, ...found, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, hits, nav, recent]);

  useEffect(() => { setSel(0); }, [q, hits.length]);
  useEffect(() => { list.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  if (!open) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[oklch(0.15_0.03_265/0.45)] p-3 pt-[12vh] backdrop-blur-sm animate-fade" role="dialog" aria-modal="true" aria-label={t("title")} data-testid="palette" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="popover-glass glow-border w-full max-w-xl overflow-hidden rounded-2xl">
        <div className="flex items-center gap-3 border-b border-[color:var(--glass-border)] px-4">
          <Search className="size-5 text-[var(--vivid-violet)]" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("placeholder")} aria-label={t("placeholder")} data-testid="palette-input"
            className="no-glow h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
              else if (e.key === "Escape") setOpen(false);
            }} />
          {loading && <span className="size-4 animate-spin rounded-full border-2 border-[var(--vivid-violet)] border-t-transparent" aria-hidden />}
          <span className="kbd">Esc</span>
        </div>
        <div ref={list} className="max-h-[55vh] overflow-y-auto p-2" role="listbox" data-testid="palette-results">
          {!items.length && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{q.trim().length < 2 ? t("hint") : loading ? t("searching") : t("none")}</p>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            const Icon = it.icon;
            return (
              <div key={it.key}>
                {head && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{head}</p>}
                <button type="button" role="option" aria-selected={i === sel} data-index={i} onMouseMove={() => setSel(i)} onClick={() => it.run()}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", i === sel ? "nav-active" : "hover:bg-accent")}>
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", i === sel ? "bg-white/20" : "bg-muted")}><Icon className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{it.title}</span>{it.subtitle && <span className={cn("block truncate text-xs", i === sel ? "text-white/75" : "text-muted-foreground")}>{it.subtitle}</span>}</span>
                  {i === sel && <ArrowRight className="size-4" aria-hidden />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-[color:var(--glass-border)] px-4 py-2 text-xs text-muted-foreground">
          <span className="kbd">↑</span><span className="kbd">↓</span>{t("move")}<span className="kbd"><CornerDownLeft className="size-3" aria-hidden /></span>{t("open")}
          <span className="ml-auto"><span className="kbd">Ctrl</span> <span className="kbd">K</span></span>
        </div>
      </div>
    </div>
  );
}

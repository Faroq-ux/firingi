"use client";
/** Live activity: newest first, new events slide in with a glow; reconnects by itself. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Banknote, FileText, Package, Wallet } from "lucide-react";
import { LiveDot } from "@/components/motion/shapes";
import { cn } from "@/lib/utils";

type Ev = { id: string; at: string; kind: "order" | "payment" | "payout" | "invoice"; status?: string; number?: string; who?: string; amount?: string; href: string };
const ICON = { order: Package, payment: Banknote, payout: Wallet, invoice: FileText } as const;
const TONE = { order: "var(--vivid-blue)", payment: "var(--vivid-teal)", payout: "var(--vivid-violet)", invoice: "var(--vivid-orange)" } as const;

export function LiveFeed({ portal, max = 12 }: { portal: string; max?: number }) {
  const t = useTranslations("live");
  const ts = useTranslations("orders.statuses");
  const locale = useLocale();
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    // Short requests every few seconds while the page is visible (works behind any proxy and lets
    // the page settle); new events are merged in at the top.
    let since: string | null = null, stopped = false, timer: ReturnType<typeof setTimeout> | null = null;
    const pull = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/live?portal=${portal}&format=json${since ? `&since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
          if (!r.ok) throw new Error(String(r.status));
          const { events: add } = (await r.json()) as { events: Ev[] };
          setOnline(true);
          if (since === null) setEvents(add);
          else if (add.length) { setEvents((cur) => [...add, ...(cur ?? []).filter((x) => !add.some((a) => a.id === x.id))].slice(0, 40)); setFresh(new Set(add.map((a) => a.id))); }
          if (add[0]) since = add[0].at; else if (since === null) since = new Date().toISOString();
        } catch { setOnline(false); }
      }
      timer = setTimeout(pull, 8000);
    };
    void pull();
    const clock = setInterval(() => tick((n) => n + 1), 30_000);
    return () => { stopped = true; if (timer) clearTimeout(timer); clearInterval(clock); };
  }, [portal]);
  const money = (v?: string) => (v ? new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(Number(v)) : "");
  const ago = (iso: string) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
    return s < 60 ? rtf.format(-Math.round(s), "second") : s < 3600 ? rtf.format(-Math.round(s / 60), "minute") : s < 86400 ? rtf.format(-Math.round(s / 3600), "hour") : rtf.format(-Math.round(s / 86400), "day");
  };
  const title = (e: Ev) => e.kind === "order" ? `${e.number} · ${ts(e.status as "NEW")}` : e.kind === "invoice" ? t("invoice", { number: e.number ?? "" }) : t(e.kind);

  return (
    <div data-testid="live-feed">
      <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">{online ? <LiveDot /> : <span className="size-2.5 rounded-full bg-muted-foreground/40" />}{online ? t("connected") : t("reconnecting")}</p>
      {events === null ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div>
      ) : !events.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p> : (
        <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-px before:bg-[linear-gradient(var(--vivid-blue),var(--vivid-violet),transparent)]">
          {events.slice(0, max).map((e) => {
            const Icon = ICON[e.kind];
            return (
              <li key={e.id} className={cn("relative rounded-xl transition-colors", fresh.has(e.id) && "motion-flash")}>
                <Link href={e.href} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-accent/60">
                  <span className="relative z-10 grid size-[38px] shrink-0 place-items-center rounded-xl text-white shadow-md" style={{ background: `linear-gradient(135deg, ${TONE[e.kind]}, color-mix(in oklch, ${TONE[e.kind]} 55%, var(--vivid-violet)))` }}><Icon className="size-4" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{title(e)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[e.who, money(e.amount)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground" dateTime={e.at} suppressHydrationWarning>{ago(e.at)}</time>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

"use client";
/**
 * Customisable dashboard: each person arranges their own cards — drag to reorder (or the arrow
 * buttons), hide / show, make wider or narrower — and the layout is saved to their account.
 * Cards are rendered on the server and passed in; this only arranges them.
 */
import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, GripVertical, LayoutGrid, Loader2, RotateCcw, StretchHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setPreferenceAction } from "@/server/actions/workspace";

export type DashCard = { id: string; title: string; size?: 1 | 2 | 3; node: ReactNode };
type Layout = { order: string[]; hidden: string[]; size: Record<string, 1 | 2 | 3> };
// Columns follow the space the grid really has (not the screen): 1 column, 2 from ~42rem, 3 from ~62rem.
const SPAN = { 1: "", 2: "@2xl:col-span-2", 3: "@2xl:col-span-2 @6xl:col-span-3" } as const;

export function DashboardGrid({ prefKey, cards, saved }: { prefKey: string; cards: DashCard[]; saved?: Partial<Layout> | null }) {
  const t = useTranslations("dash");
  const ids = cards.map((c) => c.id);
  const defaults: Layout = { order: ids, hidden: [], size: Object.fromEntries(cards.map((c) => [c.id, c.size ?? 1])) };
  const merge = (s?: Partial<Layout> | null): Layout => ({
    order: [...(s?.order ?? []).filter((id) => ids.includes(id)), ...ids.filter((id) => !(s?.order ?? []).includes(id))],
    hidden: (s?.hidden ?? []).filter((id) => ids.includes(id)),
    size: { ...defaults.size, ...(s?.size ?? {}) },
  });
  const [layout, setLayout] = useState<Layout>(merge(saved));
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const byId = new Map(cards.map((c) => [c.id, c]));
  const move = (id: string, to: number) => setLayout((l) => { const o = l.order.filter((x) => x !== id); o.splice(Math.max(0, Math.min(o.length, to)), 0, id); return { ...l, order: o }; });
  const save = (l: Layout | null) => start(async () => { await setPreferenceAction({ key: prefKey, value: l }); });
  const shown = layout.order.filter((id) => editing || !layout.hidden.includes(id));

  return (
    <div className="space-y-3" data-testid="dashboard-grid">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editing && <p className="mr-auto text-sm text-muted-foreground">{t("editHint")}</p>}
        {editing && <Button variant="ghost" size="sm" onClick={() => { setLayout(defaults); save(null); }}><RotateCcw className="size-4" />{t("reset")}</Button>}
        <Button variant={editing ? "default" : "outline"} size="sm" data-testid="dash-edit" onClick={() => { if (editing) save(layout); setEditing(!editing); }}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : editing ? <Check className="size-4" /> : <LayoutGrid className="size-4" />}{editing ? t("done") : t("customise")}
        </Button>
      </div>
      <div className="@container"><div className="grid gap-4 @2xl:grid-cols-2 @6xl:grid-cols-3">
        {shown.map((id, i) => {
          const c = byId.get(id)!, hidden = layout.hidden.includes(id), size = layout.size[id] ?? 1;
          return (
            <section key={id} data-card={id} className={cn("relative min-w-0 transition-all", SPAN[size], editing && "rounded-2xl ring-1 ring-[color:color-mix(in_oklch,var(--vivid-violet)_35%,transparent)] ring-offset-4 ring-offset-transparent", hidden && "opacity-45", drag === id && "drag-ghost", over === id && drag !== id && "drop-target")}
              draggable={editing} onDragStart={(e) => { setDrag(id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDrag(null); setOver(null); }}
              onDragOver={(e) => { if (!editing || !drag) return; e.preventDefault(); setOver(id); }}
              onDrop={(e) => { e.preventDefault(); if (drag && drag !== id) move(drag, layout.order.indexOf(id)); setDrag(null); setOver(null); }}>
              {editing && (
                <div className="popover-glass absolute -top-3 right-3 z-20 flex items-center gap-0.5 rounded-xl p-1 text-muted-foreground" data-testid={`dash-tools-${id}`}>
                  <span className="cursor-grab px-1" title={t("drag")}><GripVertical className="size-4" aria-hidden /></span>
                  <span className="max-w-32 truncate px-1 text-xs font-medium text-foreground">{c.title}</span>
                  <button className="rounded-md p-1 hover:bg-accent disabled:opacity-30" disabled={i === 0} onClick={() => move(id, i - 1)} aria-label={t("up")}><ArrowUp className="size-4" /></button>
                  <button className="rounded-md p-1 hover:bg-accent disabled:opacity-30" disabled={i === shown.length - 1} onClick={() => move(id, i + 1)} aria-label={t("down")}><ArrowDown className="size-4" /></button>
                  <button className="rounded-md p-1 hover:bg-accent" onClick={() => setLayout((l) => ({ ...l, size: { ...l.size, [id]: (size === 3 ? 1 : size + 1) as 1 | 2 | 3 } }))} aria-label={t("width")} title={t("width")} data-testid={`dash-size-${id}`}><StretchHorizontal className="size-4" /></button>
                  <button className="rounded-md p-1 hover:bg-accent" onClick={() => setLayout((l) => ({ ...l, hidden: hidden ? l.hidden.filter((x) => x !== id) : [...l.hidden, id] }))} aria-label={hidden ? t("show") : t("hide")} title={hidden ? t("show") : t("hide")} data-testid={`dash-hide-${id}`}>{hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}</button>
                </div>
              )}
              <div className={cn("h-full", editing && "pointer-events-none select-none")}>{c.node}</div>
            </section>
          );
        })}
      </div></div>
    </div>
  );
}

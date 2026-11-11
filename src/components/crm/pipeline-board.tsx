"use client";
/** CRM pipeline as a board: drag a deal to another stage (or use its stage picker); totals per column. */
import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, GripVertical } from "lucide-react";
import { moveDealAction } from "@/server/actions/crm";
import { cn } from "@/lib/utils";

export type BoardDeal = { id: string; title: string; who: string; owner: string; value: string; probability: number; close: string | null; stage: string; picker?: ReactNode };
export type BoardColumn = { stage: string; label: string; total: string; weighted: string | null; deals: BoardDeal[] };
const TONE: Record<string, string> = { PROSPECTING: "var(--vivid-blue)", QUALIFIED: "var(--vivid-teal)", PROPOSAL: "var(--vivid-violet)", NEGOTIATION: "var(--vivid-orange)", WON: "var(--vivid-lime)", LOST: "var(--vivid-pink)" };

export function PipelineBoard({ columns, manage }: { columns: BoardColumn[]; manage: boolean }) {
  const router = useRouter();
  const [drag, setDrag] = useState<BoardDeal | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const drop = (stage: string) => {
    const d = drag; setDrag(null); setOver(null);
    if (!d || d.stage === stage || !manage) return;
    const lostReason = stage === "LOST" ? window.prompt("Why was it lost?") : null;
    if (stage === "LOST" && !lostReason) return;
    start(async () => { const r = await moveDealAction({ id: d.id, stage: stage as "WON", lostReason }); if (!r.ok) setError(r.error); else { setError(null); router.refresh(); } });
  };
  return (
    <>
      {error && <p className="mb-2 text-sm text-destructive" role="alert">{error}</p>}
      <div className={cn("-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3", pending && "opacity-70")} data-testid="pipeline">
        {columns.map((c) => (
          <section key={c.stage} data-testid={`stage-${c.stage}`} onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(c.stage); } }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); drop(c.stage); }}
            className={cn("glass-panel flex w-72 shrink-0 snap-start flex-col rounded-2xl border p-2 transition-all xl:w-auto xl:flex-1", over === c.stage && "drop-target")} style={{ ["--tone" as string]: TONE[c.stage] ?? "var(--vivid-blue)" }}>
            <header className="relative mb-2 overflow-hidden rounded-xl px-3 py-2.5">
              <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--tone),color-mix(in_oklch,var(--tone)_40%,var(--vivid-violet)))]" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{c.label}</span>
                <span className="grid min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold text-white" style={{ background: "var(--tone)" }}>{c.deals.length}</span>
              </div>
              <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">{c.total}{c.weighted ? ` · weighted ${c.weighted}` : ""}</div>
            </header>
            <ul className="flex min-h-24 flex-1 flex-col gap-2">
              {c.deals.map((d) => (
                <li key={d.id} draggable={manage} onDragStart={(e) => { setDrag(d); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDrag(null); setOver(null); }}
                  className={cn("group rounded-xl border bg-card/90 p-3 text-sm shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-16px_var(--tone)]", manage && "cursor-grab active:cursor-grabbing", drag?.id === d.id && "drag-ghost")} data-testid="deal-card">
                  <div className="flex items-start gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, var(--tone), color-mix(in oklch, var(--tone) 50%, var(--vivid-violet)))" }} title={d.owner}>{d.owner.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <Link className="block font-semibold leading-snug hover:underline" href={`/admin/crm/pipeline/${d.id}`}>{d.title}</Link>
                      <div className="truncate text-xs text-muted-foreground">{d.who} · {d.owner}</div>
                    </div>
                    {manage && <GripVertical className="size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden />}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="rounded-full bg-[color:color-mix(in_oklch,var(--tone)_14%,transparent)] px-2 py-0.5 font-semibold tabular-nums">{d.value}/month</span>
                    {d.close && <span className="inline-flex items-center gap-1 text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden />{d.close}</span>}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" title={`${d.probability}%`}><div className="h-full rounded-full" style={{ width: `${d.probability}%`, background: "var(--tone)" }} /></div>
                  {d.picker && <div className="mt-2">{d.picker}</div>}
                </li>
              ))}
              {!c.deals.length && <li className="grid flex-1 place-items-center rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">—</li>}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

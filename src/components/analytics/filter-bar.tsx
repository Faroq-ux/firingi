"use client";
/** One row of report filters above the charts. Changing a control reloads the page with new params. */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type FilterLabels = {
  period: string; presets: Record<string, string>; from: string; to: string;
  basis: string; placed: string; delivered: string; all: string; country?: string; type?: string; types?: Record<string, string>;
};

export function FilterBar({ labels, countries, showType, showBasis = true, defaultBasis = "placed", extra }: {
  labels: FilterLabels; countries?: { id: string; label: string }[]; showType?: boolean; showBasis?: boolean; defaultBasis?: "placed" | "delivered"; extra?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = React.useTransition();
  const period = sp.get("period") ?? "30d";
  const set = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    start(() => router.push(`${pathname}?${u.toString()}`));
  };
  const sel = "h-9 rounded-md border bg-card px-2 text-sm";
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3" data-testid="filter-bar" aria-busy={pending}>
      <label className="grid gap-1 text-xs text-muted-foreground">{labels.period}
        <select name="period" className={sel} value={period} onChange={(e) => set({ period: e.target.value, ...(e.target.value !== "custom" ? { from: null, to: null } : {}) })}>
          {Object.entries(labels.presets).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {period === "custom" && (
        <>
          <label className="grid gap-1 text-xs text-muted-foreground">{labels.from}
            <input type="date" name="from" className={sel} defaultValue={sp.get("from") ?? ""} onChange={(e) => e.target.value && set({ from: e.target.value })} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">{labels.to}
            <input type="date" name="to" className={sel} defaultValue={sp.get("to") ?? ""} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </label>
        </>
      )}
      {showBasis && (
        <label className="grid gap-1 text-xs text-muted-foreground">{labels.basis}
          <select name="basis" className={sel} value={sp.get("basis") ?? defaultBasis} onChange={(e) => set({ basis: e.target.value })}>
            <option value="placed">{labels.placed}</option>
            <option value="delivered">{labels.delivered}</option>
          </select>
        </label>
      )}
      {countries && countries.length > 1 && (
        <label className="grid gap-1 text-xs text-muted-foreground">{labels.country}
          <select name="country" className={sel} value={sp.get("country") ?? ""} onChange={(e) => set({ country: e.target.value || null })}>
            <option value="">{labels.all}</option>
            {countries.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      {showType && labels.types && (
        <label className="grid gap-1 text-xs text-muted-foreground">{labels.type}
          <select name="type" className={sel} value={sp.get("type") ?? ""} onChange={(e) => set({ type: e.target.value || null })}>
            <option value="">{labels.all}</option>
            {Object.entries(labels.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      )}
      {extra}
      {pending && <span className="pb-2 text-xs text-muted-foreground">…</span>}
    </div>
  );
}

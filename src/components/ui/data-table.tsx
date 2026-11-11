"use client";
/**
 * Smart table: quick search, per-column filters, sort, column chooser (show / hide / reorder),
 * density, saved views (per user, synced across devices), row selection with bulk actions, CSV
 * export of what is shown, sticky header. Cells are data (text, number, link, badge), so a server
 * page can build the rows; bulk actions are server actions.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Check, ChevronDown, Columns3, Download, Filter, Loader2, Rows3, Search, Star, Trash2, X } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { deleteViewAction, saveViewAction } from "@/server/actions/workspace";

export type Tone = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";
export type Cell = string | number | null | { t: string; v?: string | number | null; href?: string; tone?: Tone; mono?: boolean; sub?: string };
export type Column = { key: string; label: string; type?: "text" | "number" | "money" | "date" | "badge"; align?: "left" | "right"; hidden?: boolean; filter?: boolean };
export type Row = { id: string; href?: string; cells: Record<string, Cell> };
export type View = { id: string; name: string; state: unknown; isDefault: boolean };
export type BulkAction = { key: string; label: string; tone?: "default" | "destructive"; confirm?: string; action: (input: { ids: string[] }) => Promise<{ ok: boolean; error?: string; data?: unknown }> };
type State = { cols: string[]; sort: { key: string; dir: "asc" | "desc" } | null; q: string; filters: Record<string, string>; dense: boolean };

const text = (c: Cell) => (c == null ? "" : typeof c === "object" ? c.t : String(c));
const sortVal = (c: Cell) => (c == null ? null : typeof c === "object" ? (c.v ?? c.t) : c);
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const PAGE = 50;

export function DataTable({ tableId, columns, rows, views: initialViews = [], bulk = [], exportName, empty, testId }: {
  tableId: string; columns: Column[]; rows: Row[]; views?: View[]; bulk?: BulkAction[]; exportName?: string; empty?: string; testId?: string;
}) {
  const t = useTranslations("table");
  const router = useRouter();
  const base: State = { cols: columns.filter((c) => !c.hidden).map((c) => c.key), sort: null, q: "", filters: {}, dense: false };
  const def = initialViews.find((v) => v.isDefault);
  const [state, setState] = useState<State>(def ? { ...base, ...(def.state as Partial<State>) } : base);
  const [views, setViews] = useState<View[]>(initialViews);
  const [current, setCurrent] = useState<string | null>(def?.id ?? null);
  const [menu, setMenu] = useState<"cols" | "views" | null>(null);
  const [showFilters, setShowFilters] = useState(Object.keys(state.filters).length > 0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => setLimit(PAGE), [state.q, state.filters, state.sort]);
  useEffect(() => { const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("[data-dt-menu]")) setMenu(null); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);

  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const visible = state.cols.map((k) => byKey.get(k)).filter((c): c is Column => !!c);
  const shown = useMemo(() => {
    const q = fold(state.q.trim());
    let out = rows.filter((r) => (!q || columns.some((c) => fold(text(r.cells[c.key])).includes(q))) && Object.entries(state.filters).every(([k, f]) => !f || fold(text(r.cells[k])).includes(fold(f))));
    if (state.sort) {
      const { key, dir } = state.sort;
      out = [...out].sort((a, b) => {
        const x = sortVal(a.cells[key]), y = sortVal(b.cells[key]);
        if (x == null) return 1; if (y == null) return -1;
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
        return dir === "asc" ? r : -r;
      });
    }
    return out;
  }, [rows, columns, state.q, state.filters, state.sort]);
  const set = (p: Partial<State>) => setState((s) => ({ ...s, ...p }));
  const toggleSort = (key: string) => set({ sort: state.sort?.key !== key ? { key, dir: "asc" } : state.sort.dir === "asc" ? { key, dir: "desc" } : null });
  const allChecked = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const choosable = bulk.length > 0;

  const exportCsv = () => {
    const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [visible.map((c) => esc(c.label)).join(";"), ...shown.map((r) => visible.map((c) => esc(text(r.cells[c.key]))).join(";"))];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${exportName ?? tableId}-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const saveCurrent = (isDefault?: boolean) => {
    const name = window.prompt(t("viewName"), views.find((v) => v.id === current)?.name ?? "");
    if (!name?.trim()) return;
    start(async () => {
      const r = await saveViewAction({ tableId, name, state, isDefault });
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setViews((vs) => [...vs.filter((v) => v.name !== r.data.name).map((v) => (isDefault ? { ...v, isDefault: false } : v)), r.data].sort((a, b) => a.name.localeCompare(b.name)));
      setCurrent(r.data.id); setMenu(null); setMsg({ ok: true, text: t("saved") });
    });
  };
  const runBulk = (b: BulkAction) => {
    if (b.confirm && !window.confirm(b.confirm)) return;
    start(async () => {
      const r = await b.action({ ids: [...selected] });
      setMsg(r.ok ? { ok: true, text: t("bulkDone", { count: selected.size }) } : { ok: false, text: r.error ?? "Error" });
      if (r.ok) { setSelected(new Set()); router.refresh(); }
    });
  };

  const cellView = (c: Column, v: Cell, row: Row, first: boolean) => {
    const o = typeof v === "object" && v ? v : null;
    const body = o?.tone ? <Badge variant={o.tone}>{o.t}</Badge> : <span className={cn(o?.mono && "font-mono text-xs", c.type === "money" || c.type === "number" ? "tabular-nums" : "")}>{text(v) || "—"}</span>;
    const href = o?.href ?? (first ? row.href : undefined);
    return (
      <>
        {href ? <Link href={href} className={cn("font-medium hover:underline", first && "text-[color:color-mix(in_oklch,var(--vivid-blue)_80%,var(--foreground))]")}>{body}</Link> : body}
        {o?.sub && <span className="block text-xs text-muted-foreground">{o.sub}</span>}
      </>
    );
  };

  return (
    <div className="space-y-3" data-testid={testId ?? `dt-${tableId}`}>
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={state.q} onChange={(e) => set({ q: e.target.value })} placeholder={t("search")} aria-label={t("search")} data-testid="dt-search"
            className="h-10 w-full rounded-xl border border-[color:var(--glass-border)] bg-[var(--glass-strong)] pl-9 pr-3 text-sm shadow-xs outline-none backdrop-blur focus-visible:border-[color:color-mix(in_oklch,var(--vivid-violet)_45%,var(--border))]" />
        </label>
        <div className="relative" data-dt-menu>
          <Button variant="outline" size="sm" className="h-10" onClick={() => setMenu(menu === "views" ? null : "views")} aria-expanded={menu === "views"} data-testid="dt-views">
            <Bookmark className="size-4" />{views.find((v) => v.id === current)?.name ?? t("allRows")}<ChevronDown className="size-3.5" />
          </Button>
          {menu === "views" && (
            <div className="popover-glass animate-fade absolute right-0 z-30 mt-2 w-64 rounded-xl p-1.5 sm:left-0 sm:right-auto">
              <button className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent", !current && "font-semibold")} onClick={() => { setState(base); setCurrent(null); setMenu(null); }}>{!current ? <Check className="size-4" /> : <span className="size-4" />}{t("allRows")}</button>
              {views.map((v) => (
                <div key={v.id} className="group flex items-center gap-1 rounded-lg hover:bg-accent">
                  <button className={cn("flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm", current === v.id && "font-semibold")} onClick={() => { setState({ ...base, ...(v.state as Partial<State>) }); setCurrent(v.id); setMenu(null); setShowFilters(Object.keys((v.state as State).filters ?? {}).length > 0); }}>
                    {current === v.id ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}<span className="truncate">{v.name}</span>{v.isDefault && <Star className="size-3.5 shrink-0 fill-current text-[var(--vivid-orange)]" aria-label={t("default")} />}
                  </button>
                  <button className="p-2 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100" aria-label={t("deleteView")} onClick={() => start(async () => { await deleteViewAction({ id: v.id }); setViews((vs) => vs.filter((x) => x.id !== v.id)); if (current === v.id) { setCurrent(null); setState(base); } })}><Trash2 className="size-3.5" /></button>
                </div>
              ))}
              <div className="my-1 h-px bg-border" />
              <button className="w-full rounded-lg px-2.5 py-2 text-left text-sm font-medium text-primary hover:bg-accent" onClick={() => saveCurrent()} data-testid="dt-save-view">+ {t("saveView")}</button>
              <button className="w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent" onClick={() => saveCurrent(true)}>{t("saveDefault")}</button>
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" className={cn("h-10", showFilters && "border-primary text-primary")} onClick={() => setShowFilters((v) => !v)} aria-pressed={showFilters} data-testid="dt-filters"><Filter className="size-4" /><span className="hidden sm:inline">{t("filters")}</span>{Object.values(state.filters).filter(Boolean).length > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{Object.values(state.filters).filter(Boolean).length}</span>}</Button>
        <div className="relative" data-dt-menu>
          <Button variant="outline" size="sm" className="h-10" onClick={() => setMenu(menu === "cols" ? null : "cols")} aria-expanded={menu === "cols"} data-testid="dt-columns"><Columns3 className="size-4" /><span className="hidden sm:inline">{t("columns")}</span></Button>
          {menu === "cols" && (
            <div className="popover-glass animate-fade absolute right-0 z-30 mt-2 w-60 rounded-xl p-1.5">
              {[...state.cols, ...columns.map((c) => c.key).filter((k) => !state.cols.includes(k))].map((k, i) => {
                const c = byKey.get(k)!, on = state.cols.includes(k);
                return (
                  <div key={k} className="flex items-center gap-1 rounded-lg px-1.5 hover:bg-accent">
                    <label className="flex flex-1 cursor-pointer items-center gap-2 py-1.5 text-sm"><input type="checkbox" className="size-4" checked={on} onChange={() => set({ cols: on ? state.cols.filter((x) => x !== k) : [...state.cols, k] })} data-testid={`dt-col-${k}`} />{c.label}</label>
                    {on && <><button className="p-1 text-muted-foreground disabled:opacity-30" disabled={i === 0} aria-label="↑" onClick={() => { const a = [...state.cols]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set({ cols: a }); }}><ArrowUp className="size-3.5" /></button>
                      <button className="p-1 text-muted-foreground disabled:opacity-30" disabled={i === state.cols.length - 1} aria-label="↓" onClick={() => { const a = [...state.cols]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set({ cols: a }); }}><ArrowDown className="size-3.5" /></button></>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" className="h-10" onClick={() => set({ dense: !state.dense })} aria-pressed={state.dense} title={t("compact")} aria-label={t("compact")}><Rows3 className="size-4" /></Button>
        <Button variant="outline" size="sm" className="h-10" onClick={exportCsv} data-testid="dt-export"><Download className="size-4" /><span className="hidden sm:inline">CSV</span></Button>
      </div>

      {showFilters && (
        <div className="animate-fade flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-3">
          {columns.filter((c) => c.filter !== false && c.type !== "money" && c.type !== "number").map((c) => {
            const options = c.type === "badge" ? [...new Set(rows.map((r) => text(r.cells[c.key])).filter(Boolean))].sort() : null;
            return (
              <label key={c.key} className="grid gap-1 text-xs text-muted-foreground">{c.label}
                {options ? (
                  <select className="h-9 min-w-36 rounded-lg border bg-card px-2 text-sm text-foreground" value={state.filters[c.key] ?? ""} onChange={(e) => set({ filters: { ...state.filters, [c.key]: e.target.value } })} data-testid={`dt-filter-${c.key}`}>
                    <option value="">—</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : <input className="h-9 w-40 rounded-lg border bg-card px-2 text-sm text-foreground" value={state.filters[c.key] ?? ""} onChange={(e) => set({ filters: { ...state.filters, [c.key]: e.target.value } })} data-testid={`dt-filter-${c.key}`} />}
              </label>
            );
          })}
          <Button variant="ghost" size="sm" onClick={() => set({ filters: {}, q: "" })}><X className="size-4" />{t("reset")}</Button>
        </div>
      )}

      {choosable && selected.size > 0 && (
        <div className="nav-active animate-fade sticky top-20 z-10 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm" data-testid="dt-bulkbar">
          <b>{t("selected", { count: selected.size })}</b>
          {bulk.map((b) => <Button key={b.key} size="sm" variant={b.tone === "destructive" ? "destructive" : "secondary"} disabled={pending} onClick={() => runBulk(b)} data-testid={`dt-bulk-${b.key}`}>{pending && <Loader2 className="size-4 animate-spin" />}{b.label}</Button>)}
          <button className="ml-auto text-white/80 hover:text-white" onClick={() => setSelected(new Set())}>{t("clear")}</button>
        </div>
      )}
      {msg && <p className={cn("text-sm", msg.ok ? "text-success" : "text-destructive")} role="status">{msg.text}</p>}

      <div className="glass-panel max-h-[72vh] overflow-auto rounded-2xl border">
        <table className="ft-stack w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--glass-strong)] backdrop-blur-xl [&_tr]:border-b">
            <tr>
              {visible.map((c, i) => (
                <th key={c.key} className={cn("h-11 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:color-mix(in_oklch,var(--vivid-violet)_60%,var(--foreground))]", c.align === "right" || c.type === "money" || c.type === "number" ? "text-right" : "text-left")}>
                  <span className="inline-flex items-center gap-2">
                    {i === 0 && choosable && <input type="checkbox" className="size-4" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((r) => r.id)))} aria-label={t("selectAll")} data-testid="dt-select-all" />}
                    <button className="inline-flex items-center gap-1 uppercase hover:text-foreground" onClick={() => toggleSort(c.key)} data-testid={`dt-sort-${c.key}`}>
                      {c.label}{state.sort?.key === c.key ? (state.sort.dir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ArrowUpDown className="size-3 opacity-40" />}
                    </button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={r.id} className={cn("border-b border-[color:color-mix(in_oklch,var(--border)_60%,transparent)] transition-colors hover:bg-[color-mix(in_oklch,var(--vivid-blue)_7%,transparent)]", selected.has(r.id) && "bg-[color-mix(in_oklch,var(--vivid-violet)_10%,transparent)]")} data-testid="dt-row">
                {visible.map((c, i) => (
                  <td key={c.key} data-label={c.label} className={cn("px-3 align-middle", state.dense ? "py-1.5" : "py-3", c.align === "right" || c.type === "money" || c.type === "number" ? "text-right" : "")}>
                    {i === 0 && choosable ? (
                      <span className="inline-flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4" checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} aria-label={text(r.cells[c.key])} data-testid="dt-select" /><span>{cellView(c, r.cells[c.key], r, true)}</span></span>
                    ) : cellView(c, r.cells[c.key], r, i === 0)}
                  </td>
                ))}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={visible.length} className="px-3 py-12 text-center text-sm text-muted-foreground">{rows.length ? t("noMatch") : (empty ?? t("empty"))}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span data-testid="dt-count">{t("rows", { shown: Math.min(limit, shown.length), total: shown.length })}</span>
        {shown.length > limit && <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>{t("showMore")}</Button>}
      </div>
    </div>
  );
}

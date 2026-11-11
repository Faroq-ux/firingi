"use client";
/**
 * Every plain table becomes a smart one: when it has more than a handful of rows a slim toolbar
 * appears — quick filter, show / hide columns (remembered per person, per page), compact rows,
 * CSV export of what is shown, row count. It works on the rendered table (hides rows / columns,
 * never moves them), so server pages keep their markup, forms and buttons.
 */
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Columns3, Download, Rows3, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPreferenceAction, setPreferenceAction } from "@/server/actions/workspace";

const MIN_ROWS = 6;
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function TableShell({ children, prefKey }: { children: React.ReactNode; prefKey?: string }) {
  const t = useTranslations("table");
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  const scope = `ts-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [rows, setRows] = useState(0);
  const [heads, setHeads] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [dense, setDense] = useState(false);
  const [menu, setMenu] = useState(false);
  const [shown, setShown] = useState(0);
  const key = prefKey ?? `table${pathname.replace(/[^a-z0-9-]+/gi, ".").replace(/\.$/, "").toLowerCase()}.${index}`;

  // Which table of the page this is (the saved column choice is per page and table).
  useEffect(() => { setIndex(Math.max(0, [...document.querySelectorAll("[data-ts]")].findIndex((el) => el.getAttribute("data-ts") === scope))); }, [scope]);
  // Load this person's hidden columns for this table, once the table is big enough to be smart.
  useEffect(() => {
    if (rows < MIN_ROWS) return;
    let off = false;
    void getPreferenceAction({ key }).then((r) => { if (!off && r.ok && Array.isArray(r.data)) setHidden((r.data as unknown[]).filter((x): x is number => typeof x === "number")); }).catch(() => null);
    return () => { off = true; };
  }, [key, rows >= MIN_ROWS]); // eslint-disable-line react-hooks/exhaustive-deps
  // Read the table once it is rendered (and again when the server re-renders it).
  useEffect(() => {
    const table = box.current?.querySelector("table");
    if (!table) return;
    const read = () => {
      const body = [...table.querySelectorAll(":scope > tbody > tr")].filter((r) => !r.querySelector("td[colspan]"));
      setRows(body.length);
      setHeads([...table.querySelectorAll(":scope > thead > tr > th")].map((th) => th.textContent?.trim() || "·"));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(table, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  // Filter rows (display only — React keeps owning the nodes).
  useEffect(() => {
    const table = box.current?.querySelector("table");
    if (!table) return;
    const f = fold(q.trim());
    let n = 0;
    for (const r of table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr")) {
      const ok = !f || fold(r.textContent ?? "").includes(f);
      r.style.display = ok ? "" : "none";
      if (ok) n++;
    }
    setShown(n);
  }, [q, rows]);
  useEffect(() => { const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(`[data-ts="${scope}"]`)) setMenu(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, [scope]);

  const toggleCol = (i: number) => {
    const next = hidden.includes(i) ? hidden.filter((x) => x !== i) : [...hidden, i];
    setHidden(next);
    void setPreferenceAction({ key, value: next.length ? next : null }).catch(() => null);
  };
  const exportCsv = () => {
    const table = box.current?.querySelector("table");
    if (!table) return;
    const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const cols = heads.map((_, i) => i).filter((i) => !hidden.includes(i));
    const line = (cells: Element[]) => cols.map((i) => esc((cells[i]?.textContent ?? "").replace(/\s+/g, " ").trim())).join(";");
    const out = [line([...table.querySelectorAll(":scope > thead > tr > th")])];
    for (const r of table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr")) if (r.style.display !== "none" && !r.querySelector("td[colspan]")) out.push(line([...r.children]));
    const url = URL.createObjectURL(new Blob([`﻿${out.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `${key.replace(/^table\./, "").replace(/\./g, "-") || "table"}-${new Date().toISOString().slice(0, 10)}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const smart = rows >= MIN_ROWS;
  const css = hidden.map((i) => `[data-ts-box="${scope}"] table > * > tr > :nth-child(${i + 1}){display:none}`).join("") + (dense ? `[data-ts-box="${scope}"] td{padding-top:.35rem;padding-bottom:.35rem}` : "");
  return (
    <div className="w-full space-y-2" data-ts={scope}>
      {smart && (
        <div className="flex flex-wrap items-center gap-2" data-testid="ts-toolbar">
          <label className="relative min-w-0 flex-1 basis-48 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} data-testid="ts-search"
              className="h-9 w-full rounded-xl border border-[color:var(--glass-border)] bg-[var(--glass-strong)] pl-9 pr-3 text-sm shadow-xs outline-none backdrop-blur" />
          </label>
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--glass-border)] bg-[var(--glass-strong)] px-3 text-sm hover:bg-accent" data-testid="ts-columns"><Columns3 className="size-4" aria-hidden /><span className="hidden sm:inline">{t("columns")}</span></button>
            {menu && (
              <div className="popover-glass animate-fade absolute left-0 z-30 mt-2 w-56 rounded-xl p-1.5">
                {heads.map((h, i) => <label key={i} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent"><input type="checkbox" className="size-4" checked={!hidden.includes(i)} onChange={() => toggleCol(i)} />{h}</label>)}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setDense((d) => !d)} aria-pressed={dense} title={t("compact")} aria-label={t("compact")} className={cn("inline-flex h-9 items-center rounded-xl border border-[color:var(--glass-border)] bg-[var(--glass-strong)] px-2.5 hover:bg-accent", dense && "border-primary text-primary")}><Rows3 className="size-4" aria-hidden /></button>
          <button type="button" onClick={exportCsv} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--glass-border)] bg-[var(--glass-strong)] px-3 text-sm hover:bg-accent" data-testid="ts-export"><Download className="size-4" aria-hidden />CSV</button>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground" data-testid="ts-count">{t("rows", { shown, total: rows })}</span>
        </div>
      )}
      {css && <style>{css}</style>}
      <div ref={box} data-ts-box={scope} className="glass-panel w-full overflow-x-auto rounded-2xl border">{children}</div>
    </div>
  );
}

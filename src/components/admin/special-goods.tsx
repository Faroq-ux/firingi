"use client";
/** Phase 47e — FIRINGI: special goods rules (activity codes per kind / category) and per-company exceptions. */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Msg, useRun } from "@/components/shared/run";
import { saveSpecialSettingsAction, setSpecialExceptionAction } from "@/server/actions/admin-review";
import type { SpecialRule, SpecialSettings } from "@/lib/special-access";

const KIND = { TOBACCO: "Tobacco", ALCOHOL: "Alcoholic drinks", VAPING: "Vaping / e-cigarettes" } as Record<string, string>;
const REASON = { OK: "matches", EXCEPTION: "exception by FIRINGI", NOT_DECLARED: "not declared as sold", NO_CODE: "no activity code", CODE: "no matching activity code", OFF: "rules off" } as Record<string, string>;

export function SpecialSettingsForm({ initial, categories }: { initial: SpecialSettings; categories: { id: string; name: string; depth: number }[] }) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState(initial);
  const [newCat, setNewCat] = useState("");
  const setRule = (i: number, r: Partial<SpecialRule>) => setX({ ...x, rules: x.rules.map((y, j) => (j === i ? { ...y, ...r } : y)) });
  const catName = (t: string) => categories.find((c) => `cat:${c.id}` === t)?.name ?? t;
  return (
    <form className="space-y-4 text-sm" data-testid="special-settings" onSubmit={(e) => { e.preventDefault(); run(() => saveSpecialSettingsAction(x), undefined, "Saved"); }}>
      <div className="space-y-1.5">
        <label className="flex items-center gap-2"><input type="checkbox" checked={x.enabled} onChange={(e) => setX({ ...x, enabled: e.target.checked })} data-testid="ss-enabled" /> Special goods need a matching activity code (CAE / NACE)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={x.askDeclaration} onChange={(e) => setX({ ...x, askDeclaration: e.target.checked })} /> Only for businesses that said they sell them (asked at registration)</label>
        <label className="flex items-center gap-2">Businesses without any activity code:
          <select className="h-8 rounded-md border bg-background px-2" value={x.noCode} onChange={(e) => setX({ ...x, noCode: e.target.value as "ALLOW" | "BLOCK" })} data-testid="ss-nocode"><option value="ALLOW">keep access (older accounts)</option><option value="BLOCK">no access</option></select></label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]" data-testid="special-rules">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground [&>th]:pr-3"><th className="py-2">Goods</th><th>Allowed activity codes (prefixes, e.g. 4726, 5630)</th><th>Countries (empty = all)</th><th>If no match</th><th>On</th><th /></tr></thead>
          <tbody>
            {x.rules.map((r, i) => (
              <tr key={r.id + i} className="border-b align-top" data-testid="special-rule">
                <td className="py-2 pr-3 font-medium">{r.target.startsWith("cat:") ? <>Category: {catName(r.target)}</> : KIND[r.target] ?? r.target}</td>
                <td className="pr-3"><Input className="h-8" value={r.codes.join(", ")} onChange={(e) => setRule(i, { codes: e.target.value.split(/[,\s]+/).filter(Boolean) })} data-testid={`ss-codes-${r.target}`} /></td>
                <td className="pr-3"><Input className="h-8 w-32" value={r.countries.join(", ")} placeholder="PT, ES" onChange={(e) => setRule(i, { countries: e.target.value.toUpperCase().split(/[,\s]+/).filter(Boolean) })} /></td>
                <td className="pr-3"><select className="h-8 rounded-md border bg-background px-2" value={r.mode} onChange={(e) => setRule(i, { mode: e.target.value as "BLOCK" | "WARN" })}><option value="BLOCK">block</option><option value="WARN">warn only</option></select></td>
                <td className="pr-3"><input type="checkbox" checked={r.active} onChange={(e) => setRule(i, { active: e.target.checked })} /></td>
                <td>{r.target.startsWith("cat:") && <Button type="button" size="sm" variant="ghost" onClick={() => setX({ ...x, rules: x.rules.filter((_, j) => j !== i) })}>Remove</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 max-w-xs rounded-md border bg-background px-2" value={newCat} onChange={(e) => setNewCat(e.target.value)} data-testid="ss-newcat">
          <option value="">Add special items: choose a catalogue category…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>)}
        </select>
        <Button type="button" variant="outline" size="sm" disabled={!newCat || x.rules.some((r) => r.target === `cat:${newCat}`)} onClick={() => { setX({ ...x, rules: [...x.rules, { id: `cat-${newCat}`.slice(0, 40), target: `cat:${newCat}`, label: catName(`cat:${newCat}`), codes: [], countries: [], mode: "BLOCK", active: true }] }); setNewCat(""); }} data-testid="ss-addcat">Add rule</Button>
      </div>
      <div className="flex items-center gap-3"><Button type="submit" size="sm" disabled={pending} data-testid="ss-save">Save</Button><Msg error={error} done={done} /></div>
    </form>
  );
}

export function SpecialCompanyCard({ companyId, rows, codes, declared, sells }: { companyId: string; codes: string[]; declared: boolean; sells: string[]; rows: { target: string; label: string; category: string | null; open: boolean; warn: boolean; reason: string; exception: { note: string } | null }[] }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2 text-sm" data-testid="special-company">
      <p className="text-xs text-muted-foreground">Activity codes: {codes.length ? codes.join(", ") : "none"} · sells: {declared ? (sells.length ? sells.map((s) => KIND[s] ?? s).join(", ") : "none of them") : "not asked (older account)"}</p>
      <ul className="divide-y rounded-lg border">
        {rows.map((r) => (
          <li key={r.target} className="flex flex-wrap items-center gap-2 p-2" data-testid={`special-company-${r.target}`}>
            <span className="min-w-0 flex-1">{r.target.startsWith("cat:") ? `Category: ${r.category ?? r.label}` : KIND[r.target] ?? r.target} <span className="text-xs text-muted-foreground">— {REASON[r.reason] ?? r.reason}{r.exception ? `: ${r.exception.note}` : ""}</span></span>
            {r.open ? <Badge variant={r.warn ? "warning" : "success"}>{r.warn ? "allowed (warning)" : "allowed"}</Badge> : <Badge variant="destructive">closed</Badge>}
            {r.exception
              ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setSpecialExceptionAction({ companyId, target: r.target, on: false }))}>Remove exception</Button>
              : !r.open && <Button size="sm" variant="outline" disabled={pending || note.trim().length < 5} onClick={() => run(() => setSpecialExceptionAction({ companyId, target: r.target, on: true, note }))} data-testid={`special-allow-${r.target}`}>Allow anyway</Button>}
          </li>
        ))}
      </ul>
      <Input className="h-8" placeholder="Reason for an exception (e.g. licence shown, code being updated at the tax office)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="special-note" />
      <Msg error={error} />
    </div>
  );
}

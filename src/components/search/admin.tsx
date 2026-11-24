"use client";
/** Phase 72: FIRINGI's smart-search switches and synonym list (English). */
import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import { deleteSynonymAction, saveSearchSettingsAction, saveSynonymAction } from "@/server/actions/search";
import type { SearchSettings } from "@/lib/search";

const SWITCHES: { key: keyof Omit<SearchSettings, "typo">; label: string; hint: string }[] = [
  { key: "fuzzy", label: "Typo-tolerant matching", hint: "Finds “mozarela” for mozzarella and ignores accents (água = agua). Off: the text must appear exactly." },
  { key: "ai", label: "AI reads the search", hint: "Understands sentences (“gluten-free mozzarella under 8 €”), corrects spelling and adds the product’s names in other languages. One AI call per new search; the answer is kept 30 days." },
  { key: "synonyms", label: "Synonyms", hint: "Your list below plus the words the AI learnt — used for every search, also without AI." },
  { key: "filters", label: "Filters and sorting on the search page", hint: "Category, supplier, maximum price, deals, allergens & diets, rating, sort order. Also lets the AI’s filters apply." },
];
const TYPO = [{ v: 0.35, l: "Loose (more typos accepted)" }, { v: 0.5, l: "Normal" }, { v: 0.65, l: "Strict" }];

export function SearchSettingsForm({ initial, aiConfigured }: { initial: SearchSettings; aiConfigured: boolean }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  return (
    <div className="space-y-4" data-testid="search-settings">
      {SWITCHES.map((w) => (
        <label key={w.key} className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={s[w.key]} onChange={(e) => setS({ ...s, [w.key]: e.target.checked })} data-testid={`ss-${w.key}`} />
          <span><span className="font-medium">{w.label}</span>{w.key === "ai" && !aiConfigured && <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-xs">No AI connected — searches run on words and synonyms</span>}<span className="block text-muted-foreground">{w.hint}</span></span>
        </label>
      ))}
      <div className="max-w-xs space-y-1">
        <Label htmlFor="ss-typo">How close a misspelt word must be</Label>
        <Select id="ss-typo" value={String(TYPO.reduce((a, b) => (Math.abs(b.v - s.typo) < Math.abs(a.v - s.typo) ? b : a)).v)} onChange={(e) => setS({ ...s, typo: Number(e.target.value) })} disabled={!s.fuzzy} data-testid="ss-typo">
          {TYPO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={() => run(() => saveSearchSettingsAction(s), undefined, "Saved.")} data-testid="ss-save"><Spin on={pending} icon={Check} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

type Row = { id: string; term: string; alternatives: string[]; source: string; hidden: boolean; uses: number };

function SynonymEditor({ row, onClose }: { row?: Row; onClose?: () => void }) {
  const { pending, error, run } = useRun();
  const [term, setTerm] = useState(row?.term ?? "");
  const [alts, setAlts] = useState(row?.alternatives.join(", ") ?? "");
  const [hidden, setHidden] = useState(row?.hidden ?? false);
  const save = () => run(() => saveSynonymAction({ id: row?.id ?? null, term, alternatives: alts.split(","), hidden }), () => { if (!row) { setTerm(""); setAlts(""); } onClose?.(); });
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid={row ? "syn-edit" : "syn-new"}>
      <div className="space-y-1"><Label>Word</Label><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="tomato" className="w-40" data-testid="syn-term" /></div>
      <div className="min-w-56 flex-1 space-y-1"><Label>Means the same (comma-separated)</Label><Input value={alts} onChange={(e) => setAlts(e.target.value)} placeholder="tomate, pomodoro, tomaten" data-testid="syn-alts" /></div>
      {row && <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} data-testid="syn-hidden" /> Not used</label>}
      <Button disabled={pending} onClick={save} data-testid="syn-save"><Spin on={pending} icon={row ? Check : Plus} /> {row ? "Save" : "Add"}</Button>
      {onClose && <Button variant="ghost" onClick={onClose} aria-label="Cancel"><X className="size-4" /></Button>}
      <Msg error={error} />
    </div>
  );
}

export function SynonymList({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const { pending, error, run } = useRun();
  return (
    <div className="space-y-4">
      {canManage && <SynonymEditor />}
      <Msg error={error} />
      <ul className="divide-y" data-testid="syn-list">
        {rows.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">No synonyms yet. Add your own, or switch the AI on — it adds the words it learns from searches.</li>}
        {rows.map((r) => (
          <li key={r.id} className="py-2 text-sm" data-testid="syn-row" data-term={r.term}>
            {editing === r.id ? <SynonymEditor row={r} onClose={() => setEditing(null)} /> : (
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-medium ${r.hidden ? "line-through opacity-60" : ""}`}>{r.term}</span>
                <span className="text-muted-foreground">→ {r.alternatives.join(", ")}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${r.source === "ADMIN" ? "bg-primary/10 text-primary" : "bg-muted"}`}>{r.source === "ADMIN" ? "FIRINGI" : "AI"}</span>
                <span className="text-xs text-muted-foreground">used {r.uses}×</span>
                {canManage && <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r.id)} title="Edit" data-testid="syn-edit-btn"><Pencil className="size-4" /></Button>
                  <Button size="sm" variant="ghost" disabled={pending} title="Delete" onClick={() => { if (window.confirm(`Delete “${r.term}”?`)) run(() => deleteSynonymAction({ id: r.id })); }} data-testid="syn-delete"><Trash2 className="size-4" /></Button>
                </span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

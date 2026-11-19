"use client";
/** Food information (Phase 44) — interactive parts. Supplier / customer texts come in as `l`; FIRINGI admin parts are in English. */
import { useMemo, useState } from "react";
import { Check, FileUp, Plus, Save, Send, ShieldCheck, ShieldX, Sparkles, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  addFoodCertificateAction, allergenRecallAction, importFoodAction, readLabelAction, removeFoodCertificateAction, reviewFoodAction, saveFoodDraftAction,
  saveFoodProfileAction, saveFoodRequirementsAction, saveFoodSettingsAction, submitFoodAction, uploadFoodFileAction, withdrawFoodAction,
} from "@/server/actions/food";
import { ALLERGENS, DIETS, FIELDS, missingFields, NUTRIENTS, problems, type FoodData, type FoodSettings, type Level } from "@/lib/food";

export type L = Record<string, string>;
const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`w-full rounded-lg border border-input bg-card/80 px-3 py-2 text-sm disabled:opacity-60 ${p.className ?? ""}`} />;
const f = (s: string | undefined, v: Record<string, string | number> = {}) => (s ?? "").replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`));
const str = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const num = (v: string) => { const t = v.trim().replace(",", "."); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
const LANGS = ["pt", "en", "es", "fr", "de", "it", "nl", "pl", "ro", "cs", "sk", "hu", "hr", "sl", "bg", "el", "da", "sv", "fi", "et", "lv", "lt", "mt", "nb", "is"];

// ── supplier: the editor ────────────────────────────────────────────────────

export function FoodEditor({ l, productId, data, required, parts, editable, pending, aiOn }: {
  l: L; productId: string; data: FoodData | null; required: string[]; parts: FoodSettings["parts"]; editable: boolean; pending: boolean; aiOn: boolean;
}) {
  const { pending: busy, error, done, run } = useRun();
  const [al, setAl] = useState<Record<string, Level | "">>(() => Object.fromEntries(ALLERGENS.map((a) => [a, data?.allergens[a] ?? ""])));
  const [detail, setDetail] = useState<Record<string, string>>(() => ({ ...(data?.allergenDetail ?? {}) }) as Record<string, string>);
  const initialLangs = [...new Set([...Object.keys(data?.ingredients ?? {}), ...Object.keys(data?.storage ?? {})])];
  const [langs, setLangs] = useState<string[]>(initialLangs.length ? initialLangs : ["pt"]);
  const [ing, setIng] = useState<Record<string, string>>(() => ({ ...(data?.ingredients ?? {}) }));
  const [sto, setSto] = useState<Record<string, string>>(() => ({ ...(data?.storage ?? {}) }));
  const [basis, setBasis] = useState<"100g" | "100ml">(data?.nutrition?.basis ?? "100g");
  const [nut, setNut] = useState<Record<string, string>>(() => Object.fromEntries(NUTRIENTS.map((n) => [n, str(data?.nutrition?.[n] ?? null)])));
  const [diets, setDiets] = useState<string[]>(data?.diets ?? []);
  const [origin, setOrigin] = useState(data?.originCountryCode ?? "");
  const [shelf, setShelf] = useState(str(data?.shelfLifeDays ?? null));
  const [opened, setOpened] = useState(str(data?.afterOpeningDays ?? null));
  const [addLang, setAddLang] = useState("");

  const payload = () => ({
    allergens: Object.fromEntries(ALLERGENS.map((a) => [a, al[a] || null])) as Record<(typeof ALLERGENS)[number], Level | null>,
    allergenDetail: detail,
    ingredients: ing, storage: sto,
    nutrition: NUTRIENTS.some((n) => nut[n]?.trim()) ? { basis, ...Object.fromEntries(NUTRIENTS.map((n) => [n, nut[n]?.trim() ? nut[n].replace(",", ".") : null])) } as never : null,
    diets: diets as (typeof DIETS)[number][], originCountryCode: origin.trim().toUpperCase() || null, shelfLifeDays: shelf || null, afterOpeningDays: opened || null,
  });
  const live: FoodData = useMemo(() => ({
    allergens: Object.fromEntries(ALLERGENS.filter((a) => al[a]).map((a) => [a, al[a]])) as FoodData["allergens"],
    ingredients: ing, storage: sto, diets, originCountryCode: origin.trim().toUpperCase() || null,
    nutrition: NUTRIENTS.some((n) => nut[n]?.trim()) ? { basis, ...Object.fromEntries(NUTRIENTS.filter((n) => nut[n]?.trim()).map((n) => [n, num(nut[n])])) } as FoodData["nutrition"] : null,
    shelfLifeDays: shelf ? Number(shelf) : null, afterOpeningDays: opened ? Number(opened) : null, hasLabel: !!data?.hasLabel, certificates: data?.certificates,
  }), [al, ing, sto, diets, origin, nut, basis, shelf, opened, data]);
  const issues = problems(live).filter((p) => l[`p.${p.code}`]);
  const missing = missingFields(live, required as never);
  const fieldsText = (fs: string[]) => fs.map((x) => l[`field.${x}`] ?? x).join(", ");
  const disabled = !editable || pending;
  const setAll = (lv: Level) => setAl(Object.fromEntries(ALLERGENS.map((a) => [a, al[a] || lv])));

  return (
    <div className="space-y-6" data-testid="food-editor">
      {parts.allergens && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{l.allergens}</h3>
            {!disabled && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAll("FREE")} data-testid="food-rest-free">{l["level.FREE"]} → {l.notStated.toLowerCase()}</button>}
          </div>
          <p className="text-xs text-muted-foreground">{l.allergensHint}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ALLERGENS.map((a) => (
              <div key={a} className="flex flex-wrap items-center gap-2 rounded-lg border p-2" data-testid="food-allergen-row" data-allergen={a}>
                <span className="min-w-0 flex-1 basis-28 text-sm font-medium">{l[`a.${a}`]}</span>
                <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={l[`a.${a}`]}>
                  {(["CONTAINS", "MAY_CONTAIN", "FREE"] as Level[]).map((lv) => (
                    <button key={lv} type="button" disabled={disabled} role="radio" aria-checked={al[a] === lv} onClick={() => setAl({ ...al, [a]: al[a] === lv ? "" : lv })} data-testid={`al-${a}-${lv}`}
                      className={`rounded-md border px-2 py-1 text-xs transition ${al[a] === lv ? (lv === "CONTAINS" ? "border-destructive bg-destructive text-white" : lv === "MAY_CONTAIN" ? "border-amber-500 bg-amber-500 text-white" : "border-primary bg-primary text-primary-foreground") : "hover:bg-muted"}`}>
                      {l[`level.${lv}`]}
                    </button>
                  ))}
                </div>
                {(al[a] === "CONTAINS" || al[a] === "MAY_CONTAIN") && (a === "GLUTEN" || a === "NUTS" || a === "FISH" || a === "CRUSTACEANS" || a === "MOLLUSCS") && (
                  <Input className="h-8 w-full" placeholder={l.detailPh} value={detail[a] ?? ""} disabled={disabled} onChange={(e) => setDetail({ ...detail, [a]: e.target.value })} aria-label={`${l[`a.${a}`]} — ${l.detailPh}`} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {(parts.ingredients || true) && (
        <section className="space-y-2">
          <h3 className="font-semibold">{parts.ingredients ? l.ingredients : l.storage}</h3>
          {parts.ingredients && <p className="text-xs text-muted-foreground">{l.ingredientsHint}</p>}
          {langs.map((lg) => (
            <div key={lg} className="space-y-1 rounded-lg border p-2">
              <p className="text-xs font-medium uppercase text-muted-foreground">{lg}</p>
              {parts.ingredients && <Textarea rows={3} value={ing[lg] ?? ""} disabled={disabled} onChange={(e) => setIng({ ...ing, [lg]: e.target.value })} aria-label={`${l.ingredients} (${lg})`} data-testid={`food-ing-${lg}`} />}
              <Input value={sto[lg] ?? ""} disabled={disabled} placeholder={l.storage} onChange={(e) => setSto({ ...sto, [lg]: e.target.value })} aria-label={`${l.storage} (${lg})`} data-testid={`food-storage-${lg}`} />
            </div>
          ))}
          {!disabled && (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={addLang} onChange={(e) => setAddLang(e.target.value)} aria-label={l.addLanguage} className="h-9 w-32">
                <option value="">{l.language}</option>
                {LANGS.filter((x) => !langs.includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
              <Button type="button" size="sm" variant="outline" disabled={!addLang} onClick={() => { setLangs([...langs, addLang]); setAddLang(""); }}><Plus className="size-4" /> {l.addLanguage}</Button>
            </div>
          )}
        </section>
      )}

      {parts.nutrition && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-semibold">{f(l.nutritionPer, { basis: basis === "100ml" ? "100 ml" : "100 g" })}</h3>
            <Select value={basis} disabled={disabled} onChange={(e) => setBasis(e.target.value as "100g" | "100ml")} className="h-8 w-28" aria-label={l.per} data-testid="food-basis">
              <option value="100g">100 g</option><option value="100ml">100 ml</option>
            </Select>
          </div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {NUTRIENTS.map((n) => (
              <div key={n} className="space-y-1">
                <Label htmlFor={`n-${n}`} className="text-xs">{l[`n.${n}`]}</Label>
                <Input id={`n-${n}`} inputMode="decimal" value={nut[n] ?? ""} disabled={disabled} onChange={(e) => setNut({ ...nut, [n]: e.target.value })} data-testid={`food-n-${n}`} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        {parts.origin && <div className="space-y-1"><Label htmlFor="food-origin">{l.origin}</Label><Input id="food-origin" maxLength={2} placeholder="PT" value={origin} disabled={disabled} onChange={(e) => setOrigin(e.target.value.toUpperCase())} data-testid="food-origin" /></div>}
        <div className="space-y-1"><Label htmlFor="food-shelf">{l.shelfLife}</Label><Input id="food-shelf" inputMode="numeric" value={shelf} disabled={disabled} onChange={(e) => setShelf(e.target.value.replace(/\D/g, ""))} /></div>
        <div className="space-y-1"><Label htmlFor="food-opened">{l.afterOpening}</Label><Input id="food-opened" inputMode="numeric" value={opened} disabled={disabled} onChange={(e) => setOpened(e.target.value.replace(/\D/g, ""))} /></div>
      </section>

      {parts.diets && (
        <section className="space-y-2">
          <h3 className="font-semibold">{l.dietsTitle}</h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {DIETS.map((d) => <label key={d} className="flex items-center gap-1.5 text-sm"><input type="checkbox" disabled={disabled} checked={diets.includes(d)} onChange={(e) => setDiets(e.target.checked ? [...diets, d] : diets.filter((x) => x !== d))} data-testid={`food-diet-${d}`} />{l[`diet.${d}`]}</label>)}
          </div>
        </section>
      )}

      {(issues.length > 0 || missing.length > 0) && (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="food-issues">
          {missing.length > 0 && <p>{f(l.stillMissing, { fields: fieldsText(missing) })}</p>}
          {issues.map((p, i) => <p key={i}>• {l[`p.${p.code}`]}{p.code === "NO_CERTIFICATE" ? ` (${l[`diet.${p.field}`]})` : ""}</p>)}
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {!pending && <Button variant="outline" disabled={busy} data-testid="food-save" onClick={() => run(() => saveFoodDraftAction({ productId, data: payload() }), undefined, l.saved)}><Spin on={busy} icon={Save} /> {l.saveDraft}</Button>}
          {!pending && <Button disabled={busy || missing.length > 0} data-testid="food-submit" onClick={() => run(() => submitFoodAction({ productId, data: payload() }), (d) => void d, l.submitted)}><Spin on={busy} icon={Send} /> {l.submit}</Button>}
          {pending && <Button variant="outline" disabled={busy} data-testid="food-withdraw" onClick={() => run(() => withdrawFoodAction({ productId }))}><Undo2 className="size-4" /> {l.withdraw}</Button>}
          {aiOn && !pending && <ReadLabel l={l} productId={productId} hasLabel={!!data?.hasLabel} />}
          <Msg error={error} done={done} />
        </div>
      )}
    </div>
  );
}

function ReadLabel({ l, productId, hasLabel }: { l: L; productId: string; hasLabel: boolean }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pending || !hasLabel} data-testid="food-ai" title={hasLabel ? undefined : l.labelPhoto}
        onClick={() => run(() => readLabelAction({ productId }), (d) => { const r = d as { simulated: boolean; unsure: string }; setNote(`${l.aiDraft}${r.simulated ? ` ${l.aiSimulated}` : ""}`); })}>
        <Spin on={pending} icon={Sparkles} /> {l.readAi}
      </Button>
      {note && <span className="text-xs text-muted-foreground" data-testid="food-ai-note">{note}</span>}
      <Msg error={error} />
    </span>
  );
}

export function FoodFileUpload({ l, productId, kind, current, href, disabled }: { l: L; productId: string; kind: "LABEL" | "SPEC"; current: string | null; href: string | null; disabled?: boolean }) {
  const { pending, error, done, run } = useRun();
  const [k, setK] = useState(0);
  return (
    <form key={k} className="flex flex-wrap items-center gap-2" data-testid={`food-upload-${kind.toLowerCase()}`}
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => uploadFoodFileAction(fd), () => setK(k + 1), l.saved); }}>
      <input type="hidden" name="productId" value={productId} /><input type="hidden" name="kind" value={kind} />
      <span className="min-w-0 basis-40 text-sm font-medium">{kind === "LABEL" ? l.labelPhoto : l.specSheet}</span>
      {current && (href ? <a href={href} target="_blank" rel="noreferrer" className="max-w-[12rem] truncate text-xs text-primary hover:underline">{current}</a> : <span className="text-xs">{current}</span>)}
      {!disabled && <>
        <Input type="file" name="file" accept={kind === "LABEL" ? "image/jpeg,image/png,image/webp,application/pdf" : "application/pdf,image/jpeg,image/png"} className="h-9 max-w-[16rem]" required aria-label={kind === "LABEL" ? l.labelPhoto : l.specSheet} data-testid={`food-file-${kind.toLowerCase()}`} />
        <Button size="sm" variant="outline" disabled={pending}><Spin on={pending} icon={FileUp} /> {l.upload}</Button>
      </>}
      <Msg error={error} done={done} />
    </form>
  );
}

export function FoodCertificates({ l, productId, rows, disabled }: { l: L; productId: string; rows: { id: string; diet: string; number: string | null; issuer: string | null; expiresOn: string | null; file: string | null }[]; disabled?: boolean }) {
  const { pending, error, done, run } = useRun();
  const [k, setK] = useState(0);
  return (
    <div className="space-y-2" data-testid="food-certs">
      {rows.length > 0 && (
        <ul className="divide-y text-sm">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <b className="font-medium">{l[`diet.${c.diet}`] ?? c.diet}</b>
              <span className="text-xs text-muted-foreground">{[c.number, c.issuer, c.expiresOn, c.file].filter(Boolean).join(" · ")}</span>
              {!disabled && <Button size="sm" variant="ghost" className="ml-auto" disabled={pending} onClick={() => run(() => removeFoodCertificateAction({ id: c.id, productId }))}><Trash2 className="size-4" /> {l.remove}</Button>}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <form key={k} className="grid gap-2 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => addFoodCertificateAction(fd), () => setK(k + 1), l.saved); }}>
          <input type="hidden" name="productId" value={productId} />
          <Select name="diet" aria-label={l.certFor} defaultValue="HALAL">{DIETS.map((d) => <option key={d} value={d}>{l[`diet.${d}`]}</option>)}</Select>
          <Input name="number" placeholder={l.certNumber} aria-label={l.certNumber} data-testid="food-cert-number" />
          <Input name="issuer" placeholder={l.certIssuer} aria-label={l.certIssuer} />
          <Input name="expiresOn" type="date" aria-label={l.certExpires} />
          <Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" aria-label={l.certificates} />
          <div className="sm:col-span-5 flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={pending} data-testid="food-cert-add"><Spin on={pending} icon={Plus} /> {l.addCert}</Button><Msg error={error} done={done} /></div>
        </form>
      )}
    </div>
  );
}

// ── supplier: import ────────────────────────────────────────────────────────

type ImportResult = { rows: { row: number; ref: string; product: string | null; status: string; message: string | null }[]; totals: { rows: number; ok: number; incomplete: number; error: number; notFound: number }; saved: number; submitted: number; applied: boolean };

export function FoodImport({ l }: { l: L }) {
  const { pending, error, run } = useRun();
  const [file, setFile] = useState<File | null>(null);
  const [submit, setSubmit] = useState(true);
  const [res, setRes] = useState<ImportResult | null>(null);
  const go = (apply: boolean) => { if (!file) return; const fd = new FormData(); fd.set("file", file); fd.set("apply", apply ? "1" : "0"); fd.set("submit", submit ? "1" : "0"); run(() => importFoodAction(fd), (d) => setRes(d as ImportResult)); };
  const TONE: Record<string, string> = { OK: "text-[color:var(--success,#16a34a)]", INCOMPLETE: "text-amber-600", ERROR: "text-destructive", NOT_FOUND: "text-muted-foreground" };
  return (
    <div className="space-y-4" data-testid="food-import">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a href="/api/food/template?layout=firingi" className="text-primary hover:underline" data-testid="food-template">{l.template}</a>
        <a href="/api/food/template?layout=gs1" className="text-primary hover:underline">{l.templateGs1}</a>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="max-w-xs" aria-label={l.file} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); }} data-testid="food-import-file" />
        <Button variant="outline" disabled={pending || !file} onClick={() => go(false)} data-testid="food-import-check"><Spin on={pending} icon={Check} /> {l.check}</Button>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={submit} onChange={(e) => setSubmit(e.target.checked)} />{l.submitToo}</label>
        <Button disabled={pending || !file || !res || res.applied} onClick={() => go(true)} data-testid="food-import-apply"><Spin on={pending} icon={FileUp} /> {l.doImport}</Button>
      </div>
      <Msg error={error} />
      {res && (
        <div className="space-y-2">
          <p className="text-sm" data-testid="food-import-totals">
            {(["OK", "INCOMPLETE", "ERROR", "NOT_FOUND"] as const).map((k) => `${l[`r.${k}`]}: ${res.totals[k === "OK" ? "ok" : k === "INCOMPLETE" ? "incomplete" : k === "ERROR" ? "error" : "notFound"]}`).join(" · ")}
            {res.applied && <b className="ml-2" data-testid="food-import-done">{f(l.imported, { saved: res.saved, submitted: res.submitted })}</b>}
          </p>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1 pr-2">{l.colRow}</th><th className="pr-2">{l.colRef}</th><th className="pr-2">{l.colProduct}</th><th className="pr-2">{l.colStatus}</th><th>{l.colNote}</th></tr></thead>
            <tbody>{res.rows.map((r) => <tr key={r.row} className="border-b" data-testid="food-import-row" data-status={r.status}><td className="py-1 pr-2 tabular-nums">{r.row}</td><td className="pr-2 font-mono text-xs">{r.ref}</td><td className="pr-2">{r.product ?? "—"}</td><td className={`pr-2 ${TONE[r.status]}`}>{l[`r.${r.status}`]}</td><td className="text-xs">{r.message ?? ""}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

// ── customers ───────────────────────────────────────────────────────────────

export function FoodProfileForm({ l, initial }: { l: L; initial: { avoid: string[]; includeTraces: boolean; hideInCatalogue: boolean } }) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState(initial);
  return (
    <div className="space-y-3" data-testid="food-profile">
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {ALLERGENS.map((a) => <label key={a} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={x.avoid.includes(a)} onChange={(e) => setX({ ...x, avoid: e.target.checked ? [...x.avoid, a] : x.avoid.filter((y) => y !== a) })} data-testid={`avoid-${a}`} />{l[`a.${a}`]}</label>)}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={x.includeTraces} onChange={(e) => setX({ ...x, includeTraces: e.target.checked })} />{l.includeTraces}</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={x.hideInCatalogue} onChange={(e) => setX({ ...x, hideInCatalogue: e.target.checked })} data-testid="avoid-hide" />{l.hideInCatalogue}</label>
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={pending} onClick={() => run(() => saveFoodProfileAction({ avoid: x.avoid as (typeof ALLERGENS)[number][], includeTraces: x.includeTraces, hideInCatalogue: x.hideInCatalogue }), undefined, l.saved)} data-testid="avoid-save"><Spin on={pending} icon={Save} /> {l.saveProfile}</Button><Msg error={error} done={done} /></div>
    </div>
  );
}

// ── FIRINGI (English) ───────────────────────────────────────────────────────

export function FoodReviewActions({ id }: { id: string }) {
  const { pending, error, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2" data-testid="food-review">
      <Textarea rows={2} placeholder="Note for the supplier (needed to send back)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" data-testid="food-review-note" />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} data-testid="food-approve" onClick={() => run(() => reviewFoodAction({ id, decision: "APPROVE", note: note || null }))}><Spin on={pending} icon={ShieldCheck} /> Approve — customers see it</Button>
        <Button variant="outline" disabled={pending} data-testid="food-reject" onClick={() => run(() => reviewFoodAction({ id, decision: "REJECT", note }))}><ShieldX className="size-4" /> Send back to the supplier</Button>
        <Msg error={error} />
      </div>
    </div>
  );
}

export function AllergenRecallForm({ offers }: { offers: { id: string; label: string }[] }) {
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState({ offerId: offers[0]?.id ?? "", lotCode: "", allergen: "NUTS" as (typeof ALLERGENS)[number], note: "" });
  if (!offers.length) return <p className="text-sm text-muted-foreground">No supplier sells this product at the moment.</p>;
  return (
    <div className="space-y-2" data-testid="food-recall">
      <div className="grid gap-2 sm:grid-cols-4">
        <Select aria-label="Offer" value={v.offerId} onChange={(e) => setV({ ...v, offerId: e.target.value })}>{offers.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
        <Input aria-label="Lot" placeholder="Lot / batch" value={v.lotCode} onChange={(e) => setV({ ...v, lotCode: e.target.value })} />
        <Select aria-label="Allergen" value={v.allergen} onChange={(e) => setV({ ...v, allergen: e.target.value as (typeof ALLERGENS)[number] })}>{ALLERGENS.map((a) => <option key={a} value={a}>{a.toLowerCase().replace(/_/g, " ")}</option>)}</Select>
        <Input aria-label="Note" placeholder="What happened (optional)" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="destructive" size="sm" disabled={pending || !v.lotCode.trim()} onClick={() => run(() => allergenRecallAction({ ...v, note: v.note || null }), undefined, "Recall started — every buyer of the lot is told")}><Spin on={pending} icon={ShieldX} /> Start recall (class I)</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function FoodSettingsForm({ initial }: { initial: FoodSettings }) {
  const { pending, error, done, run } = useRun();
  const [x, setX] = useState<FoodSettings>(initial);
  const [days, setDays] = useState(initial.certReminderDays.join(" "));
  const box = (label: string, checked: boolean, on: (v: boolean) => void, testid?: string) => <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => on(e.target.checked)} data-testid={testid} /> {label}</label>;
  const p = (k: keyof FoodSettings["parts"], label: string) => box(label, x.parts[k], (v) => setX({ ...x, parts: { ...x.parts, [k]: v } }), `fs-part-${k}`);
  return (
    <div className="space-y-6" data-testid="food-settings">
      {box("Food information on", x.enabled, (v) => setX({ ...x, enabled: v }), "fs-enabled")}
      <div className="space-y-2"><p className="text-sm font-medium">What suppliers fill in and customers see</p>
        <div className="grid gap-2 sm:grid-cols-3">{p("allergens", "14 EU allergens")}{p("ingredients", "Ingredients")}{p("nutrition", "Nutrition per 100 g / ml")}{p("diets", "Diets & certificates")}{p("origin", "Origin")}</div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">Checks</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("FIRINGI checks every version before customers see it (off: published at once)", x.review, (v) => setX({ ...x, review: v }), "fs-review")}
          {box("Required to sell: food products without approved, complete information are hidden from customers", x.requireToSell, (v) => setX({ ...x, requireToSell: v }), "fs-require")}
          {box("Suppliers can import spreadsheets (FIRINGI / GS1)", x.import, (v) => setX({ ...x, import: v }), "fs-import")}
          {box("Suppliers can let the AI read the label photo (draft only)", x.ai, (v) => setX({ ...x, ai: v }), "fs-ai")}
        </div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">Customers</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {box("Allergen / diet badges on products", x.badges, (v) => setX({ ...x, badges: v }), "fs-badges")}
          {box("Allergen and diet filter in the catalogue", x.filter, (v) => setX({ ...x, filter: v }), "fs-filter")}
          {box("Allergen book (PDF)", x.sheet, (v) => setX({ ...x, sheet: v }), "fs-sheet")}
          {box("Recipe-change alerts to customers who bought the product", x.changeAlerts, (v) => setX({ ...x, changeAlerts: v }), "fs-alerts")}
          {box("Kitchen allergen profile (flags / hides products — for restaurants)", x.profile, (v) => setX({ ...x, profile: v }), "fs-profile")}
          {box("Resellers: public product page + shelf QR labels (no prices)", x.publicPage, (v) => setX({ ...x, publicPage: v }), "fs-public")}
          {box("Resellers: food data export (CSV)", x.export, (v) => setX({ ...x, export: v }), "fs-export")}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor="fs-days">Alert customers who bought within (days)</Label><Input id="fs-days" inputMode="numeric" value={x.alertDays} onChange={(e) => setX({ ...x, alertDays: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></div>
        </div>
      </div>
      <div className="space-y-2"><p className="text-sm font-medium">FIRINGI</p>
        <div className="grid gap-2 sm:grid-cols-2">{box("Start an allergen recall from a review (links to Recalls)", x.recallLink, (v) => setX({ ...x, recallLink: v }), "fs-recall")}</div>
        <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1"><Label htmlFor="fs-cert">Certificate reminders (days before expiry)</Label><Input id="fs-cert" value={days} onChange={(e) => setDays(e.target.value)} /></div></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={pending} data-testid="fs-save" onClick={() => run(() => saveFoodSettingsAction({ ...x, certReminderDays: days.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) }), undefined, "Saved")}><Spin on={pending} icon={Save} /> Save</Button>
        <Msg error={error} done={done} />
      </div>
    </div>
  );
}

export function RequirementsRow({ categoryId, own, effective, inherited }: { categoryId: string; own: string[] | null; effective: string[] | null; inherited: boolean }) {
  const { pending, error, run } = useRun();
  const [sel, setSel] = useState<string[]>(own ?? effective ?? []);
  const [mode, setMode] = useState<"inherit" | "set">(inherited ? "inherit" : "set");
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="food-req" data-category={categoryId}>
      <Select value={mode} onChange={(e) => setMode(e.target.value as "inherit" | "set")} className="h-8 w-36" aria-label="Rule">
        <option value="inherit">From the parent</option><option value="set">Own rule</option>
      </Select>
      {mode === "set" && FIELDS.map((fl) => <label key={fl} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={sel.includes(fl)} onChange={(e) => setSel(e.target.checked ? [...sel, fl] : sel.filter((y) => y !== fl))} />{fl.toLowerCase().replace(/_/g, " ")}</label>)}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => saveFoodRequirementsAction({ categoryId, fields: mode === "inherit" ? null : (sel as (typeof FIELDS)[number][]) }))}><Spin on={pending} icon={Save} /> Save</Button>
      <Msg error={error} />
    </div>
  );
}

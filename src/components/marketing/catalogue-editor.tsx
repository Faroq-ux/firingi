"use client";
/**
 * FIRINGI marketing catalogue editor (English): who it is for (all / wholesalers / zones / districts), how products are
 * picked (filters or AI brief), the order and sections, the layout, what each product shows (price, barcode, quantities,
 * supplier, QR), then PDF, share link, own PDF upload, translate, publish and send.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Download, ExternalLink, FileUp, Languages, Megaphone, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import type { TextareaHTMLAttributes } from "react";

const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />;
import { Msg, Spin, useRun } from "@/components/shared/run";
import {
  aiCatalogueAction, catalogueStatusAction, createCatalogueAction, duplicateCatalogueAction, fillCatalogueAction, removeCatalogueUploadAction,
  saveMcSettingsAction, sendCatalogueAction, translateCatalogueAction, updateCatalogueAction, uploadCataloguePdfAction,
} from "@/server/actions/marketing-catalogues";
import type { McFilters, McItem, McLayout, McOptions, McScope } from "@/lib/marketing-catalogue";

type Opt = { id: string; label: string };
export type EditorLists = { countries: Opt[]; wholesalers: Opt[]; zones: Opt[]; regions: Opt[]; categories: Opt[]; brands: Opt[]; locales: string[] };
export type EditorValue = {
  title: string; subtitle: string; intro: string; locale: string; countryId: string; scope: McScope; scopeIds: string[];
  filters: McFilters; items: McItem[]; layout: McLayout; options: McOptions;
};
type Entry = { offerId: string; name: string; pack: string; price: string | null };

function Checks({ options, value, onChange, testid }: { options: Opt[]; value: string[]; onChange: (v: string[]) => void; testid: string }) {
  if (!options.length) return <p className="text-sm text-muted-foreground">None yet.</p>;
  return (
    <div className="grid max-h-56 gap-1 overflow-auto rounded-lg border p-2 sm:grid-cols-2" data-testid={testid}>
      {options.map((o) => (
        <label key={o.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} /> <span className="min-w-0 break-words">{o.label}</span></label>
      ))}
    </div>
  );
}
const Box = ({ label, checked, onChange, testid }: { label: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /> {label}</label>
);

export function CatalogueEditor({ id, initial, lists, entries, aiReady, status, shareToken, uploaded, views }: {
  id: string | null; initial: EditorValue; lists: EditorLists; entries: Entry[]; aiReady: boolean; status: string; shareToken: string | null; uploaded: boolean; views: number;
}) {
  const router = useRouter();
  const { pending, error, done, run } = useRun();
  const [v, setV] = useState(initial);
  const [brief, setBrief] = useState("");
  const [lang, setLang] = useState(lists.locales.find((l) => l !== initial.locale) ?? "en");
  const set = <K extends keyof EditorValue>(k: K, x: EditorValue[K]) => setV((s) => ({ ...s, [k]: x }));
  const byId = new Map(entries.map((e) => [e.offerId, e]));
  const move = (k: number, d: number) => { const items = [...v.items]; const j = k + d; if (j < 0 || j >= items.length) return; [items[k], items[j]] = [items[j], items[k]]; set("items", items); };

  const save = () => run(async () => {
    if (!id) { const r = await createCatalogueAction(v); if (r.ok) router.push(`/admin/marketing/catalogues/${(r.data as { id: string }).id}`); return r; }
    const r = await updateCatalogueAction({ id, data: v }); if (r.ok) router.refresh(); return r;
  }, undefined, "Saved.");
  const after = async <R extends { ok: boolean }>(p: Promise<R>) => { const r = await p; if (r.ok) router.refresh(); return r; };
  const scopeOptions = v.scope === "WHOLESALER" ? lists.wholesalers : v.scope === "ZONE" ? lists.zones : v.scope === "DISTRICT" ? lists.regions : [];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-testid="mc-editor">
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">Cover</h3>
          <div className="space-y-1"><Label htmlFor="mc-title">Title</Label><Input id="mc-title" value={v.title} onChange={(e) => set("title", e.target.value)} required data-testid="mc-title" /></div>
          <div className="space-y-1"><Label htmlFor="mc-sub">Subtitle</Label><Input id="mc-sub" value={v.subtitle} onChange={(e) => set("subtitle", e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="mc-intro">Intro</Label><Textarea id="mc-intro" rows={3} value={v.intro} onChange={(e) => set("intro", e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="mc-locale">Language</Label><Select id="mc-locale" value={v.locale} onChange={(e) => set("locale", e.target.value)} data-testid="mc-locale">{lists.locales.map((l) => <option key={l} value={l}>{l}</option>)}</Select></div>
            <div className="space-y-1"><Label htmlFor="mc-country">Country</Label><Select id="mc-country" value={v.countryId} onChange={(e) => setV({ ...v, countryId: e.target.value, scopeIds: [] })} data-testid="mc-country">{lists.countries.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></div>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">For whom</h3>
          <div className="flex flex-wrap gap-2" data-testid="mc-scope">
            {([["ALL", "All wholesalers"], ["WHOLESALER", "Wholesalers"], ["ZONE", "Delivery zones"], ["DISTRICT", "Districts"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setV({ ...v, scope: k, scopeIds: [] })} aria-pressed={v.scope === k} data-testid={`mc-scope-${k}`}
                className={`rounded-lg border-2 px-3 py-1.5 text-sm font-medium ${v.scope === k ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"}`}>{label}</button>
            ))}
          </div>
          {v.scope !== "ALL" && <Checks options={scopeOptions} value={v.scopeIds} onChange={(x) => set("scopeIds", x)} testid="mc-scope-ids" />}
          <p className="text-xs text-muted-foreground">Zones and districts: the wholesalers that deliver there. Sending: the customers there (wholesalers: their customers).</p>
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">Pick products</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Categories</Label><Checks options={lists.categories} value={v.filters.categoryIds ?? []} onChange={(x) => set("filters", { ...v.filters, categoryIds: x })} testid="mc-cats" /></div>
            <div className="space-y-1"><Label>Brands</Label><Checks options={lists.brands} value={v.filters.brandIds ?? []} onChange={(x) => set("filters", { ...v.filters, brandIds: x })} testid="mc-brands" /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="mc-q">Words or barcode</Label><Input id="mc-q" value={v.filters.q ?? ""} onChange={(e) => set("filters", { ...v.filters, q: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="mc-max">At most</Label><Input id="mc-max" type="number" min={1} max={200} value={v.filters.max ?? 24} onChange={(e) => set("filters", { ...v.filters, max: Number(e.target.value) })} data-testid="mc-max" /></div>
          </div>
          <div className="flex flex-wrap gap-4">
            <Box label="Best sellers first" checked={v.filters.bestSellers !== false} onChange={(x) => set("filters", { ...v.filters, bestSellers: x })} testid="mc-best" />
            <Box label="Only with a photo" checked={!!v.filters.withImages} onChange={(x) => set("filters", { ...v.filters, withImages: x })} testid="mc-photos" />
          </div>
          {id && <Button type="button" variant="outline" disabled={pending} onClick={() => run(async () => { const s = await updateCatalogueAction({ id, data: v }); return s.ok ? after(fillCatalogueAction({ id })) : s; })} data-testid="mc-fill"><Wand2 className="size-4" /> Fill from these filters</Button>}
          {id && aiReady && (
            <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-3">
              <Label htmlFor="mc-brief" className="flex items-center gap-1.5"><Sparkles className="size-4 text-primary" /> Build with AI</Label>
              <Textarea id="mc-brief" rows={2} placeholder="e.g. Summer drinks for cafés and snack bars, best sellers, 24 products" value={brief} onChange={(e) => setBrief(e.target.value)} data-testid="mc-brief" />
              <Button type="button" disabled={pending || brief.trim().length < 3} onClick={() => run(async () => { const s = await updateCatalogueAction({ id, data: v }); return s.ok ? after(aiCatalogueAction({ id, brief })) : s; })} data-testid="mc-ai"><Spin on={pending} icon={Sparkles} /> Build</Button>
              <p className="text-xs text-muted-foreground">The AI picks from the products of this scope and writes the title, intro and sections. Check and reorder below.</p>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-semibold">Layout and what each product shows</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="mc-layout">Layout</Label>
              <Select id="mc-layout" value={v.layout} onChange={(e) => set("layout", e.target.value as McLayout)} data-testid="mc-layout">
                <option value="GRID4">4 per page (large photos)</option><option value="GRID6">6 per page</option><option value="GRID9">9 per page</option><option value="LIST">List (12 per page)</option>
              </Select></div>
            <div className="space-y-1"><Label htmlFor="mc-price">Price</Label>
              <Select id="mc-price" value={v.options.price} onChange={(e) => set("options", { ...v.options, price: e.target.value as McOptions["price"] })} data-testid="mc-price">
                <option value="NONE">No prices</option><option value="NET">List price excl. VAT</option><option value="GROSS">List price incl. VAT</option>
              </Select></div>
            <div className="space-y-1"><Label htmlFor="mc-supplier">Supplier</Label>
              <Select id="mc-supplier" value={v.options.supplier} onChange={(e) => set("options", { ...v.options, supplier: e.target.value as McOptions["supplier"] })} data-testid="mc-supplier">
                <option value="NONE">Not shown</option><option value="NAME">Wholesaler&apos;s name</option><option value="AREA">FIRINGI + area (e.g. FIRINGI Almada)</option>
              </Select></div>
          </div>
          <div className="flex flex-wrap gap-4">
            <Box label="Barcode" checked={v.options.barcode} onChange={(x) => set("options", { ...v.options, barcode: x })} testid="mc-barcode" />
            <Box label="Pack and minimum order" checked={v.options.qty} onChange={(x) => set("options", { ...v.options, qty: x })} testid="mc-qty" />
            <Box label="QR code to order" checked={v.options.qr} onChange={(x) => set("options", { ...v.options, qr: x })} testid="mc-qr" />
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} data-testid="mc-save"><Spin on={pending} icon={Save} /> {id ? "Save" : "Create"}</Button><Msg error={error} done={done} /></div>
      </form>

      {id && (
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status === "PUBLISHED" ? "bg-[color:var(--success,#16a34a)]/15 text-[color:var(--success,#16a34a)]" : "bg-muted"}`} data-testid="mc-status">{status.toLowerCase()}</span>
              {status === "PUBLISHED" && <span className="text-xs text-muted-foreground">{views} views</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`/api/admin/marketing/catalogues/${id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent" data-testid="mc-pdf"><Download className="size-4" /> PDF</a>
              {status !== "PUBLISHED"
                ? <Button size="sm" disabled={pending} onClick={() => run(() => after(catalogueStatusAction({ id, status: "PUBLISHED" })))} data-testid="mc-publish">Publish</Button>
                : <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => after(catalogueStatusAction({ id, status: "DRAFT" })))}>Unpublish</Button>}
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(async () => { const r = await duplicateCatalogueAction({ id }); if (r.ok) router.push(`/admin/marketing/catalogues/${(r.data as { id: string }).id}`); return r; })}><Copy className="size-4" /> Duplicate</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(async () => { const r = await catalogueStatusAction({ id, status: "ARCHIVED" }); if (r.ok) router.push("/admin/marketing/catalogues"); return r; })}><Trash2 className="size-4" /> Archive</Button>
            </div>
            {status === "PUBLISHED" && shareToken && (
              <div className="space-y-1 text-sm">
                <Label>Share link</Label>
                <div className="flex flex-wrap items-center gap-2"><code className="break-all rounded bg-muted px-2 py-1 text-xs" data-testid="mc-link">/c/{shareToken}</code><Link href={`/c/${shareToken}`} target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="size-3.5" /> Open</Link></div>
                <Button size="sm" disabled={pending} onClick={() => run(async () => { const r = await sendCatalogueAction({ id }); if (r.ok) router.push(`/admin/marketing/campaigns/${(r.data as { campaignId: string }).campaignId}`); return r; })} data-testid="mc-send"><Megaphone className="size-4" /> Send to customers…</Button>
                <p className="text-xs text-muted-foreground">Makes a campaign draft (email + in-app) for the customers in this scope — choose channels and send it there.</p>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1"><Label htmlFor="mc-tr">Copy in another language</Label><Select id="mc-tr" value={lang} onChange={(e) => setLang(e.target.value)} className="w-32">{lists.locales.filter((l) => l !== v.locale).map((l) => <option key={l} value={l}>{l}</option>)}</Select></div>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(async () => { const r = await translateCatalogueAction({ id, locale: lang }); if (r.ok) router.push(`/admin/marketing/catalogues/${(r.data as { id: string }).id}`); return r; })} data-testid="mc-translate"><Languages className="size-4" /> Translate (AI)</Button>
            </div>
            <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); fd.set("id", id); run(() => after(uploadCataloguePdfAction(fd)), undefined, "Uploaded."); }}>
              <Label htmlFor="mc-up">Your own PDF instead (e.g. made in Canva)</Label>
              <div className="flex flex-wrap items-center gap-2"><input id="mc-up" name="file" type="file" accept="application/pdf" className="text-sm" data-testid="mc-upload" /><Button size="sm" type="submit" variant="outline" disabled={pending}><FileUp className="size-4" /> Upload</Button>
                {uploaded && <Button size="sm" type="button" variant="ghost" onClick={() => run(() => after(removeCatalogueUploadAction({ id })))}>Use the generated PDF</Button>}</div>
              {uploaded && <p className="text-xs text-primary" data-testid="mc-uploaded">Your own PDF is used for the download and the share link.</p>}
            </form>
          </section>

          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="font-semibold">Products ({v.items.length})</h3>
            {v.items.length === 0 ? <p className="text-sm text-muted-foreground">Fill from the filters or build with AI.</p> : (
              <ol className="divide-y rounded-lg border" data-testid="mc-items">
                {v.items.map((it, k) => {
                  const e = byId.get(it.offerId);
                  return (
                    <li key={it.offerId} className="space-y-1 px-3 py-2 text-sm" data-testid="mc-item">
                      <Input className="h-7 text-xs" placeholder="Section title (starts a new section)" value={it.section ?? ""} onChange={(x) => set("items", v.items.map((y, j) => (j === k ? { ...y, section: x.target.value || null } : y)))} />
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 break-words">{e ? <><b>{e.name}</b> <span className="text-muted-foreground">· {e.pack}{e.price ? ` · ${e.price}` : ""}</span></> : <span className="text-muted-foreground">No longer sold — will be left out</span>}</span>
                        <button type="button" aria-label="Up" onClick={() => move(k, -1)} className="rounded p-1 hover:bg-accent"><ArrowUp className="size-4" /></button>
                        <button type="button" aria-label="Down" onClick={() => move(k, 1)} className="rounded p-1 hover:bg-accent"><ArrowDown className="size-4" /></button>
                        <button type="button" aria-label="Remove" onClick={() => set("items", v.items.filter((_, j) => j !== k))} className="rounded p-1 text-destructive hover:bg-destructive/10"><Trash2 className="size-4" /></button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="text-xs text-muted-foreground">Save after reordering or removing.</p>
          </section>
        </div>
      )}
    </div>
  );
}

export function McSettingsForm({ initial }: { initial: { enabled: boolean; ai: boolean } }) {
  const { pending, error, done, run } = useRun();
  const [s, setS] = useState(initial);
  return (
    <form className="flex flex-wrap items-center gap-4" onSubmit={(e) => { e.preventDefault(); run(() => saveMcSettingsAction(s), undefined, "Saved."); }} data-testid="mc-settings">
      <Box label="Marketing catalogues on" checked={s.enabled} onChange={(x) => setS({ ...s, enabled: x })} testid="mc-on" />
      <Box label="AI may build and translate catalogues" checked={s.ai} onChange={(x) => setS({ ...s, ai: x })} testid="mc-ai-on" />
      <Button size="sm" type="submit" variant="outline" disabled={pending}><Spin on={pending} icon={Save} /> Save</Button><Msg error={error} done={done} />
    </form>
  );
}
